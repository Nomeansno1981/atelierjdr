/**
 * Zones du texte où la typographie ne s'applique jamais : code (en ligne et
 * en bloc), adresses de liens et d'images, URL, HTML et commentaires,
 * définitions de liens, lignes de séparation des tableaux, et le « ! » qui
 * ouvre une image Markdown.
 */

import { parser as parseurCommonMark, Table } from '@lezer/markdown'

const parseur = parseurCommonMark.configure([Table])

const NOEUDS_PROTEGES = new Set([
  'InlineCode',
  'FencedCode',
  'CodeBlock',
  'URL',
  'Autolink',
  'HTMLTag',
  'HTMLBlock',
  'Comment',
  'CommentBlock',
  'ProcessingInstruction',
  'ProcessingInstructionBlock',
  'TableDelimiter',
  'LinkReference',
])

/** URL écrites telles quelles dans le texte. */
const URL_NUE = /(?:https?:\/\/|ftp:\/\/|www\.|mailto:)[^\s<>()]+/giu

export type Zone = readonly [debut: number, fin: number]

export function zonesProtegees(texte: string): Zone[] {
  const zones: [number, number][] = []
  parseur.parse(texte).iterate({
    enter(noeud) {
      if (NOEUDS_PROTEGES.has(noeud.name)) {
        zones.push([noeud.from, noeud.to])
        return false
      }
      // Le « ! » d'une image : ![texte](adresse).
      if (noeud.name === 'Image') zones.push([noeud.from, noeud.from + 1])
      return undefined
    },
  })
  for (const m of texte.matchAll(URL_NUE)) zones.push([m.index, m.index + m[0].length])
  return zones.sort((a, b) => a[0] - b[0])
}

/** Indique, pour chaque position du texte, si elle est protégée. */
export function carteProtegee(texte: string): Uint8Array {
  const carte = new Uint8Array(texte.length)
  for (const [debut, fin] of zonesProtegees(texte)) carte.fill(1, debut, fin)
  return carte
}

/**
 * Le curseur, à la position `pos` du texte, est-il dans une zone protégée ?
 * Pendant la frappe, les constructions ne sont pas encore fermées : on
 * complète l'analyse par des indices tirés de la ligne en cours.
 */
export function protegeALaFrappe(texte: string, pos: number): boolean {
  for (const [debut, fin] of zonesProtegees(texte)) {
    if (debut < pos && pos < fin) return true
    // Bloc de code ou URL qui va jusqu'au bout du texte : on écrit dedans.
    if (debut < pos && pos === fin && fin === texte.length) return true
  }
  const debutLigne = texte.lastIndexOf('\n', pos - 1) + 1
  const ligne = texte.slice(debutLigne, pos)

  // Code en ligne pas encore refermé.
  if ((ligne.match(/`/g)?.length ?? 0) % 2 === 1) return true
  // Adresse de lien ou d'image en cours : « ](… » sans parenthèse fermante.
  const lien = ligne.lastIndexOf('](')
  if (lien !== -1 && !ligne.slice(lien).includes(')')) return true
  // Commentaire HTML pas encore refermé.
  const commentaire = texte.lastIndexOf('<!--', pos)
  if (commentaire !== -1 && texte.indexOf('-->', commentaire) === -1) return true
  // URL en cours de frappe, y compris « https » juste avant son « : ».
  const mot = ligne.slice(Math.max(ligne.lastIndexOf(' '), ligne.lastIndexOf('\t')) + 1)
  if (/^(?:https?|ftp|mailto)$/iu.test(mot)) return true
  if (/^(?:https?:\/\/|ftp:\/\/|www\.|mailto:)/iu.test(mot) || mot.includes('://')) return true
  return false
}
