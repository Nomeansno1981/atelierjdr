/**
 * Compteur de mots, selon la convention du projet :
 * - la syntaxe Markdown n'est pas comptée (marques, adresses de liens…) ;
 * - une espace insécable (U+00A0, U+202F, U+2007) ne sépare pas deux mots ;
 * - un signe de ponctuation isolé ne compte pas : un mot contient au moins
 *   une lettre ou un chiffre ;
 * - l'apostrophe et le trait d'union ne séparent pas : « l’acte » et
 *   « peut-être » font chacun un mot.
 */

import { parser as parseurCommonMark, Table } from '@lezer/markdown'

const parseur = parseurCommonMark.configure([Table])

/** Nœuds de syntaxe dont le texte est ignoré. */
const SYNTAXE = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'CodeInfo',
  'LinkMark',
  'URL',
  'LinkTitle',
  'LinkLabel',
  'QuoteMark',
  'ListMark',
  'HorizontalRule',
  'TableDelimiter',
  'HTMLTag',
  'HTMLBlock',
  'Comment',
  'CommentBlock',
  'ProcessingInstruction',
  'ProcessingInstructionBlock',
  'Entity',
])

/** Espaces qui séparent les mots : toutes sauf les insécables. */
const SEPARATEURS = /[ \t\n\r\f\v\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+/u
const MOT = /[\p{L}\p{N}]/u

export function compterMots(texte: string): number {
  if (texte.trim() === '') return 0
  const masques: [number, number][] = []
  parseur.parse(texte).iterate({
    enter(noeud) {
      if (SYNTAXE.has(noeud.name)) {
        masques.push([noeud.from, noeud.to])
        return false
      }
      if (noeud.name === 'Escape') {
        // « \* » : la barre oblique inverse est de la syntaxe, pas le signe.
        masques.push([noeud.from, noeud.from + 1])
      }
      return undefined
    },
  })

  let visible = ''
  let curseur = 0
  for (const [debut, fin] of masques.sort((a, b) => a[0] - b[0])) {
    if (debut < curseur) continue
    visible += texte.slice(curseur, debut) + ' '
    curseur = fin
  }
  visible += texte.slice(curseur)

  let total = 0
  for (const morceau of visible.split(SEPARATEURS)) {
    if (MOT.test(morceau)) total++
  }
  return total
}

/** Cible de mots d'une section de texte : pages × mots par page. */
export function cibleMots(
  section: { pages: number; motsParPage: number | null },
  motsParPageDuLivre: number,
): number {
  return section.pages * (section.motsParPage ?? motsParPageDuLivre)
}

/** La jauge vire au rouge au-delà de 110 % de la cible. */
export function depasseLaCible(mots: number, cible: number): boolean {
  return cible > 0 && mots > cible * 1.1
}
