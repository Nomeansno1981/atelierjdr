/**
 * Où tombe ce que l'on glisse : un post-it, ou une partie entière. Fonctions
 * pures, appelées à chaque mouvement.
 *
 * La grille ne bouge pas pendant le glissement : l'élément glissé reste à sa
 * place d'origine et une ligne rouge marque l'endroit où il s'insérera.
 *
 * On raisonne en « position de lecture » : numéro de page + fraction de la
 * largeur de la page sous le pointeur. Sur la première moitié d'une section,
 * on s'insère avant elle (ligne à son bord gauche) ; sur la seconde, après
 * elle (ligne à son bord droit). La ligne dit aussi dans quelle partie on
 * arrive : celle du post-it au bord duquel elle est dessinée. Rien ne
 * bougeant, la cible ne peut pas osciller.
 */

import type { Pagination } from './pagination'

export type PositionPointeur =
  | { type: 'page'; page: number; fraction: number }
  /** Pages libres en fin de grille, ou bouton de fin. */
  | { type: 'fin' }
  /** Bandeau d'une partie. */
  | { type: 'partie'; partie: string }

/** Où dessiner l'indication : au bord d'un post-it, ou sur le bandeau d'une partie. */
export type Repere = { type: 'postit'; id: string; cote: 'avant' | 'apres' } | { type: 'partie'; id: string }

export interface Cible {
  /** Index d'insertion, compté dans l'ordre sans le post-it glissé. */
  index: number
  /** Partie d'arrivée. */
  partie: string
  /** null quand le post-it retomberait à sa place, dans sa partie. */
  repere: Repere | null
}

interface SectionPlacee {
  id: string
  partie: string
}

const MAX = Number.MAX_SAFE_INTEGER

/**
 * @param ordre ordre affiché (celui du plan), post-it glissé compris
 * @param parties parties dans l'ordre du livre
 * @param pagination pagination de cet ordre
 */
export function cibleInsertion(
  ordre: readonly SectionPlacee[],
  parties: readonly { id: string }[],
  pagination: Pagination,
  idGlisse: string,
  position: PositionPointeur,
): Cible {
  const autres = ordre.filter((s) => s.id !== idGlisse)
  const depart = ordre.findIndex((s) => s.id === idGlisse)
  const propre = ordre[depart]?.partie ?? parties[0]?.id ?? ''
  const immobile: Cible = { index: depart, partie: propre, repere: null }
  const cible = (index: number, partie: string, repere: Repere | null): Cible =>
    index === depart && partie === propre ? immobile : { index, partie, repere }
  const enFin = () => {
    const derniere = autres.at(-1)
    return cible(
      autres.length,
      derniere?.partie ?? propre,
      derniere ? { type: 'postit', id: derniere.id, cote: 'apres' } : null,
    )
  }

  if (position.type === 'fin') return enFin()

  if (position.type === 'partie') {
    const id = position.partie
    const premiere = autres.findIndex((s) => s.partie === id)
    if (premiere !== -1) return cible(premiere, id, { type: 'partie', id })
    // Partie vide : là où elle se trouve, entre ses voisines.
    const rang = new Map(parties.map((p, i) => [p.id, i]))
    const sienne = rang.get(id) ?? MAX
    const index = autres.filter((s) => (rang.get(s.partie) ?? MAX) <= sienne).length
    return cible(index, id, { type: 'partie', id })
  }

  const { page, fraction } = position
  const glisse = pagination.emplacements.get(idGlisse)
  if (glisse && page >= glisse.premiere && page <= glisse.derniere) return immobile

  for (let i = 0; i < autres.length; i++) {
    const autre = autres[i]
    const e = autre && pagination.emplacements.get(autre.id)
    if (!autre || !e) continue
    if (page >= e.premiere && page <= e.derniere) {
      const milieu = (e.premiere + e.derniere + 1) / 2
      return page + fraction < milieu
        ? cible(i, autre.partie, { type: 'postit', id: autre.id, cote: 'avant' })
        : cible(i + 1, autre.partie, { type: 'postit', id: autre.id, cote: 'apres' })
    }
  }

  // Page blanche : elle appartient à la section qui la suit.
  if (pagination.blanches.includes(page)) {
    const suivante = ordre.find((s) => (pagination.emplacements.get(s.id)?.premiere ?? 0) > page)
    if (!suivante || suivante.id === idGlisse) return immobile
    return cible(
      autres.findIndex((s) => s.id === suivante.id),
      suivante.partie,
      { type: 'postit', id: suivante.id, cote: 'avant' },
    )
  }
  return enFin()
}

export interface CiblePartie {
  /** Index d'arrivée dans la liste des parties, compté sans la partie glissée. */
  index: number
  /** Partie voisine à l'arrivée, pour l'annoncer ; null si rien ne change. */
  voisine: { id: string; cote: 'avant' | 'apres' } | null
  repere: Repere | null
}

/** Où tombe une partie glissée : avant ou après une autre partie, entière. */
export function ciblePartie(
  ordre: readonly SectionPlacee[],
  parties: readonly { id: string }[],
  pagination: Pagination,
  idPartie: string,
  position: PositionPointeur,
): CiblePartie {
  const autres = parties.filter((p) => p.id !== idPartie)
  const depart = parties.findIndex((p) => p.id === idPartie)
  const immobile: CiblePartie = { index: depart, voisine: null, repere: null }
  const sections = (id: string) => ordre.filter((s) => s.partie === id)

  function vers(id: string, cote: 'avant' | 'apres'): CiblePartie {
    if (id === idPartie) return immobile
    const index = autres.findIndex((p) => p.id === id) + (cote === 'apres' ? 1 : 0)
    if (index === depart) return immobile
    const siennes = sections(id)
    const bord = cote === 'avant' ? siennes[0] : siennes.at(-1)
    const repere: Repere = bord ? { type: 'postit', id: bord.id, cote } : { type: 'partie', id }
    return { index, voisine: { id, cote }, repere }
  }

  if (position.type === 'fin') {
    const derniere = autres.at(-1)
    return derniere ? vers(derniere.id, 'apres') : immobile
  }
  if (position.type === 'partie') return vers(position.partie, 'avant')

  const { page, fraction } = position
  const section =
    ordre.find((s) => {
      const e = pagination.emplacements.get(s.id)
      return e !== undefined && page >= e.premiere && page <= e.derniere
    }) ??
    // Page blanche : elle appartient à la section qui la suit.
    (pagination.blanches.includes(page)
      ? ordre.find((s) => (pagination.emplacements.get(s.id)?.premiere ?? 0) > page)
      : undefined)
  if (!section) {
    const derniere = autres.at(-1)
    return derniere ? vers(derniere.id, 'apres') : immobile
  }
  // Première ou seconde moitié de toute la partie survolée.
  const siennes = sections(section.partie)
  const debut = pagination.emplacements.get(siennes[0]?.id ?? '')?.premiere ?? page
  const fin = pagination.emplacements.get(siennes.at(-1)?.id ?? '')?.derniere ?? page
  return vers(section.partie, page + fraction < (debut + fin + 1) / 2 ? 'avant' : 'apres')
}
