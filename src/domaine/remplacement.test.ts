import { describe, expect, it } from 'vitest'
import { lireExemple } from '../test/exemple'
import { lirePlan, type SectionTexte } from './plan'
import { adapterCasse, rechercherPartout, remplacerDans, remplacerDansLePlan, type OccurrenceChoisie } from './remplacement'

const exemple = () => lirePlan(lireExemple()['plan.json'] ?? '')
const LE_HEURT = 'k7f3qa'

describe('adapterCasse', () => {
  it('majuscule initiale, capitales, ou tel quel', () => {
    expect(adapterCasse('Heurt', 'choc')).toBe('Choc')
    expect(adapterCasse('HEURT', 'choc')).toBe('CHOC')
    expect(adapterCasse('heurt', 'choc')).toBe('choc')
    expect(adapterCasse('heurt', 'Choc')).toBe('Choc')
    expect(adapterCasse('Élan', 'échappée')).toBe('Échappée')
  })
})

describe('remplacerDans', () => {
  it('remplace les occurrences choisies, de la fin vers le début', () => {
    const texte = 'Le heurt. Un Heurt ! Les heurts.'
    const occ = [
      { debut: 3, fin: 8, trouve: 'heurt' },
      { debut: 13, fin: 18, trouve: 'Heurt' },
    ]
    expect(remplacerDans(texte, occ, 'choc')).toBe('Le choc. Un Choc ! Les heurts.')
  })

  it('ne touche pas un passage qui a changé depuis la recherche', () => {
    expect(remplacerDans('Le choc.', [{ debut: 3, fin: 8, trouve: 'heurt' }], 'x')).toBe('Le choc.')
  })
})

describe('rechercherPartout', () => {
  it('trouve dans les textes, les titres et les résumés, sans limite', () => {
    const plan = exemple()
    const textes = new Map([[LE_HEURT, 'heurt '.repeat(250)]])
    const r = rechercherPartout(plan, textes, 'heurt')
    const texte = r.find((x) => x.id === LE_HEURT && x.champ === 'texte')
    expect(texte?.occurrences).toHaveLength(250)
    expect(r.find((x) => x.id === LE_HEURT && x.champ === 'titre')?.occurrences[0]?.trouve).toBe('heurt')
  })

  it('mot entier : « heurt » ne trouve plus « heurter »', () => {
    const textes = new Map([[LE_HEURT, 'heurt, heurter, heurts']])
    const tous = rechercherPartout(exemple(), textes, 'heurt').find((x) => x.champ === 'texte')
    expect(tous?.occurrences.map((o) => o.trouve)).toEqual(['heurt', 'heurt', 'heurt'])
    const entiers = rechercherPartout(exemple(), textes, 'heurt', true).find((x) => x.champ === 'texte')
    expect(entiers?.occurrences.map((o) => o.debut)).toEqual([0])
  })
})

describe('remplacerDansLePlan', () => {
  it('renomme le titre (et son fichier) et le résumé', () => {
    const plan = exemple()
    const choix: OccurrenceChoisie[] = [{ id: LE_HEURT, champ: 'titre', debut: 3, fin: 8, trouve: 'heurt' }]
    const apres = remplacerDansLePlan(plan, choix, 'choc')
    const section = apres.sections.find((s) => s.id === LE_HEURT) as SectionTexte
    expect(section.titre).toBe('Le choc')
    expect(section.fichier).toBe('sections/le-choc.md')
  })
})
