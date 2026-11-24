import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { changerPages, creerSection, deplacer, supprimerSection } from '../domaine/operations'
import { lirePlan, serialiserPlan } from '../domaine/plan'
import { lireExemple } from '../test/exemple'
import { FauxGitHub } from '../test/fauxGitHub'
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
    expect(etat.manuscrit?.textes.get('sections/le-heurt.md')).toBe(lireExemple()['sections/le-heurt.md'])
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

  it('signale un conflit sur le plan et laisse choisir', async () => {
    const { atelier, faux } = await ouvert()
    const ailleurs = deplacer(lirePlan(lireExemple()['plan.json'] ?? ''), LE_HEURT, 0)
    await faux.publier({ ...lireExemple(), 'plan.json': serialiserPlan(ailleurs) })

    atelier.modifierPlan((p) => deplacer(p, LEXIQUE, 0), 'déplacement de Lexique')
    await atelier.envoyerMaintenant()
    const etat = enAtelier(atelier.lire())
    expect(etat.conflit?.sections[0]?.id).toBe(LE_HEURT)
    expect(ordre(atelier)[0]).toBe(LEXIQUE) // la version locale reste affichée
    expect(faux.envois).toBe(0)

    await atelier.resoudreConflit('local')
    expect(enAtelier(atelier.lire()).conflit).toBeNull()
    expect(lirePlan(faux.fichiers()['plan.json'] ?? '').sections[0]?.id).toBe(LEXIQUE)
  })

  it('prendre la version de GitHub abandonne le brouillon', async () => {
    const { atelier, faux } = await ouvert()
    const ailleurs = deplacer(lirePlan(lireExemple()['plan.json'] ?? ''), LE_HEURT, 0)
    await faux.publier({ ...lireExemple(), 'plan.json': serialiserPlan(ailleurs) })
    atelier.modifierPlan((p) => deplacer(p, LEXIQUE, 0), 'déplacement de Lexique')
    await atelier.envoyerMaintenant()

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
    expect(enAtelier(atelier.lire()).manuscrit?.textes.get('sections/les-des.md')).toBe('')
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
