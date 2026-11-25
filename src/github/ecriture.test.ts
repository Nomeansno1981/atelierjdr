import { describe, expect, it } from 'vitest'
import {
  creerSection,
  modifierSection,
  restaurerSection,
  supprimerSection,
  viderCorbeille,
  deplacer,
} from '../domaine/operations'
import { lirePlan, serialiserPlan, type Plan, type SectionTexte } from '../domaine/plan'
import { lireExemple } from '../test/exemple'
import { FauxGitHub, shaBlobGit } from '../test/fauxGitHub'
import { creerClient, type Depot } from './client'
import { changementsFichiers, envoyer, messageCommit } from './ecriture'

const exemple = lireExemple()
const planExemple = (): Plan => lirePlan(exemple['plan.json'] ?? '')
const LE_HEURT = 'k7f3qa'
const LEXIQUE = 'l7k3pw'

async function arbreDe(fichiers: Record<string, string>): Promise<Map<string, string>> {
  const arbre = new Map<string, string>()
  for (const [chemin, contenu] of Object.entries(fichiers)) arbre.set(chemin, await shaBlobGit(contenu))
  return arbre
}

describe('changementsFichiers', () => {
  it('ne touche à aucun fichier pour un simple déplacement', async () => {
    const { entrees } = changementsFichiers(planExemple(), deplacer(planExemple(), LEXIQUE, 0), await arbreDe(exemple))
    expect(entrees).toEqual([])
  })

  it('renomme un fichier quand le titre change', async () => {
    const arbre = await arbreDe(exemple)
    const local = modifierSection(planExemple(), LE_HEURT, { titre: 'Le choc' })
    const { entrees } = changementsFichiers(planExemple(), local, arbre)
    expect(entrees).toEqual([
      { path: 'sections/le-choc.md', mode: '100644', type: 'blob', sha: arbre.get('sections/le-heurt.md') },
      { path: 'sections/le-heurt.md', mode: '100644', type: 'blob', sha: null },
    ])
  })

  it('crée un fichier vide pour une nouvelle section de texte', async () => {
    const local = creerSection(planExemple(), { type: 'texte', titre: 'Les dés', partie: 'regles', pages: 1 }, 3, 'zzz111')
    const { entrees } = changementsFichiers(planExemple(), local, await arbreDe(exemple))
    expect(entrees).toEqual([{ path: 'sections/les-des.md', mode: '100644', type: 'blob', content: '' }])
  })

  it('déplace le fichier vers corbeille/ et l’en fait revenir', async () => {
    const arbre = await arbreDe(exemple)
    const supprime = supprimerSection(planExemple(), LE_HEURT, new Date())
    expect(changementsFichiers(planExemple(), supprime, arbre).entrees).toEqual([
      { path: 'corbeille/le-heurt.md', mode: '100644', type: 'blob', sha: arbre.get('sections/le-heurt.md') },
      { path: 'sections/le-heurt.md', mode: '100644', type: 'blob', sha: null },
    ])
  })

  it('ne supprime un fichier que sur demande explicite (corbeille vidée)', async () => {
    const enCorbeille = supprimerSection(planExemple(), LE_HEURT, new Date())
    const arbre = await arbreDe({ ...exemple, 'corbeille/le-heurt.md': exemple['sections/le-heurt.md'] ?? '' })
    arbre.delete('sections/le-heurt.md')
    const vide = viderCorbeille(enCorbeille)
    expect(changementsFichiers(enCorbeille, vide, arbre).entrees).toEqual([])
    expect(changementsFichiers(enCorbeille, vide, arbre, new Set([LE_HEURT])).entrees).toEqual([
      { path: 'corbeille/le-heurt.md', mode: '100644', type: 'blob', sha: null },
    ])
  })

  it('supprimer puis vider la corbeille dans le même envoi supprime bien le fichier', async () => {
    const vide = viderCorbeille(supprimerSection(planExemple(), LE_HEURT, new Date()))
    const { entrees } = changementsFichiers(planExemple(), vide, await arbreDe(exemple), new Set([LE_HEURT]))
    expect(entrees).toEqual([{ path: 'sections/le-heurt.md', mode: '100644', type: 'blob', sha: null }])
  })

  it('une section remise par annulation n’est pas supprimée', async () => {
    const enCorbeille = supprimerSection(planExemple(), LE_HEURT, new Date())
    const { entrees } = changementsFichiers(planExemple(), enCorbeille, await arbreDe(exemple), new Set([LE_HEURT]))
    expect(entrees.filter((e) => e.sha === null).map((e) => e.path)).toEqual(['sections/le-heurt.md'])
    expect(entrees.some((e) => e.path === 'corbeille/le-heurt.md')).toBe(true)
  })

  it('ne supprime jamais le fichier d’une section qui disparaît sans passer par la corbeille', async () => {
    // Cas d'une création annulée après envoi : le fichier reste, orphelin.
    const avecNouvelle = creerSection(planExemple(), { type: 'texte', titre: 'Brouillon', partie: 'regles', pages: 1 }, 0, 'zzz111')
    const arbre = await arbreDe({ ...exemple, 'sections/brouillon.md': 'Du texte précieux.' })
    expect(changementsFichiers(avecNouvelle, planExemple(), arbre).entrees).toEqual([])
  })

  it('reprend un fichier orphelin au lieu de l’écraser', async () => {
    const arbre = await arbreDe({ ...exemple, 'sections/brouillon.md': 'Du texte précieux.' })
    const local = creerSection(planExemple(), { type: 'texte', titre: 'Brouillon', partie: 'regles', pages: 1 }, 0, 'zzz111')
    const { entrees, plan } = changementsFichiers(planExemple(), local, arbre)
    expect(entrees).toEqual([])
    expect((plan.sections[0] as SectionTexte).fichier).toBe('sections/brouillon.md')
  })

  it('n’écrase jamais un fichier existant : le chemin est suffixé et le plan corrigé', async () => {
    // Un fichier sections/le-choc.md existe déjà sur GitHub, sans section associée,
    // et on renomme « Le heurt » en « Le choc ».
    const arbre = await arbreDe({ ...exemple, 'sections/le-choc.md': 'Autre texte' })
    const local = modifierSection(planExemple(), LE_HEURT, { titre: 'Le choc' })
    const { entrees, plan } = changementsFichiers(planExemple(), local, arbre)
    expect(entrees.map((e) => e.path)).toEqual(['sections/le-choc-2.md', 'sections/le-heurt.md'])
    expect((plan.sections.find((s) => s.id === LE_HEURT) as SectionTexte).fichier).toBe('sections/le-choc-2.md')
  })

  it('échange deux noms de fichiers sans rien perdre', async () => {
    const arbre = await arbreDe(exemple)
    let local = modifierSection(planExemple(), LE_HEURT, { titre: 'Temporaire' })
    local = modifierSection(local, LEXIQUE, { titre: 'Le heurt' })
    local = modifierSection(local, LE_HEURT, { titre: 'Lexique' })
    const { entrees } = changementsFichiers(planExemple(), local, arbre)
    expect(entrees).toEqual([
      { path: 'sections/lexique.md', mode: '100644', type: 'blob', sha: arbre.get('sections/le-heurt.md') },
      { path: 'sections/le-heurt.md', mode: '100644', type: 'blob', sha: arbre.get('sections/lexique.md') },
    ])
  })

  it('crée un fichier vide si la source n’a jamais existé', async () => {
    const sansFichier: Record<string, string> = { ...exemple }
    delete sansFichier['sections/les-consequences.md']
    const local = modifierSection(planExemple(), 'm6u4og', { titre: 'Les suites' })
    const { entrees } = changementsFichiers(planExemple(), local, await arbreDe(sansFichier))
    expect(entrees).toEqual([{ path: 'sections/les-suites.md', mode: '100644', type: 'blob', content: '' }])
  })

  it('restaurer après suppression revient au point de départ', async () => {
    const aller = restaurerSection(supprimerSection(planExemple(), LE_HEURT, new Date()), LE_HEURT)
    expect(changementsFichiers(planExemple(), aller, await arbreDe(exemple)).entrees).toEqual([])
  })
})

describe('envoyer', () => {
  async function preparer() {
    const faux = await FauxGitHub.creer(exemple)
    const depot: Depot = { proprietaire: faux.proprietaire, nom: faux.nom }
    const client = creerClient(faux.jetonValide, faux.enFetch())
    const shaPlanBase = await shaBlobGit(exemple['plan.json'] ?? '')
    return { faux, depot, client, shaPlanBase }
  }

  it('écrit le plan et les fichiers en un seul commit', async () => {
    const { faux, depot, client, shaPlanBase } = await preparer()
    const local = modifierSection(planExemple(), LE_HEURT, { titre: 'Le choc' })
    const r = await envoyer(client, depot, 'main', { plan: local, shaPlanBase, message: () => 'Plan : essai', forcer: false })
    expect(r.type).toBe('envoye')
    const fichiers = faux.fichiers()
    expect(fichiers['plan.json']).toBe(serialiserPlan(local))
    expect(fichiers['sections/le-choc.md']).toBe(exemple['sections/le-heurt.md'])
    expect(fichiers['sections/le-heurt.md']).toBeUndefined()
    expect(faux.messages()).toEqual(['Plan : essai', 'Création'])
  })

  it('ne crée pas de commit s’il n’y a rien à envoyer', async () => {
    const { faux, depot, client, shaPlanBase } = await preparer()
    const r = await envoyer(client, depot, 'main', { plan: planExemple(), shaPlanBase, message: () => 'x', forcer: false })
    expect(r.type).toBe('envoye')
    expect(faux.messages()).toHaveLength(1)
  })

  it('signale un conflit si plan.json a changé sur GitHub, sans rien écrire', async () => {
    const { faux, depot, client, shaPlanBase } = await preparer()
    const ailleurs = deplacer(planExemple(), LEXIQUE, 0)
    await faux.publier({ ...exemple, 'plan.json': serialiserPlan(ailleurs) })
    const local = modifierSection(planExemple(), LE_HEURT, { statut: 'relu' })
    const r = await envoyer(client, depot, 'main', { plan: local, shaPlanBase, message: () => 'x', forcer: false })
    expect(r).toMatchObject({ type: 'conflit' })
    expect(faux.fichiers()['plan.json']).toBe(serialiserPlan(ailleurs))
  })

  it('passe outre au conflit si on le demande', async () => {
    const { faux, depot, client, shaPlanBase } = await preparer()
    await faux.publier({ ...exemple, 'plan.json': serialiserPlan(deplacer(planExemple(), LEXIQUE, 0)) })
    const local = modifierSection(planExemple(), LE_HEURT, { statut: 'relu' })
    const r = await envoyer(client, depot, 'main', { plan: local, shaPlanBase, message: () => 'x', forcer: true })
    expect(r.type).toBe('envoye')
    expect(faux.fichiers()['plan.json']).toBe(serialiserPlan(local))
  })

  it('se rebase sur un texte modifié ailleurs entre-temps, sans le perdre', async () => {
    const { faux, depot, client, shaPlanBase } = await preparer()
    // Un autre appareil a modifié le texte du heurt (pas le plan).
    await faux.publier({ ...exemple, 'sections/le-heurt.md': 'Version de l’iPad.\n' })
    const local = modifierSection(planExemple(), LE_HEURT, { titre: 'Le choc' })
    await envoyer(client, depot, 'main', { plan: local, shaPlanBase, message: () => 'x', forcer: false })
    expect(faux.fichiers()['sections/le-choc.md']).toBe('Version de l’iPad.\n')
  })

  it('recommence si la branche bouge entre la lecture et l’écriture', async () => {
    const { faux, depot, client, shaPlanBase } = await preparer()
    faux.avantMiseAJourBranche = () => faux.publier({ ...exemple, 'README.md': 'Ajout\n' })
    const local = deplacer(planExemple(), LEXIQUE, 0)
    const r = await envoyer(client, depot, 'main', { plan: local, shaPlanBase, message: () => 'Plan : x', forcer: false })
    expect(r.type).toBe('envoye')
    expect(faux.fichiers()['README.md']).toBe('Ajout\n')
    expect(faux.fichiers()['plan.json']).toBe(serialiserPlan(local))
    expect(faux.envois).toBe(2)
  })
})

describe('messageCommit', () => {
  it('écrit un message en français', () => {
    expect(messageCommit(['déplacement de Le heurt'])).toBe('Plan : déplacement de Le heurt')
    expect(messageCommit(['a', 'b', 'a'])).toBe('Plan : a, b')
    expect(messageCommit(['a', 'b', 'c', 'd', 'e'])).toBe('Plan : a, b, c et 2 autres modifications')
  })
})

describe('envoyer : textes', () => {
  async function preparer() {
    const faux = await FauxGitHub.creer(exemple)
    const depot: Depot = { proprietaire: faux.proprietaire, nom: faux.nom }
    const client = creerClient(faux.jetonValide, faux.enFetch())
    const shaPlanBase = await shaBlobGit(exemple['plan.json'] ?? '')
    const shaHeurt = await shaBlobGit(exemple['sections/le-heurt.md'] ?? '')
    return { faux, depot, client, shaPlanBase, shaHeurt }
  }

  it('écrit un texte au chemin de sa section', async () => {
    const { faux, depot, client, shaHeurt } = await preparer()
    const r = await envoyer(client, depot, 'main', {
      plan: null,
      shaPlanBase: null,
      forcer: false,
      textes: [{ id: LE_HEURT, contenu: 'Nouveau texte.\n', shaBase: shaHeurt }],
      message: () => 'Rédaction : Le heurt',
    })
    expect(r.type === 'envoye' && r.textes.get(LE_HEURT)).toEqual({ type: 'ecrit' })
    expect(faux.fichiers()['sections/le-heurt.md']).toBe('Nouveau texte.\n')
    expect(faux.fichiers()['plan.json']).toBe(exemple['plan.json'])
    expect(faux.messages()[0]).toBe('Rédaction : Le heurt')
  })

  it('renommer et écrire dans le même commit : le texte arrive au nouveau chemin', async () => {
    const { faux, depot, client, shaPlanBase, shaHeurt } = await preparer()
    await envoyer(client, depot, 'main', {
      plan: modifierSection(planExemple(), LE_HEURT, { titre: 'Le choc' }),
      shaPlanBase,
      forcer: false,
      textes: [{ id: LE_HEURT, contenu: 'Texte du choc.\n', shaBase: shaHeurt }],
      message: () => 'x',
    })
    const fichiers = faux.fichiers()
    expect(fichiers['sections/le-choc.md']).toBe('Texte du choc.\n')
    expect(fichiers['sections/le-heurt.md']).toBeUndefined()
  })

  it('écrit le texte d’une section créée dans le même envoi', async () => {
    const { faux, depot, client, shaPlanBase } = await preparer()
    const plan = creerSection(planExemple(), { type: 'texte', titre: 'Les dés', partie: 'regles', pages: 1 }, 3, 'zzz111')
    await envoyer(client, depot, 'main', {
      plan,
      shaPlanBase,
      forcer: false,
      textes: [{ id: 'zzz111', contenu: 'Six faces.\n', shaBase: null }],
      message: () => 'x',
    })
    expect(faux.fichiers()['sections/les-des.md']).toBe('Six faces.\n')
  })

  it('n’écrase jamais un texte modifié ailleurs : la version locale part dans conflits/', async () => {
    const { faux, depot, client, shaHeurt } = await preparer()
    await faux.publier({ ...exemple, 'sections/le-heurt.md': 'Version de l’iPad.\n' })
    const r = await envoyer(client, depot, 'main', {
      plan: null,
      shaPlanBase: null,
      forcer: false,
      textes: [{ id: LE_HEURT, contenu: 'Version du Mac.\n', shaBase: shaHeurt }],
      message: (conflits) => `conflits : ${conflits.join(',')}`,
      maintenant: new Date(2026, 10, 25, 14, 32),
    })
    const fichiers = faux.fichiers()
    expect(fichiers['sections/le-heurt.md']).toBe('Version de l’iPad.\n')
    expect(fichiers['conflits/le-heurt-2026-11-25-1432.md']).toBe('Version du Mac.\n')
    expect(r.type === 'envoye' && r.textes.get(LE_HEURT)).toMatchObject({
      type: 'conflit',
      chemin: 'conflits/le-heurt-2026-11-25-1432.md',
    })
    expect(faux.messages()[0]).toBe(`conflits : ${LE_HEURT}`)
  })

  it('« garder la mienne » écrit le texte et retire la sauvegarde', async () => {
    const { faux, depot, client } = await preparer()
    await faux.publier({ ...exemple, 'sections/le-heurt.md': 'iPad\n', 'conflits/le-heurt-x.md': 'Mac\n' })
    const shaIpad = await shaBlobGit('iPad\n')
    await envoyer(client, depot, 'main', {
      plan: null,
      shaPlanBase: null,
      forcer: false,
      textes: [{ id: LE_HEURT, contenu: 'Mac\n', shaBase: shaIpad, conflit: { chemin: 'conflits/le-heurt-x.md' } }],
      message: () => 'x',
    })
    const fichiers = faux.fichiers()
    expect(fichiers['sections/le-heurt.md']).toBe('Mac\n')
    expect(fichiers['conflits/le-heurt-x.md']).toBeUndefined()
  })

  it('un texte identique à celui de GitHub ne crée pas de commit', async () => {
    const { faux, depot, client, shaHeurt } = await preparer()
    await envoyer(client, depot, 'main', {
      plan: null,
      shaPlanBase: null,
      forcer: false,
      textes: [{ id: LE_HEURT, contenu: exemple['sections/le-heurt.md'] ?? '', shaBase: shaHeurt }],
      message: () => 'x',
    })
    expect(faux.messages()).toHaveLength(1)
  })

  it('message de commit pour la rédaction et le plan', () => {
    expect(messageCommit([], ['Le heurt', 'Les serments'])).toBe('Rédaction : Le heurt, Les serments')
    expect(messageCommit(['déplacement de Lexique'], ['Le heurt'])).toBe(
      'Rédaction : Le heurt ; Plan : déplacement de Lexique',
    )
    expect(messageCommit([], [], ['Le heurt'])).toBe(
      'Conflit : version de l’appareil sauvegardée dans conflits/ pour Le heurt',
    )
  })
})

describe('envoyer : fusion du plan', () => {
  it('fusionne au lieu de signaler un conflit quand la base commune est connue', async () => {
    const faux = await FauxGitHub.creer(exemple)
    const depot: Depot = { proprietaire: faux.proprietaire, nom: faux.nom }
    const client = creerClient(faux.jetonValide, faux.enFetch())
    const shaPlanBase = await shaBlobGit(exemple['plan.json'] ?? '')
    await faux.publier({ ...exemple, 'plan.json': serialiserPlan(deplacer(planExemple(), LEXIQUE, 0)) })

    const r = await envoyer(client, depot, 'main', {
      plan: modifierSection(planExemple(), LE_HEURT, { titre: 'Le choc' }),
      shaPlanBase,
      forcer: false,
      fusion: { base: planExemple(), modifieLe: new Date().toISOString() },
      message: () => 'Plan : fusion',
    })
    expect(r.type === 'envoye' && r.fusion).toEqual({ remplacements: [] })
    const plan = lirePlan(faux.fichiers()['plan.json'] ?? '')
    expect(plan.sections[0]?.id).toBe(LEXIQUE)
    expect(plan.sections.find((s) => s.id === LE_HEURT)?.titre).toBe('Le choc')
    // Le fichier suit le renommage, dans le même commit.
    expect(faux.fichiers()['sections/le-choc.md']).toBe(exemple['sections/le-heurt.md'])
  })
})
