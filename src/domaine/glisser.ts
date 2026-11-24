/**
 * Où tombe un post-it glissé. Fonction pure, appelée à chaque mouvement
 * sur la grille d'aperçu (celle où le post-it est déjà à sa place provisoire).
 *
 * On raisonne en « position de lecture » : numéro de page + fraction de la
 * largeur de la page sous le pointeur. Au-dessus de la première moitié d'une
 * section, on s'insère avant elle ; au-dessus de la seconde, après. Comme la
 * section survolée se décale quand on la dépasse, le pointeur se retrouve
 * alors sur le post-it glissé lui-même : la position reste stable, sans
 * oscillation, même avec des sections de tailles différentes.
 */

import type { Pagination } from './pagination'

export type PositionPointeur =
  | { type: 'page'; page: number; fraction: number }
  /** Pages libres en fin de grille, ou bouton de fin. */
  | { type: 'fin' }

/**
 * @param ordreApercu ordre affiché, post-it glissé compris
 * @param pagination pagination de cet ordre
 * @returns index d'insertion, compté dans l'ordre sans le post-it glissé
 */
export function cibleInsertion(
  ordreApercu: readonly { id: string }[],
  pagination: Pagination,
  idGlisse: string,
  position: PositionPointeur,
): number {
  const autres = ordreApercu.filter((s) => s.id !== idGlisse)
  const actuel = ordreApercu.findIndex((s) => s.id === idGlisse)
  if (position.type === 'fin') return autres.length

  const { page, fraction } = position
  const glisse = pagination.emplacements.get(idGlisse)
  if (glisse && page >= glisse.premiere && page <= glisse.derniere) return actuel

  for (let i = 0; i < autres.length; i++) {
    const autre = autres[i]
    const e = autre && pagination.emplacements.get(autre.id)
    if (!e) continue
    if (page >= e.premiere && page <= e.derniere) {
      const milieu = (e.premiere + e.derniere + 1) / 2
      return page + fraction < milieu ? i : i + 1
    }
  }

  // Page blanche : elle appartient à la section qui la suit.
  if (pagination.blanches.includes(page)) {
    const suivante = ordreApercu.find((s) => (pagination.emplacements.get(s.id)?.premiere ?? 0) > page)
    if (!suivante || suivante.id === idGlisse) return actuel
    return autres.findIndex((s) => s.id === suivante.id)
  }
  return autres.length
}
