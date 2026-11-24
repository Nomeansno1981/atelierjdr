/**
 * Chemin de fer : découpe la pagination en doubles pages (« planches »),
 * comme le panneau Pages d'InDesign. Fonction pure.
 */

import { coteDeLaPage, type Pagination } from './pagination'
import type { Cote, Livre } from './plan'

export type ContenuPage =
  | { type: 'section'; id: string }
  | { type: 'blanche' }
  /** Page prévue au budget mais pas encore attribuée. */
  | { type: 'libre' }

export interface PageGrille {
  numero: number
  cote: Cote
  contenu: ContenuPage
  /** Au-delà de `pagesTotal`. */
  depasse: boolean
  /** Identifiant de la partie qui commence sur cette page, le cas échéant. */
  debutPartie: string | null
}

/** Partie d'une section visible sur une planche. */
export interface Segment {
  id: string
  premiere: number
  derniere: number
  /** Ce segment continue une section commencée sur une planche précédente. */
  suite: boolean
  /** La section continue sur la planche suivante. */
  continue: boolean
}

export interface Planche {
  cle: string
  gauche: PageGrille | null
  droite: PageGrille | null
  segments: Segment[]
}

export function construireGrille(
  sections: readonly { id: string; partie: string }[],
  pagination: Pagination,
  livre: Pick<Livre, 'pagesTotal' | 'premierePage'>,
): Planche[] {
  const nbPages = Math.max(pagination.totalPages, livre.pagesTotal)
  const contenus = new Map<number, ContenuPage>()
  const debutsPartie = new Map<number, string>()
  let partiePrecedente: string | null = null

  for (const s of sections) {
    const e = pagination.emplacements.get(s.id)
    if (!e) continue
    for (let p = e.premiere; p <= e.derniere; p++) contenus.set(p, { type: 'section', id: s.id })
    if (s.partie !== partiePrecedente) debutsPartie.set(e.premiere, s.partie)
    partiePrecedente = s.partie
  }
  for (const b of pagination.blanches) contenus.set(b, { type: 'blanche' })

  const planches: Planche[] = []
  const indexPlanche = (n: number) =>
    livre.premierePage === 'droite' ? Math.floor(n / 2) : Math.floor((n - 1) / 2)

  for (let n = 1; n <= nbPages; n++) {
    const i = indexPlanche(n)
    let planche = planches[i]
    if (!planche) {
      planche = { cle: `planche-${i}`, gauche: null, droite: null, segments: [] }
      planches[i] = planche
    }
    const page: PageGrille = {
      numero: n,
      cote: coteDeLaPage(n, livre.premierePage),
      contenu: contenus.get(n) ?? { type: 'libre' },
      depasse: n > livre.pagesTotal,
      debutPartie: debutsPartie.get(n) ?? null,
    }
    planche[page.cote] = page
  }

  for (const planche of planches) {
    for (const page of [planche.gauche, planche.droite]) {
      if (page?.contenu.type !== 'section') continue
      const id = page.contenu.id
      const dernier = planche.segments.at(-1)
      if (dernier?.id === id && dernier.derniere === page.numero - 1) {
        dernier.derniere = page.numero
      } else {
        planche.segments.push({ id, premiere: page.numero, derniere: page.numero, suite: false, continue: false })
      }
    }
    for (const seg of planche.segments) {
      const e = pagination.emplacements.get(seg.id)
      if (!e) continue
      seg.suite = seg.premiere > e.premiere
      seg.continue = seg.derniere < e.derniere
    }
  }
  return planches
}
