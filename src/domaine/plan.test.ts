import { describe, expect, it } from 'vitest'
import { lireExemple } from '../test/exemple'
import { ErreurPlan, lirePlan, serialiserPlan, validerPlan } from './plan'

function planMinimal(): Record<string, unknown> {
  return {
    version: 1,
    livre: { titre: 'Essai', pagesTotal: 48, motsParPage: 350, premierePage: 'droite' },
    parties: [{ id: 'regles', titre: 'Les règles', numerotee: true }],
    sections: [
      {
        id: 'k7f3qa',
        type: 'texte',
        titre: 'Le heurt',
        fichier: 'sections/le-heurt.md',
        partie: 'regles',
        statut: 'premier-jet',
        pages: 2,
        debut: 'indifferent',
        resume: 'Le choc des volontés.',
        motsParPage: null,
      },
      {
        id: 'p2m9xd',
        type: 'hors-texte',
        titre: 'Illustration',
        partie: 'regles',
        statut: 'a-ecrire',
        pages: 1,
        debut: 'droite',
        resume: '',
      },
    ],
    corbeille: [],
  }
}

function problemes(donnees: unknown): readonly string[] {
  try {
    validerPlan(donnees)
  } catch (e) {
    if (e instanceof ErreurPlan) return e.problemes
    throw e
  }
  return []
}

function avecSection(modif: Record<string, unknown>): unknown {
  const plan = planMinimal()
  const sections = plan.sections as Record<string, unknown>[]
  sections[0] = { ...sections[0], ...modif }
  return plan
}

describe('lirePlan', () => {
  it('lit le manuscrit d’exemple', () => {
    const plan = lirePlan(lireExemple()['plan.json'] ?? '')
    expect(plan.sections).toHaveLength(10)
    expect(plan.parties.map((p) => p.id)).toEqual(['presentation', 'regles', 'lexique'])
    expect(plan.sections.filter((s) => s.type === 'hors-texte')).toHaveLength(2)
    expect(plan.sections.some((s) => s.debut === 'gauche')).toBe(true)
  })

  it('lit un plan minimal et complète les valeurs facultatives', () => {
    const brut = planMinimal()
    const sections = brut.sections as Record<string, unknown>[]
    delete sections[0]?.motsParPage
    delete sections[1]?.resume
    delete brut.corbeille
    const plan = validerPlan(brut)
    const [texte, horsTexte] = plan.sections
    expect(texte?.type === 'texte' && texte.motsParPage).toBe(null)
    expect(horsTexte?.resume).toBe('')
    expect(plan.corbeille).toEqual([])
  })

  it('refuse un texte qui n’est pas du JSON', () => {
    expect(() => lirePlan('{ pas du json')).toThrow(ErreurPlan)
  })

  it('refuse une mauvaise version', () => {
    expect(problemes({ ...planMinimal(), version: 2 })).toEqual([
      '« version » doit valoir 1 (trouvé : 2)',
    ])
  })

  it('signale tous les problèmes à la fois, en français', () => {
    const liste = problemes(avecSection({ pages: 0, statut: 'fini', id: 'TROP-LONG' }))
    expect(liste).toHaveLength(3)
    expect(liste.join('\n')).toContain('sections[0].pages : un entier supérieur ou égal à 1 est attendu')
    expect(liste.join('\n')).toContain('sections[0].statut')
    expect(liste.join('\n')).toContain('sections[0].id')
  })

  it('refuse une partie inconnue', () => {
    expect(problemes(avecSection({ partie: 'inconnue' }))).toEqual([
      'sections[0] (Le heurt) : la partie « inconnue » n’existe pas',
    ])
  })

  it('refuse un fichier hors de sections/', () => {
    expect(problemes(avecSection({ fichier: 'ailleurs/le-heurt.md' }))[0]).toContain('sections/')
  })

  it('refuse un hors-texte qui a un fichier', () => {
    const plan = planMinimal()
    const sections = plan.sections as Record<string, unknown>[]
    sections[1] = { ...sections[1], fichier: 'sections/x.md' }
    expect(problemes(plan)[0]).toContain('un hors-texte n')
  })

  it('refuse les identifiants et les fichiers en double', () => {
    const plan = planMinimal()
    const sections = plan.sections as Record<string, unknown>[]
    sections.push({ ...sections[0] })
    expect(problemes(plan)).toEqual([
      'l’identifiant « k7f3qa » est utilisé deux fois',
      'le fichier « sections/le-heurt.md » est utilisé deux fois',
    ])
  })

  it('valide la corbeille sans exiger que la partie existe encore', () => {
    const plan = planMinimal()
    plan.corbeille = [
      {
        section: {
          id: 'z9z9z9',
          type: 'texte',
          titre: 'Ancienne',
          fichier: 'corbeille/ancienne.md',
          partie: 'partie-disparue',
          statut: 'a-ecrire',
          pages: 1,
          debut: 'indifferent',
          resume: '',
          motsParPage: null,
        },
        supprimeLe: '2026-11-24T10:00:00.000Z',
        position: 3,
      },
    ]
    expect(validerPlan(plan).corbeille[0]?.position).toBe(3)
  })

  it('refuse un élément de corbeille dont le fichier n’est pas dans corbeille/', () => {
    const plan = planMinimal()
    const sections = plan.sections as Record<string, unknown>[]
    plan.corbeille = [{ section: { ...sections[0], id: 'z9z9z9', fichier: 'sections/a.md' }, supprimeLe: 'hier', position: 0 }]
    const liste = problemes(plan)
    expect(liste.some((p) => p.includes('corbeille/'))).toBe(true)
    expect(liste.some((p) => p.includes('date invalide'))).toBe(true)
  })
})

describe('réglages du livre', () => {
  it('sont facultatifs et prennent les valeurs par défaut', () => {
    const plan = validerPlan({ ...planMinimal(), reglages: { typographie: { espaceFine: true } } })
    expect(plan.reglages?.typographie).toEqual({
      apostrophe: true,
      guillemets: true,
      ponctuation: true,
      suspension: true,
      espaceFine: true,
    })
  })

  it('sont réécrits tels quels, juste après le livre', () => {
    const plan = validerPlan({ ...planMinimal(), reglages: { typographie: { suspension: false } } })
    const relu = lirePlan(serialiserPlan(plan))
    expect(relu.reglages?.typographie.suspension).toBe(false)
    expect(Object.keys(JSON.parse(serialiserPlan(plan)) as object)).toEqual([
      'version',
      'livre',
      'reglages',
      'parties',
      'sections',
      'corbeille',
    ])
  })

  it('refusent une valeur qui n’est pas vrai ou faux', () => {
    expect(problemes({ ...planMinimal(), reglages: { typographie: { apostrophe: 'oui' } } })[0]).toContain(
      'reglages.typographie.apostrophe',
    )
  })
})
