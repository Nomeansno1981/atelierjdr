import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { changerPages, creerSection, deplacer, modifierSection, supprimerSection } from '../domaine/operations'
import { lirePlan, serialiserPlan } from '../domaine/plan'
import { lireExemple } from '../test/exemple'
import { FauxGitHub } from '../test/fauxGitHub'
import { shaBlobGit } from '../github/empreinte'
import { Cache } from '../stockage/cache'
import { Atelier, type EtatAtelier } from './atelier'

let numero = 0

async function demarrer(faux: FauxGitHub, nomBase = `test-atelier-${++numero}`) {
  const atelier = new Atelier({ fetch: faux.enFetch(), nomBase })
  await atelier.demarrer()
  return atelier
}

function enAtelier(etat: EtatAtelier) {
  if (etat.phase !== 'atelier') throw new Error(`phase attendue : atelier, trouvée : ${etat.phase}`)
  return etat
}

describe('Atelier', () => {
  it('demande un jeton au premier lancement', async () => {
    const atelier = await demarrer(await FauxGitHub.creer(lireExemple()))
    expect(atelier.lire()).toEqual({ phase: 'connexion', depot: null, message: null })
  })

  it('refuse un jeton invalide sans quitter l’écran de connexion', async () => {
    const atelier = await demarrer(await FauxGitHub.creer(lireExemple()))
    const message = await atelier.seConnecter('mauvais', 'autrice/katastrophe')
    expect(message).toContain('GitHub refuse ce jeton')
    expect(atelier.lire().phase).toBe('connexion')
  })

  it('refuse un nom de dépôt mal formé', async () => {
    const atelier = await demarrer(await FauxGitHub.creer(lireExemple()))
    expect(await atelier.seConnecter('jeton-valide', 'katastrophe')).toContain('Nom de dépôt invalide')
  })

  it('signale un dépôt vide dès la connexion', async () => {
    const faux = await FauxGitHub.creer({})
    faux.vide = true
    const atelier = await demarrer(faux)
    expect(await atelier.seConnecter('jeton-valide', 'autrice/katastrophe')).toContain('Le dépôt est vide')
  })

  it('se connecte, synchronise et lit le plan', async () => {
    const faux = await FauxGitHub.creer(lireExemple())
    const atelier = await demarrer(faux)
    expect(await atelier.seConnecter(' jeton-valide ', 'autrice/katastrophe')).toBeNull()
    await atelier.synchroniser()
    const etat = enAtelier(atelier.lire())
    expect(etat.synchro.etat).toBe('a-jour')
    expect(etat.manuscrit?.plan?.sections).toHaveLength(10)
    expect(etat.manuscrit?.textes.get('k7f3qa')).toBe(lireExemple()['sections/le-heurt.md'])
  })

  it('rouvre sur le cache, hors ligne, sans redemander le jeton', async () => {
    const faux = await FauxGitHub.creer(lireExemple())
    const nomBase = `test-atelier-${++numero}`
    const premier = await demarrer(faux, nomBase)
    await premier.seConnecter('jeton-valide', 'autrice/katastrophe')
    await premier.synchroniser()

    const horsLigne = new Atelier({ fetch: () => Promise.reject(new TypeError('Failed to fetch')), nomBase })
    await horsLigne.demarrer()
    await horsLigne.synchroniser()
    const etat = enAtelier(horsLigne.lire())
    expect(etat.synchro.etat).toBe('hors-ligne')
    expect(etat.manuscrit?.plan?.sections).toHaveLength(10)
  })

  it('redemande un jeton après un 401 en gardant le dépôt et le cache', async () => {
    const faux = await FauxGitHub.creer(lireExemple())
    const nomBase = `test-atelier-${++numero}`
    const atelier = await demarrer(faux, nomBase)
    await atelier.seConnecter('jeton-valide', 'autrice/katastrophe')
    await atelier.synchroniser()

    faux.jetonValide = 'nouveau-jeton' // l'ancien est révoqué
    await atelier.synchroniser()
    const etat = atelier.lire()
    expect(etat).toMatchObject({ phase: 'connexion', depot: { proprietaire: 'autrice', nom: 'katastrophe' } })
    expect(etat.phase === 'connexion' && etat.message).toContain('n’accepte plus votre jeton')

    // Le cache est toujours là : il s'affiche dès la reconnexion.
    expect(await atelier.seConnecter('nouveau-jeton', 'autrice/katastrophe')).toBeNull()
    expect(enAtelier(atelier.lire()).manuscrit?.plan?.sections).toHaveLength(10)
  })

  it('affiche une erreur claire si plan.json est invalide', async () => {
    const atelier = await demarrer(await FauxGitHub.creer({ 'plan.json': '{"version": 2}' }))
    await atelier.seConnecter('jeton-valide', 'autrice/katastrophe')
    await atelier.synchroniser()
    const manuscrit = enAtelier(atelier.lire()).manuscrit
    expect(manuscrit?.plan).toBeNull()
    expect(manuscrit?.erreurPlan).toContain('plan.json est invalide')
  })

  it('signale l’absence de plan.json', async () => {
    const atelier = await demarrer(await FauxGitHub.creer({ 'README.md': 'x' }))
    await atelier.seConnecter('jeton-valide', 'autrice/katastrophe')
    await atelier.synchroniser()
    expect(enAtelier(atelier.lire()).manuscrit?.erreurPlan).toContain('ne contient pas de plan.json')
  })

  it('efface tout à la déconnexion', async () => {
    const faux = await FauxGitHub.creer(lireExemple())
    const nomBase = `test-atelier-${++numero}`
    const atelier = await demarrer(faux, nomBase)
    await atelier.seConnecter('jeton-valide', 'autrice/katastrophe')
    await atelier.synchroniser()
    await atelier.seDeconnecter()
    expect(atelier.lire()).toEqual({ phase: 'connexion', depot: null, message: null })

    const rouvert = await demarrer(faux, nomBase)
    expect(rouvert.lire()).toEqual({ phase: 'connexion', depot: null, message: null })
  })
})

describe('Atelier : opérations du plan', () => {
  const LE_HEURT = 'k7f3qa'
  const LEXIQUE = 'l7k3pw'

  async function ouvert(options: { delaiEnvoiMs?: number; faux?: FauxGitHub; nomBase?: string } = {}) {
    const faux = options.faux ?? (await FauxGitHub.creer(lireExemple()))
    const nomBase = options.nomBase ?? `test-plan-${++numero}`
    const atelier = new Atelier({ fetch: faux.enFetch(), nomBase, delaiEnvoiMs: options.delaiEnvoiMs ?? 60_000 })
    await atelier.demarrer()
    if (atelier.lire().phase === 'connexion') await atelier.seConnecter('jeton-valide', 'autrice/katastrophe')
    await atelier.synchroniser()
    return { atelier, faux, nomBase }
  }

  const planDe = (atelier: Atelier) => enAtelier(atelier.lire()).manuscrit?.plan
  const ordre = (atelier: Atelier) => planDe(atelier)?.sections.map((s) => s.id) ?? []

  it('applique l’opération tout de suite et la garde sur l’appareil', async () => {
    const { atelier, faux, nomBase } = await ouvert()
    atelier.modifierPlan((p) => deplacer(p, LEXIQUE, 0), 'déplacement de Lexique')
    expect(ordre(atelier)[0]).toBe(LEXIQUE)
    expect(enAtelier(atelier.lire())).toMatchObject({ synchro: { etat: 'local' }, enAttente: 1 })

    // Rien n'est encore parti : un autre onglet, sur la même base locale, voit le brouillon.
    await vi.waitFor(async () => {
      const autre = new Atelier({ fetch: () => Promise.reject(new TypeError('hors ligne')), nomBase })
      await autre.demarrer()
      expect(ordre(autre)[0]).toBe(LEXIQUE)
    })
    expect(faux.envois).toBe(0)
  })

  it('regroupe plusieurs opérations en un seul commit, envoyé après le délai', async () => {
    const { atelier, faux } = await ouvert({ delaiEnvoiMs: 30 })
    atelier.modifierPlan((p) => deplacer(p, LEXIQUE, 0), 'déplacement de Lexique')
    atelier.modifierPlan((p) => changerPages(p, LE_HEURT, 1), 'Le heurt sur 3 pages')
    await vi.waitFor(() => {
      expect(enAtelier(atelier.lire()).synchro.etat).toBe('a-jour')
    })
    expect(faux.envois).toBe(1)
    expect(faux.messages()[0]).toBe('Plan : déplacement de Lexique, Le heurt sur 3 pages')
    expect(lirePlan(faux.fichiers()['plan.json'] ?? '').sections[0]?.id).toBe(LEXIQUE)
    expect(enAtelier(atelier.lire()).enAttente).toBe(0)
  })

  it('renvoie le brouillon au démarrage suivant', async () => {
    const { atelier, faux, nomBase } = await ouvert()
    atelier.modifierPlan((p) => deplacer(p, LEXIQUE, 0), 'déplacement de Lexique')
    await vi.waitFor(async () => {
      const relance = new Atelier({ fetch: faux.enFetch(), nomBase })
      await relance.demarrer()
      await relance.synchroniser()
      expect(faux.envois).toBe(1)
    })
    expect(lirePlan(faux.fichiers()['plan.json'] ?? '').sections[0]?.id).toBe(LEXIQUE)
  })

  it('annule et rétablit ; revenir au plan de GitHub efface le brouillon', async () => {
    const { atelier, faux } = await ouvert()
    const depart = ordre(atelier)
    atelier.modifierPlan((p) => deplacer(p, LEXIQUE, 0), 'déplacement de Lexique')
    expect(enAtelier(atelier.lire()).annulable).toBe('déplacement de Lexique')

    atelier.annuler()
    expect(ordre(atelier)).toEqual(depart)
    expect(enAtelier(atelier.lire())).toMatchObject({ enAttente: 0, annulable: null, retablissable: 'déplacement de Lexique' })

    atelier.retablir()
    expect(ordre(atelier)[0]).toBe(LEXIQUE)
    atelier.annuler()
    await atelier.envoyerMaintenant()
    expect(faux.envois).toBe(0)
  })

  it('garde au moins 20 niveaux d’annulation', async () => {
    const { atelier } = await ouvert()
    for (let i = 0; i < 25; i++) atelier.modifierPlan((p) => changerPages(p, LE_HEURT, 1), `pages ${i}`)
    for (let i = 0; i < 25; i++) atelier.annuler()
    expect(planDe(atelier)?.sections.find((s) => s.id === LE_HEURT)?.pages).toBe(2)
  })

  it('reste en attente hors ligne, puis envoie au retour du réseau', async () => {
    const faux = await FauxGitHub.creer(lireExemple())
    let reseau = true
    const fetchVariable: typeof fetch = (e, i) => (reseau ? faux.enFetch()(e, i) : Promise.reject(new TypeError('hors ligne')))
    const atelier = new Atelier({ fetch: fetchVariable, nomBase: `test-plan-${++numero}`, delaiEnvoiMs: 60_000 })
    await atelier.demarrer()
    await atelier.seConnecter('jeton-valide', 'autrice/katastrophe')
    await atelier.synchroniser()

    reseau = false
    atelier.modifierPlan((p) => deplacer(p, LEXIQUE, 0), 'déplacement de Lexique')
    await atelier.envoyerMaintenant()
    expect(enAtelier(atelier.lire())).toMatchObject({ synchro: { etat: 'hors-ligne' }, enAttente: 1 })

    reseau = true
    await atelier.synchroniser()
    expect(enAtelier(atelier.lire())).toMatchObject({ synchro: { etat: 'a-jour' }, enAttente: 0 })
    expect(faux.envois).toBe(1)
  })

  it('plan modifié ailleurs pendant les modifications ici : fusionné automatiquement', async () => {
    const { atelier, faux } = await ouvert()
    const ailleurs = deplacer(lirePlan(lireExemple()['plan.json'] ?? ''), LE_HEURT, 0)
    await faux.publier({ ...lireExemple(), 'plan.json': serialiserPlan(ailleurs) }, 'ailleurs', new Date(Date.now() - 60_000))

    atelier.modifierPlan((p) => deplacer(p, LEXIQUE, 0), 'déplacement de Lexique')
    await atelier.envoyerMaintenant()
    const etat = enAtelier(atelier.lire())
    expect(etat.conflit).toBeNull()
    // Les deux appareils ont réordonné : l'ordre le plus récent (celui d'ici) l'emporte.
    expect(etat.fusion?.remplacements.some((r) => r.includes('ordre des sections'))).toBe(true)
    expect(lirePlan(faux.fichiers()['plan.json'] ?? '').sections[0]?.id).toBe(LEXIQUE)
  })

  /** Simule un brouillon d'une version antérieure, sans base commune connue. */
  async function brouillonSansBase(nomBase: string, plan: ReturnType<typeof lirePlan>) {
    const cache = await Cache.ouvrir(nomBase)
    await cache.enregistrerBrouillon({
      plan,
      shaPlanBase: await shaBlobGit(lireExemple()['plan.json'] ?? ''),
      descriptions: ['déplacement de Lexique'],
      revision: 1,
      modifieLe: new Date().toISOString(),
    })
    cache.fermer()
  }

  it('sans base commune connue : conflit signalé, « garder la mienne »', async () => {
    const { faux, nomBase } = await ouvert()
    const exemple = lirePlan(lireExemple()['plan.json'] ?? '')
    await brouillonSansBase(nomBase, deplacer(exemple, LEXIQUE, 0))
    await faux.publier({ ...lireExemple(), 'plan.json': serialiserPlan(deplacer(exemple, LE_HEURT, 0)) })

    const atelier = new Atelier({ fetch: faux.enFetch(), nomBase, delaiEnvoiMs: 60_000 })
    await atelier.demarrer()
    await atelier.synchroniser()
    expect(enAtelier(atelier.lire()).conflit?.sections[0]?.id).toBe(LE_HEURT)
    expect(ordre(atelier)[0]).toBe(LEXIQUE)

    await atelier.resoudreConflit('local')
    expect(enAtelier(atelier.lire()).conflit).toBeNull()
    expect(lirePlan(faux.fichiers()['plan.json'] ?? '').sections[0]?.id).toBe(LEXIQUE)
  })

  it('sans base commune connue : « prendre celle de GitHub » abandonne le brouillon', async () => {
    const { faux, nomBase } = await ouvert()
    const exemple = lirePlan(lireExemple()['plan.json'] ?? '')
    await brouillonSansBase(nomBase, deplacer(exemple, LEXIQUE, 0))
    await faux.publier({ ...lireExemple(), 'plan.json': serialiserPlan(deplacer(exemple, LE_HEURT, 0)) })

    const atelier = new Atelier({ fetch: faux.enFetch(), nomBase, delaiEnvoiMs: 60_000 })
    await atelier.demarrer()
    await atelier.synchroniser()
    await atelier.resoudreConflit('distant')
    expect(ordre(atelier)[0]).toBe(LE_HEURT)
    expect(enAtelier(atelier.lire())).toMatchObject({ enAttente: 0, conflit: null, annulable: null })
  })

  it('une opération faite pendant l’envoi part au commit suivant', async () => {
    const { atelier, faux } = await ouvert({ delaiEnvoiMs: 20 })
    atelier.modifierPlan((p) => deplacer(p, LEXIQUE, 0), 'déplacement de Lexique')
    faux.avantMiseAJourBranche = () => {
      atelier.modifierPlan((p) => changerPages(p, LE_HEURT, 1), 'Le heurt sur 3 pages')
      return Promise.resolve()
    }
    await vi.waitFor(() => {
      expect(faux.envois).toBe(2)
      expect(enAtelier(atelier.lire()).synchro.etat).toBe('a-jour')
    })
    expect(faux.messages().slice(0, 2)).toEqual(['Plan : Le heurt sur 3 pages', 'Plan : déplacement de Lexique'])
    const plan = lirePlan(faux.fichiers()['plan.json'] ?? '')
    expect(plan.sections[0]?.id).toBe(LEXIQUE)
    expect(plan.sections.find((s) => s.id === LE_HEURT)?.pages).toBe(3)
  })

  it('crée le fichier d’une nouvelle section et le met en cache sans le retélécharger', async () => {
    const { atelier, faux } = await ouvert()
    atelier.modifierPlan(
      (p) => creerSection(p, { type: 'texte', titre: 'Les dés', partie: 'regles', pages: 1 }, 3, 'zzz111'),
      'création de Les dés',
    )
    faux.oublierRequetes()
    await atelier.envoyerMaintenant()
    expect(faux.fichiers()['sections/les-des.md']).toBe('')
    expect(enAtelier(atelier.lire()).manuscrit?.textes.get('zzz111')).toBe('')
    // Seul le plan distant est lu avant l'écriture ; rien n'est retéléchargé après.
    expect(faux.blobsTelecharges).toBe(1)
  })
})

describe('Atelier : corbeille', () => {
  it('supprimer puis vider dans le même envoi supprime le fichier, et ne s’annule pas', async () => {
    const faux = await FauxGitHub.creer(lireExemple())
    const atelier = new Atelier({ fetch: faux.enFetch(), nomBase: `test-corbeille-${++numero}`, delaiEnvoiMs: 60_000 })
    await atelier.demarrer()
    await atelier.seConnecter('jeton-valide', 'autrice/katastrophe')
    await atelier.synchroniser()

    atelier.modifierPlan((p) => supprimerSection(p, 'l7k3pw', new Date()), 'suppression de Lexique')
    atelier.viderCorbeille()
    expect(enAtelier(atelier.lire()).annulable).toBeNull()
    await atelier.envoyerMaintenant()

    const fichiers = faux.fichiers()
    expect(fichiers['sections/lexique.md']).toBeUndefined()
    expect(fichiers['corbeille/lexique.md']).toBeUndefined()
    expect(faux.messages()[0]).toBe('Plan : suppression de Lexique, vidage de la corbeille')
  })
})

describe('Atelier : textes', () => {
  const LE_HEURT = 'k7f3qa'
  const exemple = lireExemple()

  async function ouvert(options: { faux?: FauxGitHub; nomBase?: string; fetch?: typeof fetch; delaiEnvoiTexteMs?: number } = {}) {
    const faux = options.faux ?? (await FauxGitHub.creer(exemple))
    const nomBase = options.nomBase ?? `test-texte-${++numero}`
    const atelier = new Atelier({
      fetch: options.fetch ?? faux.enFetch(),
      nomBase,
      delaiEnvoiMs: 60_000,
      delaiEnvoiTexteMs: options.delaiEnvoiTexteMs ?? 60_000,
    })
    await atelier.demarrer()
    if (atelier.lire().phase === 'connexion') await atelier.seConnecter('jeton-valide', 'autrice/katastrophe')
    await atelier.synchroniser()
    return { atelier, faux, nomBase }
  }
  const manuscrit = (a: Atelier) => enAtelier(a.lire()).manuscrit

  it('garde le texte sur l’appareil en moins d’une seconde', async () => {
    const { atelier, nomBase } = await ouvert()
    atelier.modifierTexte(LE_HEURT, 'Premier jet.\n')
    // L'état publié suit la frappe avec au plus 300 ms de retard.
    await vi.waitFor(() => {
      expect(manuscrit(atelier)?.textes.get(LE_HEURT)).toBe('Premier jet.\n')
    })
    await vi.waitFor(
      async () => {
        const autre = new Atelier({ fetch: () => Promise.reject(new TypeError('hors ligne')), nomBase })
        await autre.demarrer()
        expect(manuscrit(autre)?.textes.get(LE_HEURT)).toBe('Premier jet.\n')
        expect(manuscrit(autre)?.textesModifies.has(LE_HEURT)).toBe(true)
      },
      { timeout: 1000 },
    )
    expect(enAtelier(atelier.lire())).toMatchObject({ synchro: { etat: 'local' }, enAttente: 1 })
  })

  it('envoie le texte 30 s après la dernière frappe (délai réduit ici)', async () => {
    const { atelier, faux } = await ouvert({ delaiEnvoiTexteMs: 40 })
    atelier.modifierTexte(LE_HEURT, 'Version 1')
    atelier.modifierTexte(LE_HEURT, 'Version 2')
    await vi.waitFor(() => {
      expect(faux.fichiers()['sections/le-heurt.md']).toBe('Version 2')
    })
    expect(faux.envois).toBe(1)
    expect(faux.messages()[0]).toBe('Rédaction : Le heurt')
    await vi.waitFor(() => {
      expect(enAtelier(atelier.lire())).toMatchObject({ synchro: { etat: 'a-jour' }, enAttente: 0 })
    })
  })

  it('regroupe texte et plan dans un seul commit', async () => {
    const { atelier, faux } = await ouvert()
    atelier.modifierTexte(LE_HEURT, 'Texte.\n')
    atelier.modifierPlan((p) => changerPages(p, LE_HEURT, 1), 'Le heurt sur 3 pages')
    await atelier.envoyerMaintenant()
    expect(faux.envois).toBe(1)
    expect(faux.messages()[0]).toBe('Rédaction : Le heurt ; Plan : Le heurt sur 3 pages')
  })

  it('revenir au texte de GitHub retire la modification en attente', async () => {
    const { atelier, faux } = await ouvert()
    atelier.modifierTexte(LE_HEURT, 'Autre chose')
    atelier.modifierTexte(LE_HEURT, exemple['sections/le-heurt.md'] ?? '')
    expect(manuscrit(atelier)?.textesModifies.size).toBe(0)
    await atelier.envoyerMaintenant()
    expect(faux.envois).toBe(0)
  })

  it('critère du jalon : réseau coupé, écrire, fermer, rétablir, rouvrir : intact puis envoyé', async () => {
    const faux = await FauxGitHub.creer(exemple)
    let reseau = true
    const fetchVariable: typeof fetch = (e, i) => (reseau ? faux.enFetch()(e, i) : Promise.reject(new TypeError('hors ligne')))
    const { atelier, nomBase } = await ouvert({ faux, fetch: fetchVariable })

    reseau = false
    atelier.modifierTexte(LE_HEURT, 'Écrit dans le métro.\n')
    await atelier.envoyerMaintenant() // onglet en arrière-plan, puis fermé
    expect(enAtelier(atelier.lire())).toMatchObject({ synchro: { etat: 'hors-ligne' }, enAttente: 1 })

    reseau = true
    const rouvert = new Atelier({ fetch: faux.enFetch(), nomBase })
    await rouvert.demarrer()
    expect(manuscrit(rouvert)?.textes.get(LE_HEURT)).toBe('Écrit dans le métro.\n')
    await rouvert.synchroniser()
    expect(faux.fichiers()['sections/le-heurt.md']).toBe('Écrit dans le métro.\n')
    expect(enAtelier(rouvert.lire())).toMatchObject({ synchro: { etat: 'a-jour' }, enAttente: 0 })
  })

  it('les frappes pendant un envoi partent au suivant', async () => {
    const { atelier, faux } = await ouvert({ delaiEnvoiTexteMs: 30 })
    atelier.modifierTexte(LE_HEURT, 'Début')
    faux.avantMiseAJourBranche = () => {
      atelier.modifierTexte(LE_HEURT, 'Début, puis la suite')
      return Promise.resolve()
    }
    await atelier.envoyerMaintenant()
    expect(faux.fichiers()['sections/le-heurt.md']).toBe('Début')
    await vi.waitFor(() => {
      expect(faux.fichiers()['sections/le-heurt.md']).toBe('Début, puis la suite')
    })
    expect(faux.envois).toBe(2)
  })

  it('conflit : rien n’est écrasé, puis « garder la mienne »', async () => {
    const { atelier, faux } = await ouvert()
    await faux.publier({ ...exemple, 'sections/le-heurt.md': 'Version de l’iPad.\n' })
    atelier.modifierTexte(LE_HEURT, 'Version du Mac.\n')
    await atelier.envoyerMaintenant()

    const chemin = manuscrit(atelier)?.conflitsTexte.get(LE_HEURT) ?? ''
    expect(chemin).toMatch(/^conflits\/le-heurt-.*\.md$/)
    expect(faux.fichiers()['sections/le-heurt.md']).toBe('Version de l’iPad.\n')
    expect(faux.fichiers()[chemin]).toBe('Version du Mac.\n')
    expect(manuscrit(atelier)?.textes.get(LE_HEURT)).toBe('Version du Mac.\n')

    await atelier.resoudreConflitTexte(LE_HEURT, 'local')
    expect(faux.fichiers()['sections/le-heurt.md']).toBe('Version du Mac.\n')
    expect(faux.fichiers()[chemin]).toBeUndefined()
    expect(manuscrit(atelier)?.conflitsTexte.size).toBe(0)
    expect(enAtelier(atelier.lire()).enAttente).toBe(0)
  })

  it('conflit : « prendre celle de GitHub » garde la sauvegarde dans conflits/', async () => {
    const { atelier, faux } = await ouvert()
    await faux.publier({ ...exemple, 'sections/le-heurt.md': 'Version de l’iPad.\n' })
    atelier.modifierTexte(LE_HEURT, 'Version du Mac.\n')
    await atelier.envoyerMaintenant()
    const chemin = manuscrit(atelier)?.conflitsTexte.get(LE_HEURT) ?? ''

    await atelier.resoudreConflitTexte(LE_HEURT, 'distant')
    expect(manuscrit(atelier)?.textes.get(LE_HEURT)).toBe('Version de l’iPad.\n')
    expect(faux.fichiers()[chemin]).toBe('Version du Mac.\n')
    expect(enAtelier(atelier.lire()).enAttente).toBe(0)
  })

  it('un texte modifié ailleurs s’affiche à la synchronisation s’il n’y a rien en attente', async () => {
    const { atelier, faux } = await ouvert()
    await faux.publier({ ...exemple, 'sections/le-heurt.md': 'Version de l’iPad.\n' })
    await atelier.synchroniser()
    expect(manuscrit(atelier)?.textes.get(LE_HEURT)).toBe('Version de l’iPad.\n')
    expect(manuscrit(atelier)?.textesDistants.get(LE_HEURT)).toBe('Version de l’iPad.\n')
  })

  it('le texte suit sa section renommée avant l’envoi', async () => {
    const { atelier } = await ouvert()
    atelier.modifierPlan((p) => modifierSection(p, LE_HEURT, { titre: 'Le choc' }), 'modification de Le heurt')
    expect(manuscrit(atelier)?.textes.get(LE_HEURT)).toBe(exemple['sections/le-heurt.md'])
  })
})

describe('Atelier : deux appareils', () => {
  const LE_HEURT = 'k7f3qa'
  const LEXIQUE = 'l7k3pw'

  async function appareil(faux: FauxGitHub) {
    let reseau = true
    const fetchVariable: typeof fetch = (e, i) => (reseau ? faux.enFetch()(e, i) : Promise.reject(new TypeError('hors ligne')))
    const atelier = new Atelier({ fetch: fetchVariable, nomBase: `test-appareil-${++numero}`, delaiEnvoiMs: 60_000, delaiEnvoiTexteMs: 60_000 })
    await atelier.demarrer()
    await atelier.seConnecter('jeton-valide', 'autrice/katastrophe')
    await atelier.synchroniser()
    return {
      atelier,
      couper: (oui: boolean) => {
        reseau = !oui
      },
    }
  }
  const planDe = (a: Atelier) => {
    const p = enAtelier(a.lire()).manuscrit?.plan
    if (!p) throw new Error('pas de plan')
    return p
  }

  it('plan modifié hors ligne sur deux appareils : fusionné, rien de perdu', async () => {
    const faux = await FauxGitHub.creer(lireExemple())
    const a = await appareil(faux)
    const b = await appareil(faux)
    a.couper(true)
    b.couper(true)
    a.atelier.modifierPlan((p) => deplacer(p, LEXIQUE, 0), 'déplacement de Lexique')
    b.atelier.modifierPlan((p) => changerPages(p, LE_HEURT, 1), 'Le heurt sur 3 pages')

    a.couper(false)
    await a.atelier.envoyerMaintenant()
    b.couper(false)
    await b.atelier.envoyerMaintenant()

    const surGitHub = lirePlan(faux.fichiers()['plan.json'] ?? '')
    expect(surGitHub.sections[0]?.id).toBe(LEXIQUE)
    expect(surGitHub.sections.find((s) => s.id === LE_HEURT)?.pages).toBe(3)
    expect(enAtelier(b.atelier.lire()).fusion).toEqual({ remplacements: [] })
    expect(enAtelier(b.atelier.lire()).conflit).toBeNull()
    expect(serialiserPlan(planDe(b.atelier))).toBe(serialiserPlan(surGitHub))

    await a.atelier.synchroniser()
    expect(serialiserPlan(planDe(a.atelier))).toBe(serialiserPlan(surGitHub))
  })

  it('même champ changé des deux côtés : la modification la plus récente l’emporte, et c’est signalé', async () => {
    const faux = await FauxGitHub.creer(lireExemple())
    const a = await appareil(faux)
    const b = await appareil(faux)
    b.couper(true)
    // B modifie d'abord, A ensuite et envoie : la version de A est la plus récente.
    b.atelier.modifierPlan((p) => modifierSection(p, LE_HEURT, { statut: 'definitif' }), 'statut')
    await new Promise((r) => setTimeout(r, 20))
    a.atelier.modifierPlan((p) => modifierSection(p, LE_HEURT, { statut: 'relu' }), 'statut')
    await a.atelier.envoyerMaintenant()
    b.couper(false)
    await b.atelier.envoyerMaintenant()

    expect(lirePlan(faux.fichiers()['plan.json'] ?? '').sections.find((s) => s.id === LE_HEURT)?.statut).toBe('relu')
    const remplacements = enAtelier(b.atelier.lire()).fusion?.remplacements ?? []
    expect(remplacements).toHaveLength(1)
    expect(remplacements[0]).toContain('Le heurt : statut')
    b.atelier.oublierFusion()
    expect(enAtelier(b.atelier.lire()).fusion).toBeNull()
  })

  it('même texte modifié hors ligne sur deux appareils : aucune perte, conflit affiché', async () => {
    const faux = await FauxGitHub.creer(lireExemple())
    const a = await appareil(faux)
    const b = await appareil(faux)
    a.couper(true)
    b.couper(true)
    a.atelier.modifierTexte(LE_HEURT, 'Version de A.\n')
    b.atelier.modifierTexte(LE_HEURT, 'Version de B.\n')
    a.couper(false)
    await a.atelier.envoyerMaintenant()
    b.couper(false)
    await b.atelier.envoyerMaintenant()

    const fichiers = faux.fichiers()
    expect(fichiers['sections/le-heurt.md']).toBe('Version de A.\n')
    const sauvegarde = enAtelier(b.atelier.lire()).manuscrit?.conflitsTexte.get(LE_HEURT) ?? ''
    expect(fichiers[sauvegarde]).toBe('Version de B.\n')
    expect(enAtelier(b.atelier.lire()).manuscrit?.textesDistants.get(LE_HEURT)).toBe('Version de A.\n')
  })
})
