/**
 * Où tombe un post-it glissé. Fonction pure, appelée à chaque mouvement.
 *
 * La grille ne bouge pas pendant le glissement : le post-it glissé reste à
 * sa place d'origine et une ligne rouge marque l'endroit où il s'insérera.
 *
 * On raisonne en « position de lecture » : numéro de page + fraction de la
 * largeur de la page sous le pointeur. Sur la première moitié d'une section,
 * on s'insère avant elle (ligne à son bord gauche) ; sur la seconde, après
 * elle (ligne à son bord droit). Rien ne bougeant, la cible ne peut pas
 * osciller.
 */

import type { Pagination } from './pagination'

export type PositionPointeur =
  | { type: 'page'; page: number; fraction: number }
  /** Pages libres en fin de grille, ou bouton de fin. */
  | { type: 'fin' }

/** Bord d'un post-it où dessiner la ligne d'insertion. */
export interface Repere {
  id: string
  cote: 'avant' | 'apres'
}

export interface Cible {
  /** Index d'insertion, compté dans l'ordre sans le post-it glissé. */
  index: number
  /** null quand le post-it retomberait à sa place actuelle. */
  repere: Repere | null
}

/**
 * @param ordre ordre affiché (celui du plan), post-it glissé compris
 * @param pagination pagination de cet ordre
 */
export function cibleInsertion(
  ordre: readonly { id: string }[],
  pagination: Pagination,
  idGlisse: string,
  position: PositionPointeur,
): Cible {
  const autres = ordre.filter((s) => s.id !== idGlisse)
  const depart = ordre.findIndex((s) => s.id === idGlisse)
  const resultat = (index: number, repere: Repere | null): Cible =>
    index === depart ? { index, repere: null } : { index, repere }
  const derniere = autres.at(-1)
  const enFin = () => resultat(autres.length, derniere ? { id: derniere.id, cote: 'apres' } : null)

  if (position.type === 'fin') return enFin()

  const { page, fraction } = position
  const glisse = pagination.emplacements.get(idGlisse)
  if (glisse && page >= glisse.premiere && page <= glisse.derniere) return { index: depart, repere: null }

  for (let i = 0; i < autres.length; i++) {
    const autre = autres[i]
    const e = autre && pagination.emplacements.get(autre.id)
    if (!autre || !e) continue
    if (page >= e.premiere && page <= e.derniere) {
      const milieu = (e.premiere + e.derniere + 1) / 2
      return page + fraction < milieu
        ? resultat(i, { id: autre.id, cote: 'avant' })
        : resultat(i + 1, { id: autre.id, cote: 'apres' })
    }
  }

  // Page blanche : elle appartient à la section qui la suit.
  if (pagination.blanches.includes(page)) {
    const suivante = ordre.find((s) => (pagination.emplacements.get(s.id)?.premiere ?? 0) > page)
    if (!suivante || suivante.id === idGlisse) return { index: depart, repere: null }
    return resultat(
      autres.findIndex((s) => s.id === suivante.id),
      { id: suivante.id, cote: 'avant' },
    )
  }
  return enFin()
}
