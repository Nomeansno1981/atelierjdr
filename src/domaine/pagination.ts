/**
 * Pagination du livre : fonction pure. On ne place pas une section à une
 * page précise, on choisit son ordre ; les pages se calculent.
 */

import type { Cote, Debut } from './plan'

export interface Emplacement {
  premiere: number
  derniere: number
}

export interface Pagination {
  emplacements: ReadonlyMap<string, Emplacement>
  /** Pages blanches insérées pour respecter le début d'une section. */
  blanches: readonly number[]
  /** Dernière page attribuée (0 pour un plan vide). */
  totalPages: number
}

/** Avec une première page à droite, les impaires sont à droite. */
export function coteDeLaPage(page: number, premierePage: Cote): Cote {
  const impaire = page % 2 === 1
  return impaire === (premierePage === 'droite') ? 'droite' : 'gauche'
}

export function paginer(
  sections: readonly { id: string; pages: number; debut: Debut }[],
  premierePage: Cote,
): Pagination {
  const emplacements = new Map<string, Emplacement>()
  const blanches: number[] = []
  let page = 1
  for (const s of sections) {
    if (s.debut !== 'indifferent' && coteDeLaPage(page, premierePage) !== s.debut) {
      blanches.push(page)
      page++
    }
    emplacements.set(s.id, { premiere: page, derniere: page + s.pages - 1 })
    page += s.pages
  }
  return { emplacements, blanches, totalPages: page - 1 }
}
