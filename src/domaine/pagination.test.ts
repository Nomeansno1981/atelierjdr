import { describe, expect, it } from 'vitest'
import { lireExemple } from '../test/exemple'
import { cibleInsertion, ciblePartie } from './glisser'
import { construireGrille } from './grille'
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
  // a(1) b(3) c(1) d(1) → a:1, b:2-4, c:5, d:6. Parties : p (a, b), q (c, d), puis r, vide.
  const ordre = [s('a', 1), s('b', 3), { ...s('c', 1), partie: 'q' }, { ...s('d', 1), partie: 'q' }]
  const parties = [{ id: 'p' }, { id: 'q' }, { id: 'r' }]
  const pagination = paginer(ordre, 'droite')

  function cible(idGlisse: string, page: number, fraction = 0.5) {
    return cibleInsertion(ordre, parties, pagination, idGlisse, { type: 'page', page, fraction })
  }

  it('reste en place au-dessus de sa propre position, sans ligne', () => {
    expect(cible('a', 1)).toEqual({ index: 0, partie: 'p', repere: null })
    expect(cible('b', 3)).toEqual({ index: 1, partie: 'p', repere: null })
  })

  it('s’insère avant une section si l’on est sur sa première moitié : ligne à son bord gauche', () => {
    expect(cible('d', 2, 0.1)).toEqual({ index: 1, partie: 'p', repere: { type: 'postit', id: 'b', cote: 'avant' } })
  })

  it('s’insère après une section si l’on est sur sa seconde moitié : ligne à son bord droit', () => {
    expect(cible('d', 4, 0.5)).toEqual({ index: 2, partie: 'p', repere: { type: 'postit', id: 'b', cote: 'apres' } })
  })

  it('juste avant ou juste après sa propre place, dans sa partie : rien ne change', () => {
    expect(cible('b', 1, 0.8)).toEqual({ index: 1, partie: 'p', repere: null })
  })

  it('à la frontière de deux parties, le côté de la ligne dit la partie d’arrivée', () => {
    // b est la dernière de p : sur le début de c, elle passe dans q sans changer de rang.
    expect(cible('b', 5, 0.2)).toEqual({ index: 1, partie: 'q', repere: { type: 'postit', id: 'c', cote: 'avant' } })
    // c est la première de q : sur la fin de b, elle passe dans p.
    expect(cible('c', 4, 0.9)).toEqual({ index: 2, partie: 'p', repere: { type: 'postit', id: 'b', cote: 'apres' } })
  })

  it('va en fin de grille sur une page libre : ligne après la dernière section', () => {
    expect(cibleInsertion(ordre, parties, pagination, 'a', { type: 'fin' })).toEqual({
      index: 3,
      partie: 'q',
      repere: { type: 'postit', id: 'd', cote: 'apres' },
    })
    expect(cibleInsertion(ordre, parties, pagination, 'd', { type: 'fin' })).toEqual({ index: 3, partie: 'q', repere: null })
  })

  it('sur le bandeau d’une partie : en tête de cette partie, ou dans la partie vide', () => {
    expect(cibleInsertion(ordre, parties, pagination, 'a', { type: 'partie', partie: 'q' })).toEqual({
      index: 1,
      partie: 'q',
      repere: { type: 'partie', id: 'q' },
    })
    expect(cibleInsertion(ordre, parties, pagination, 'a', { type: 'partie', partie: 'r' })).toEqual({
      index: 3,
      partie: 'r',
      repere: { type: 'partie', id: 'r' },
    })
  })

  it('une page blanche vaut le début de la section qui la suit', () => {
    const avecBlanche = [s('a', 2), s('b', 2, 'gauche'), s('c', 1)]
    // a:1-2, blanche 3, b:4-5, c:6 ; on glisse c au-dessus de la blanche.
    const p = paginer(avecBlanche, 'droite')
    expect(cibleInsertion(avecBlanche, [{ id: 'p' }], p, 'c', { type: 'page', page: 3, fraction: 0.5 })).toEqual({
      index: 1,
      partie: 'p',
      repere: { type: 'postit', id: 'b', cote: 'avant' },
    })
  })
})

describe('ciblePartie', () => {
  // p : a(1) b(3) → pages 1-4 ; q : c(1) d(1) → 5-6 ; r vide.
  const ordre = [s('a', 1), s('b', 3), { ...s('c', 1), partie: 'q' }, { ...s('d', 1), partie: 'q' }]
  const parties = [{ id: 'p' }, { id: 'q' }, { id: 'r' }]
  const pagination = paginer(ordre, 'droite')
  const cible = (id: string, page: number, fraction = 0.5) =>
    ciblePartie(ordre, parties, pagination, id, { type: 'page', page, fraction })

  it('sur la première section d’une autre partie : placée entière avant elle', () => {
    expect(cible('q', 1)).toEqual({ action: { type: 'bloc', index: 0 }, repere: { type: 'postit', id: 'a', cote: 'avant' } })
  })

  it('sur une section au milieu d’une autre partie : elle y commence, quel que soit le côté visé', () => {
    expect(cible('q', 3, 0.9)).toEqual({ action: { type: 'debut', section: 'b' }, repere: { type: 'postit', id: 'b', cote: 'avant' } })
    expect(cible('r', 2, 0.1)).toEqual({ action: { type: 'debut', section: 'b' }, repere: { type: 'postit', id: 'b', cote: 'avant' } })
  })

  it('sur une de ses propres sections : son début recule (s’il y a une partie avant elle)', () => {
    expect(cible('q', 6)).toEqual({ action: { type: 'debut', section: 'd' }, repere: { type: 'postit', id: 'd', cote: 'avant' } })
    expect(cible('p', 2)).toEqual({ action: null, repere: null })
    expect(cible('q', 5)).toEqual({ action: null, repere: null })
  })

  it('sur le bandeau d’une autre partie : avant elle ; sur le sien : rien', () => {
    expect(ciblePartie(ordre, parties, pagination, 'p', { type: 'partie', partie: 'r' })).toEqual({
      action: { type: 'bloc', index: 1 },
      repere: { type: 'partie', id: 'r' },
    })
    expect(ciblePartie(ordre, parties, pagination, 'r', { type: 'partie', partie: 'r' })).toEqual({ action: null, repere: null })
  })

  it('en fin de grille : après la dernière partie', () => {
    expect(ciblePartie(ordre, parties, pagination, 'p', { type: 'fin' })).toEqual({
      action: { type: 'bloc', index: 2 },
      repere: { type: 'postit', id: 'd', cote: 'apres' },
    })
    expect(ciblePartie(ordre, parties, pagination, 'r', { type: 'fin' })).toEqual({ action: null, repere: null })
  })
})
