/**
 * Les titres de niveau 1 et 2 (`#`, `##`) sont réservés à la compilation :
 * une section commence ses intertitres à `###`. Cette fonction repère ceux
 * qui ont été saisis, pour que l'éditeur les signale.
 */

import { parser as parseurCommonMark, Table } from '@lezer/markdown'

const parseur = parseurCommonMark.configure([Table])

const RESERVES: Record<string, 1 | 2> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  SetextHeading1: 1,
  SetextHeading2: 2,
}

export interface TitreReserve {
  /** Numéro de ligne, à partir de 1. */
  ligne: number
  niveau: 1 | 2
  debut: number
  fin: number
}

export function titresReserves(texte: string): TitreReserve[] {
  const trouves: TitreReserve[] = []
  parseur.parse(texte).iterate({
    enter(noeud) {
      const niveau = RESERVES[noeud.name]
      if (niveau !== undefined) {
        const ligne = texte.slice(0, noeud.from).split('\n').length
        trouves.push({ ligne, niveau, debut: noeud.from, fin: noeud.to })
        return false
      }
      return undefined
    },
  })
  return trouves
}
