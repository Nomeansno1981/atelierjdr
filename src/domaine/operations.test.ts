import { describe, expect, it } from 'vitest'
import { lireExemple } from '../test/exemple'
import {
  changerPages,
  creerSection,
  deplacer,
  modifierReglages,
  modifierSection,
  nouveauPlan,
  nouvelId,
  restaurerSection,
  supprimerSection,
  viderCorbeille,
} from './operations'
import { MODELE_PAR_DEFAUT, modelePourTitre, modeleValide } from './compilation'
import { lirePlan, reglesTypo, serialiserPlan, validerPlan, type Plan, type SectionTexte } from './plan'

const texteExemple = lireExemple()['plan.json'] ?? ''
const exemple = (): Plan => lirePlan(texteExemple)
const ids = (p: Plan) => p.sections.map((s) => s.id)
const texte = (p: Plan, id: string) => p.sections.find((s) => s.id === id) as SectionTexte
const LE_HEURT = 'k7f3qa'
const LEXIQUE = 'l7k3pw'

describe('serialiserPlan', () => {
  it('relire puis réécrire le plan d’exemple donne exactement les mêmes octets', () => {
    expect(serialiserPlan(exemple())).toBe(texteExemple)
  })
})

describe('opérations', () => {
  it('ne modifient jamais le plan reçu', () => {
    const plan = exemple()
    const avant = serialiserPlan(plan)
    deplacer(plan, LE_HEURT, 0)
    modifierSection(plan, LE_HEURT, { titre: 'Autre' })
    supprimerSection(plan, LE_HEURT, new Date())
    expect(serialiserPlan(plan)).toBe(avant)
  })

  it('produisent toujours un plan valide', () => {
    let plan = exemple()
    plan = deplacer(plan, LEXIQUE, 0)
    plan = changerPages(plan, LE_HEURT, 2)
    plan = creerSection(plan, { type: 'texte', titre: 'Le heurt', partie: 'regles', pages: 1 }, 3, 'zzz111')
    plan = supprimerSection(plan, 'zzz111', new Date('2026-11-24T10:00:00Z'))
    plan = restaurerSection(plan, 'zzz111')
    expect(() => validerPlan(JSON.parse(serialiserPlan(plan)))).not.toThrow()
  })

  it('déplace une section à un index', () => {
    const plan = deplacer(exemple(), LEXIQUE, 0)
    expect(ids(plan)[0]).toBe(LEXIQUE)
    expect(plan.sections).toHaveLength(10)
    expect(deplacer(plan, LEXIQUE, 0)).toBe(plan)
  })

  it('change le budget de pages sans descendre sous 1', () => {
    const plan = exemple()
    expect(texte(changerPages(plan, LE_HEURT, 1), LE_HEURT).pages).toBe(3)
    expect(changerPages(changerPages(plan, LE_HEURT, -5), LE_HEURT, 0)).toBeDefined()
    expect(texte(changerPages(plan, LE_HEURT, -5), LE_HEURT).pages).toBe(1)
  })

  it('renomme le fichier quand le titre change', () => {
    const plan = modifierSection(exemple(), LE_HEURT, { titre: 'Le choc' })
    expect(texte(plan, LE_HEURT).fichier).toBe('sections/le-choc.md')
  })

  it('garde le fichier si seule la casse ou la ponctuation change', () => {
    const plan = modifierSection(exemple(), LE_HEURT, { titre: 'Le Heurt !' })
    expect(texte(plan, LE_HEURT).fichier).toBe('sections/le-heurt.md')
  })

  it('suffixe le fichier si le nouveau titre en rejoint un autre', () => {
    const plan = modifierSection(exemple(), LE_HEURT, { titre: 'Lexique' })
    expect(texte(plan, LE_HEURT).fichier).toBe('sections/lexique-2.md')
  })

  it('ignore un titre vide et une partie inconnue', () => {
    const plan = modifierSection(exemple(), LE_HEURT, { titre: '  ', partie: 'nulle-part' })
    expect(texte(plan, LE_HEURT)).toMatchObject({ titre: 'Le heurt', partie: 'regles' })
  })

  it('crée une section de texte avec un fichier libre', () => {
    const plan = creerSection(exemple(), { type: 'texte', titre: 'Le heurt', partie: 'regles', pages: 2 }, 5, 'zzz111')
    expect(ids(plan)[5]).toBe('zzz111')
    expect(texte(plan, 'zzz111')).toMatchObject({
      fichier: 'sections/le-heurt-2.md',
      statut: 'a-ecrire',
      pages: 2,
      debut: 'indifferent',
      motsParPage: null,
    })
  })

  it('crée un hors-texte sans fichier', () => {
    const plan = creerSection(exemple(), { type: 'hors-texte', titre: 'Fiche', partie: 'regles', pages: 1 }, 99, 'zzz111')
    // Demandée en fin de grille mais dans « Les règles » : elle se range à la fin de sa partie, avant le Lexique.
    expect(plan.sections.at(-2)).toMatchObject({ id: 'zzz111', type: 'hors-texte' })
    expect('fichier' in (plan.sections.at(-2) ?? {})).toBe(false)
  })

  it('envoie à la corbeille avec date, position et fichier déplacé', () => {
    const plan = supprimerSection(exemple(), LE_HEURT, new Date('2026-11-24T10:00:00Z'))
    expect(ids(plan)).not.toContain(LE_HEURT)
    expect(plan.corbeille[0]).toMatchObject({
      supprimeLe: '2026-11-24T10:00:00.000Z',
      position: 4,
      section: { id: LE_HEURT, fichier: 'corbeille/le-heurt.md' },
    })
  })

  it('restaure à la position d’origine', () => {
    const supprime = supprimerSection(exemple(), LE_HEURT, new Date())
    const plan = restaurerSection(supprime, LE_HEURT)
    expect(ids(plan)).toEqual(ids(exemple()))
    expect(texte(plan, LE_HEURT).fichier).toBe('sections/le-heurt.md')
    expect(plan.corbeille).toEqual([])
  })

  it('restaure en fin de grille si la position n’existe plus', () => {
    let plan = supprimerSection(exemple(), LEXIQUE, new Date()) // position 9
    for (const id of ids(plan).slice(0, 3)) plan = supprimerSection(plan, id, new Date())
    plan = restaurerSection(plan, LEXIQUE)
    expect(ids(plan).at(-1)).toBe(LEXIQUE)
  })

  it('vide la corbeille', () => {
    const plan = viderCorbeille(supprimerSection(exemple(), LE_HEURT, new Date()))
    expect(plan.corbeille).toEqual([])
  })

  it('garde une partie qui contient encore des sections', () => {
    const plan = exemple()
    const sansRegles = plan.parties.filter((p) => p.id !== 'regles')
    const modifie = modifierReglages(plan, { titre: 'K', motsParPage: 300, parties: sansRegles })
    expect(modifie.parties.map((p) => p.id)).toContain('regles')
    expect(modifie.livre).toMatchObject({ titre: 'K', motsParPage: 300, premierePage: 'droite' })
  })

  it('tire un identifiant libre de 6 caractères', () => {
    const id = nouvelId(exemple())
    expect(id).toMatch(/^[a-z0-9]{6}$/)
    // Un générateur qui propose d'abord un identifiant pris : il en tire un autre.
    const suite = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
    const plan = creerSection(exemple(), { type: 'texte', titre: 'x', partie: 'regles', pages: 1 }, 0, 'aaaaaa')
    expect(nouvelId(plan, () => suite.shift() ?? 0)).toBe('ssssss')
  })
})

describe('déplacer : la partie suit la place', () => {
  const AVANT_PROPOS = 'v4n8hs'
  const CREER = 's8q1lz'
  const partie = (p: Plan, id: string) => p.sections.find((s) => s.id === id)?.partie

  it('au milieu d’une autre partie, la section en prend la partie', () => {
    // Avant-propos entre « Créer son personnage » et « Le heurt » (Les règles).
    const plan = deplacer(exemple(), AVANT_PROPOS, 3)
    expect(ids(plan).slice(2, 5)).toEqual([CREER, AVANT_PROPOS, LE_HEURT])
    expect(partie(plan, AVANT_PROPOS)).toBe('regles')
  })

  it('à la frontière de sa propre partie, elle garde la sienne', () => {
    // « Le heurt » remonté en tête des règles, entre « Qu’est-ce que
    // Katastrophê ? » (Présentation) et « Créer son personnage » (Les règles).
    const plan = deplacer(exemple(), LE_HEURT, 3)
    expect(ids(plan).slice(2, 5)).toEqual(['c3w7mj', LE_HEURT, CREER])
    expect(partie(plan, LE_HEURT)).toBe('regles')
  })

  it('à la frontière de deux autres parties, elle prend celle de la précédente', () => {
    // Lexique placé entre la Présentation et Les règles.
    const plan = deplacer(exemple(), LEXIQUE, 3)
    expect(partie(plan, LEXIQUE)).toBe('presentation')
  })

  it('en tête du livre, elle prend la partie de la section suivante', () => {
    const plan = deplacer(exemple(), LEXIQUE, 0)
    expect(partie(plan, LEXIQUE)).toBe('presentation')
  })
})

describe('page blanche', () => {
  it('se crée sans titre, sans fichier, d’emblée définitive', () => {
    const plan = creerSection(exemple(), { type: 'blanche', titre: '', partie: 'presentation', pages: 1 }, 1, 'zzz111')
    expect(plan.sections[1]).toEqual({
      id: 'zzz111',
      type: 'blanche',
      titre: 'Page blanche',
      partie: 'presentation',
      statut: 'definitif',
      pages: 1,
      debut: 'indifferent',
      resume: '',
    })
    expect(() => validerPlan(JSON.parse(serialiserPlan(plan)))).not.toThrow()
  })
})

describe('nouveau livre', () => {
  it('un plan valide : parties dans l’ordre, aucune section, nom des compilations tiré du titre', () => {
    const plan = nouveauPlan({
      titre: ' Les Ombres de l’Été ',
      motsParPage: 320,
      parties: ['Prologue', '', 'Les règles', 'Les règles'],
    })
    expect(lirePlan(serialiserPlan(plan))).toEqual(plan)
    expect(plan.livre).toEqual({ titre: 'Les Ombres de l’Été', motsParPage: 320, premierePage: 'droite' })
    expect(plan.parties.map((p) => [p.id, p.titre])).toEqual([
      ['prologue', 'Prologue'],
      ['les-regles', 'Les règles'],
      ['les-regles-2', 'Les règles'],
    ])
    expect(plan.sections).toEqual([])
    expect(plan.reglages?.compilation?.modele).toBe('Les_Ombres_de_l_Ete__v{n}.md')
  })

  it('reprend les règles typographiques qu’on lui donne', () => {
    const typo = { ...reglesTypo(exemple()), espaceFine: true }
    expect(nouveauPlan({ titre: 'X', motsParPage: 300, parties: ['A'] }, typo).reglages?.typographie).toEqual(typo)
  })

  it('sans partie saisie, une « Première partie »', () => {
    const plan = nouveauPlan({ titre: 'X', motsParPage: 300, parties: ['  '] })
    expect(plan.parties).toEqual([{ id: 'partie', titre: 'Première partie', numerotee: true }])
  })

  it('« Katastrophê » donne le modèle par défaut', () => {
    expect(modelePourTitre('Katastrophê')).toBe(MODELE_PAR_DEFAUT)
    expect(modeleValide(modelePourTitre('???'))).toBe(true)
  })
})
