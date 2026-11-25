import { describe, expect, it } from 'vitest'
import { lireExemple } from '../test/exemple'
import { fusionnerPlans } from './fusionPlan'
import {
  changerPages,
  creerSection,
  deplacer,
  modifierReglages,
  modifierSection,
  restaurerSection,
  supprimerSection,
} from './operations'
import { lirePlan, serialiserPlan, validerPlan, type Plan, type SectionTexte } from './plan'

const base = (): Plan => lirePlan(lireExemple()['plan.json'] ?? '')
const ids = (p: Plan) => p.sections.map((s) => s.id)
const section = (p: Plan, id: string) => p.sections.find((s) => s.id === id)
const LE_HEURT = 'k7f3qa'
const LEXIQUE = 'l7k3pw'
const SERMENTS = 'h5d6yb'
const AVANT_PROPOS = 'v4n8hs'

function fusionner(local: Plan, distant: Plan, localPlusRecent = true) {
  const r = fusionnerPlans(base(), local, distant, localPlusRecent)
  // Le résultat est toujours un plan valide.
  expect(() => validerPlan(JSON.parse(serialiserPlan(r.plan)))).not.toThrow()
  return r
}

describe('fusionnerPlans', () => {
  it('sans changement d’un côté, reprend l’autre tel quel', () => {
    const local = changerPages(deplacer(base(), LEXIQUE, 0), LE_HEURT, 1)
    const r = fusionner(local, base())
    expect(serialiserPlan(r.plan)).toBe(serialiserPlan(local))
    expect(r.remplacements).toEqual([])
  })

  it('garde des champs différents changés de chaque côté', () => {
    const local = modifierSection(base(), LE_HEURT, { statut: 'relu' })
    const distant = modifierSection(base(), LE_HEURT, { pages: 4 })
    const r = fusionner(local, distant)
    expect(section(r.plan, LE_HEURT)).toMatchObject({ statut: 'relu', pages: 4 })
    expect(r.remplacements).toEqual([])
  })

  it('même champ changé des deux côtés : la plus récente l’emporte, et c’est signalé', () => {
    const local = modifierSection(base(), LE_HEURT, { statut: 'relu' })
    const distant = modifierSection(base(), LE_HEURT, { statut: 'definitif' })
    const recentIci = fusionner(local, distant, true)
    expect(section(recentIci.plan, LE_HEURT)?.statut).toBe('relu')
    expect(recentIci.remplacements).toEqual([
      'Le heurt : statut « Définitif » remplacé par « Relu »'.replace(/\\u00a0/g, String.fromCharCode(0xa0)),
    ])
    const recentAilleurs = fusionner(local, distant, false)
    expect(section(recentAilleurs.plan, LE_HEURT)?.statut).toBe('definitif')
  })

  it('les sections créées des deux côtés sont toutes gardées, près de leurs voisines', () => {
    const local = creerSection(base(), { type: 'texte', titre: 'Les dés', partie: 'regles', pages: 1 }, 5, 'aaa111')
    const distant = creerSection(base(), { type: 'texte', titre: 'Le destin', partie: 'regles', pages: 2 }, 7, 'bbb222')
    const r = fusionner(local, distant)
    const ordre = ids(r.plan)
    expect(ordre).toHaveLength(12)
    expect(ordre.indexOf('aaa111')).toBe(ordre.indexOf(LE_HEURT) + 1)
    expect(ordre.indexOf('bbb222')).toBe(ordre.indexOf(SERMENTS) + 1)
  })

  it('deux sections créées au même nom gardent chacune son fichier', () => {
    const local = creerSection(base(), { type: 'texte', titre: 'Les dés', partie: 'regles', pages: 1 }, 5, 'aaa111')
    const distant = creerSection(base(), { type: 'texte', titre: 'Les dés', partie: 'regles', pages: 1 }, 5, 'bbb222')
    const r = fusionner(local, distant)
    const fichier = (id: string) => (section(r.plan, id) as SectionTexte).fichier
    expect(fichier('bbb222')).toBe('sections/les-des.md') // déjà sur GitHub
    expect(fichier('aaa111')).toBe('sections/les-des-2.md')
  })

  it('une suppression d’un côté l’emporte si l’autre n’a pas touché la section', () => {
    const local = supprimerSection(base(), LEXIQUE, new Date('2026-11-25T10:00:00Z'))
    const distant = changerPages(base(), LE_HEURT, 1)
    const r = fusionner(local, distant)
    expect(ids(r.plan)).not.toContain(LEXIQUE)
    expect(r.plan.corbeille.map((e) => e.section.id)).toEqual([LEXIQUE])
    expect(section(r.plan, LE_HEURT)?.pages).toBe(3)
  })

  it('supprimée ici, modifiée ailleurs : les deux changements sont gardés, la section reste restaurable', () => {
    // L'emplacement n'a changé qu'ici, le statut qu'ailleurs : rien n'est en conflit.
    const local = supprimerSection(base(), LEXIQUE, new Date())
    const distant = modifierSection(base(), LEXIQUE, { statut: 'definitif' })
    const r = fusionner(local, distant, false)
    expect(ids(r.plan)).not.toContain(LEXIQUE)
    expect(r.plan.corbeille[0]?.section).toMatchObject({ id: LEXIQUE, statut: 'definitif', fichier: 'corbeille/lexique.md' })
    expect(r.remplacements).toEqual([])
  })

  it('mise à la corbeille ici, autre emplacement ailleurs : la plus récente l’emporte, et c’est signalé', () => {
    const local = supprimerSection(base(), LEXIQUE, new Date())
    const distant = { ...base(), sections: base().sections.filter((s) => s.id !== LEXIQUE) }
    const r = fusionner(local, distant, true)
    expect(r.plan.corbeille.map((e) => e.section.id)).toEqual([LEXIQUE])
    expect(r.remplacements[0]).toContain('Lexique : supprimée sur un appareil, dans la corbeille sur l’autre')
  })

  it('une section restaurée d’un côté revient dans le plan', () => {
    const avecCorbeille = supprimerSection(base(), LEXIQUE, new Date())
    const r = fusionnerPlans(avecCorbeille, restaurerSection(avecCorbeille, LEXIQUE), avecCorbeille, true)
    expect(ids(r.plan)).toContain(LEXIQUE)
    expect(r.plan.corbeille).toEqual([])
  })

  it('ordre changé d’un seul côté : repris ; des deux côtés : le plus récent l’emporte', () => {
    const local = deplacer(base(), LEXIQUE, 0)
    const distant = modifierSection(base(), LE_HEURT, { statut: 'relu' })
    expect(ids(fusionner(local, distant).plan)[0]).toBe(LEXIQUE)

    const autreOrdre = deplacer(base(), AVANT_PROPOS, 9)
    const r = fusionner(local, autreOrdre, false)
    expect(ids(r.plan)).toEqual(ids(autreOrdre))
    expect(r.remplacements.some((m) => m.includes('ordre des sections'))).toBe(true)
  })

  it('renommages différents d’une même section : titre et fichier du plus récent', () => {
    const local = modifierSection(base(), LE_HEURT, { titre: 'Le choc' })
    const distant = modifierSection(base(), LE_HEURT, { titre: 'La collision' })
    const r = fusionner(local, distant, true)
    expect(section(r.plan, LE_HEURT)).toMatchObject({ titre: 'Le choc', fichier: 'sections/le-choc.md' })
  })

  it('fusionne les réglages du livre champ par champ', () => {
    const reglages = { titre: 'Katastrophê', motsParPage: 350, parties: base().parties }
    const local = modifierReglages(base(), { ...reglages, titre: 'Katastrophê II' })
    const distant = modifierReglages(base(), { ...reglages, motsParPage: 300 })
    const r = fusionner(local, distant)
    expect(r.plan.livre).toMatchObject({ titre: 'Katastrophê II', motsParPage: 300 })
  })

  it('une partie retirée d’un côté revient si une section de l’autre côté y appartient', () => {
    const deplace = modifierSection(base(), LEXIQUE, { partie: 'regles' })
    const local = { ...deplace, parties: deplace.parties.filter((p) => p.id !== 'lexique') }
    const distant = creerSection(base(), { type: 'texte', titre: 'Index', partie: 'lexique', pages: 1 }, 99, 'ccc333')
    const r = fusionner(local, distant)
    expect(section(r.plan, 'ccc333')?.partie).toBe('lexique')
    expect(r.plan.parties.map((p) => p.id)).toContain('lexique')
  })
})
