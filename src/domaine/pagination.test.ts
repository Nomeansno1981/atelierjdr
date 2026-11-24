import { describe, expect, it } from 'vitest'
import { lireExemple } from '../test/exemple'
import { cibleInsertion } from './glisser'
import { construireGrille } from './grille'
import { ordreAvecDeplacement } from './operations'
import { coteDeLaPage, paginer } from './pagination'
import { lirePlan, type Debut } from './plan'

const s = (id: string, pages: number, debut: Debut = 'indifferent') => ({ id, pages, debut, partie: 'p' })

describe('coteDeLaPage', () => {
  it('première page à droite : impaires à droite, paires à gauche', () => {
    expect([1, 2, 3, 4].map((p) => coteDeLaPage(p, 'droite'))).toEqual(['droite', 'gauche', 'droite', 'gauche'])
  })
  it('première page à gauche : l’inverse', () => {
    expect([1, 2].map((p) => coteDeLaPage(p, 'gauche'))).toEqual(['gauche', 'droite'])
  })
})

describe('paginer', () => {
  it('enchaîne les sections à partir de la page 1', () => {
    const p = paginer([s('a', 1), s('b', 2), s('c', 3)], 'droite')
    expect(Object.fromEntries(p.emplacements)).toEqual({
      a: { premiere: 1, derniere: 1 },
      b: { premiere: 2, derniere: 3 },
      c: { premiere: 4, derniere: 6 },
    })
    expect(p.blanches).toEqual([])
    expect(p.totalPages).toBe(6)
  })

  it('insère une page blanche quand la parité imposée n’est pas respectée', () => {
    // b doit commencer à gauche (page paire) mais tomberait en page 3.
    const p = paginer([s('a', 2), s('b', 2, 'gauche')], 'droite')
    expect(p.blanches).toEqual([3])
    expect(p.emplacements.get('b')).toEqual({ premiere: 4, derniere: 5 })
    expect(p.totalPages).toBe(5)
  })

  it('n’insère rien quand la parité est déjà la bonne', () => {
    const p = paginer([s('a', 1, 'droite'), s('b', 1, 'gauche'), s('c', 1, 'droite')], 'droite')
    expect(p.blanches).toEqual([])
    expect(p.totalPages).toBe(3)
  })

  it('peut insérer plusieurs blanches', () => {
    const p = paginer([s('a', 1, 'droite'), s('b', 1, 'droite'), s('c', 1, 'droite')], 'droite')
    expect(p.blanches).toEqual([2, 4])
    expect(p.totalPages).toBe(5)
  })

  it('un plan vide compte zéro page', () => {
    expect(paginer([], 'droite').totalPages).toBe(0)
  })

  it('pagine le manuscrit d’exemple : blanche en page 13, 19 pages', () => {
    const plan = lirePlan(lireExemple()['plan.json'] ?? '')
    const p = paginer(plan.sections, 'droite')
    expect(p.blanches).toEqual([13])
    expect(p.totalPages).toBe(19)
    expect(p.emplacements.get('p2m9xd')).toEqual({ premiere: 9, derniere: 9 })
    expect(p.emplacements.get('r2x9fe')).toEqual({ premiere: 14, derniere: 15 })
  })
})

describe('construireGrille', () => {
  it('page 1 seule à droite, puis des doubles pages', () => {
    const sections = [s('a', 1), s('b', 2), s('c', 1)]
    const grille = construireGrille(sections, paginer(sections, 'droite'), { pagesTotal: 4, premierePage: 'droite' })
    expect(grille.map((pl) => [pl.gauche?.numero ?? null, pl.droite?.numero ?? null])).toEqual([
      [null, 1],
      [2, 3],
      [4, null],
    ])
  })

  it('total pair : la dernière page est seule, à gauche', () => {
    const grille = construireGrille([], paginer([], 'droite'), { pagesTotal: 6, premierePage: 'droite' })
    expect(grille.at(-1)).toMatchObject({ gauche: { numero: 6 }, droite: null })
  })

  it('coupe un post-it qui déborde d’une double page et marque la suite', () => {
    const sections = [s('a', 1), s('b', 4)]
    const grille = construireGrille(sections, paginer(sections, 'droite'), { pagesTotal: 6, premierePage: 'droite' })
    // b occupe les pages 2 à 5 : planches 2-3 et 4-5.
    expect(grille[1]?.segments).toEqual([{ id: 'b', premiere: 2, derniere: 3, suite: false, continue: true }])
    expect(grille[2]?.segments).toEqual([{ id: 'b', premiere: 4, derniere: 5, suite: true, continue: false }])
  })

  it('montre les blanches, les pages libres et le dépassement', () => {
    const sections = [s('a', 2), s('b', 2, 'gauche')]
    const grille = construireGrille(sections, paginer(sections, 'droite'), { pagesTotal: 4, premierePage: 'droite' })
    const pages = grille.flatMap((pl) => [pl.gauche, pl.droite]).filter((p) => p !== null)
    expect(pages.map((p) => [p.numero, p.contenu.type, p.depasse])).toEqual([
      [1, 'section', false],
      [2, 'section', false],
      [3, 'blanche', false],
      [4, 'section', false],
      [5, 'section', true],
    ])
  })

  it('marque le début de chaque partie', () => {
    const sections = [
      { id: 'a', pages: 1, debut: 'indifferent' as const, partie: 'p1' },
      { id: 'b', pages: 1, debut: 'indifferent' as const, partie: 'p1' },
      { id: 'c', pages: 1, debut: 'indifferent' as const, partie: 'p2' },
    ]
    const grille = construireGrille(sections, paginer(sections, 'droite'), { pagesTotal: 3, premierePage: 'droite' })
    const debuts = grille.flatMap((pl) => [pl.gauche, pl.droite]).map((p) => p?.debutPartie ?? null)
    expect(debuts).toEqual([null, 'p1', null, 'p2'])
  })
})

describe('cibleInsertion', () => {
  // a(1) b(3) c(1) d(1) → a:1, b:2-4, c:5, d:6
  const ordre = [s('a', 1), s('b', 3), s('c', 1), s('d', 1)]

  function cible(idGlisse: string, index: number, page: number, fraction = 0.5) {
    const apercu = ordreAvecDeplacement(ordre, idGlisse, index)
    return cibleInsertion(apercu, paginer(apercu, 'droite'), idGlisse, { type: 'page', page, fraction })
  }

  it('reste en place au-dessus de sa propre position', () => {
    expect(cible('a', 0, 1)).toBe(0)
  })

  it('s’insère avant une section si l’on est sur sa première moitié', () => {
    // d glissé en fin : a:1, b:2-4, c:5, d:6. Pointeur en page 2 (début de b).
    expect(cible('d', 3, 2, 0.1)).toBe(1)
  })

  it('s’insère après une section si l’on est sur sa seconde moitié', () => {
    expect(cible('d', 3, 4, 0.5)).toBe(2)
  })

  it('reste stable après le décalage (pas d’oscillation)', () => {
    // a glissé sur la fin de b (page 4) → après b : ordre b, a, c, d.
    const index = cible('a', 0, 4, 0.8)
    expect(index).toBe(1)
    // Dans le nouvel aperçu, b occupe 1-3 et a la page 4 : on reste à 1.
    expect(cible('a', index, 4, 0.8)).toBe(1)
  })

  it('va en fin de grille sur une page libre', () => {
    const apercu = ordreAvecDeplacement(ordre, 'a', 0)
    expect(cibleInsertion(apercu, paginer(apercu, 'droite'), 'a', { type: 'fin' })).toBe(3)
  })

  it('une page blanche vaut le début de la section qui la suit', () => {
    const avecBlanche = [s('a', 2), s('b', 2, 'gauche'), s('c', 1)]
    // a:1-2, blanche 3, b:4-5, c:6 ; on glisse c au-dessus de la blanche.
    const p = paginer(avecBlanche, 'droite')
    expect(cibleInsertion(avecBlanche, p, 'c', { type: 'page', page: 3, fraction: 0.5 })).toBe(1)
  })
})
