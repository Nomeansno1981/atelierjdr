import { describe, expect, it } from 'vitest'
import { rechercher } from './recherche'
import { titresReserves } from './titres'

const NBSP = String.fromCharCode(0xa0)

describe('titresReserves', () => {
  it('repère # et ##, pas ### et suivants', () => {
    const texte = '# Un\n\nTexte.\n\n## Deux\n\n### Trois\n\n#### Quatre\n'
    expect(titresReserves(texte).map((t) => [t.ligne, t.niveau])).toEqual([
      [1, 1],
      [5, 2],
    ])
  })

  it('repère aussi les titres soulignés', () => {
    expect(titresReserves('Titre\n=====\n\nAutre\n-----\n').map((t) => t.niveau)).toEqual([1, 2])
  })

  it('ignore un # dans un bloc de code ou au milieu d’une ligne', () => {
    expect(titresReserves('```\n# commentaire\n```\n\nLe #1 du classement.\n')).toEqual([])
  })
})

describe('rechercher', () => {
  const sections = [
    { id: 'a', titre: 'Le heurt', texte: `Un élève dit${NBSP}: «${NBSP}Non${NBSP}!${NBSP}»` },
    { id: 'b', titre: 'Les serments', texte: 'Le serment, puis un autre serment.' },
    { id: 'c', titre: 'Vide', texte: '' },
  ]

  it('ne tient compte ni de la casse ni des accents', () => {
    const r = rechercher(sections, 'ELEVE')
    expect(r).toHaveLength(1)
    expect(r[0]?.occurrences[0]).toMatchObject({ trouve: 'élève', debut: 3, fin: 8 })
  })

  it('confond espaces ordinaires et insécables', () => {
    expect(rechercher(sections, 'Non !')[0]?.occurrences[0]?.trouve).toBe(`Non${NBSP}!`)
  })

  it('groupe les occurrences par section', () => {
    const r = rechercher(sections, 'serment')
    expect(r.map((s) => [s.id, s.occurrences.length])).toEqual([['b', 2]])
    expect(r[0]?.occurrences[1]).toMatchObject({ debut: 26, avant: 'Le serment, puis un autre ', apres: '.' })
  })

  it('ignore une requête d’un seul caractère', () => {
    expect(rechercher(sections, 'e')).toEqual([])
  })

  it('coupe le contexte trop long avec des points de suspension', () => {
    const long = 'mot '.repeat(30) + 'cible' + ' mot'.repeat(30)
    const o = rechercher([{ id: 'x', titre: 'x', texte: long }], 'cible')[0]?.occurrences[0]
    expect(o?.avant.startsWith('…')).toBe(true)
    expect(o?.apres.endsWith('…')).toBe(true)
  })
})
