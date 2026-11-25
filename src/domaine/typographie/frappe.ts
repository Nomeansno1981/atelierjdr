/**
 * Typographie pendant la frappe. Fonction pure : à partir du texte avant
 * la frappe, de la position et du caractère tapé, elle dit quelle
 * substitution appliquer une fois le caractère inséré.
 */

import {
  APOSTROPHE,
  APOSTROPHES_A_CONVERTIR,
  espaceAvant,
  estEspaceInsecable,
  FERMANT,
  GUILLEMETS_A_CONVERTIR,
  guillemetOuvrant,
  INSECABLE,
  OUVRANT,
  PONCTUATION_DOUBLE,
  POINTS,
  type ReglesTypo,
} from './regles'
import { protegeALaFrappe } from './zones'

export interface Changement {
  from: number
  to: number
  insert: string
}

export interface Substitution {
  /** À appliquer au texte où le caractère vient d'être inséré à `pos`. */
  changement: Changement
  /** Signe tapé qui a déclenché la substitution. */
  signe: string
  /** Position juste après le signe, une fois la substitution faite. */
  fin: number
  /** Remet le texte tel qu'il était tapé (coordonnées d'après la substitution). */
  annulation: Changement
}

function substitutionSimple(changement: Changement, signe: string, original: string, pos: number): Substitution {
  // Position du signe dans le texte d'après la substitution.
  const decalage = changement.insert.length - (changement.to - changement.from)
  const fin = pos + 1 + decalage
  return {
    changement,
    signe,
    fin,
    annulation: { from: changement.from, to: changement.from + changement.insert.length, insert: original },
  }
}

/**
 * @param texte document avant la frappe
 * @param pos position d'insertion du caractère
 * @param caractere caractère tapé
 * @param precedente dernière substitution faite, pour la défaire si un « [ »
 *   révèle qu'un « ! » ouvrait en fait une image Markdown
 * @returns la substitution, ou null si le caractère reste tel quel
 */
export function substitutionFrappe(
  texte: string,
  pos: number,
  caractere: string,
  regles: ReglesTypo,
  precedente: Substitution | null = null,
): Substitution | null {
  // Le caractère suivant révèle que la substitution précédente était de trop :
  // « ![ » ouvre une image, « …. » était une suite de quatre points.
  if (
    precedente?.fin === pos &&
    ((caractere === '[' && precedente.signe === '!') || (caractere === '.' && precedente.signe === '.'))
  ) {
    return { ...precedente, changement: precedente.annulation, signe: 'annulation' }
  }
  if (protegeALaFrappe(texte, pos)) return null
  const precedent = pos > 0 ? texte[pos - 1] : undefined
  const apres = texte.slice(pos, pos + 1)

  if (regles.apostrophe && APOSTROPHES_A_CONVERTIR.includes(caractere)) {
    return substitutionSimple({ from: pos, to: pos + 1, insert: APOSTROPHE }, caractere, caractere, pos)
  }

  if (regles.guillemets && GUILLEMETS_A_CONVERTIR.includes(caractere)) {
    const insert = guillemetOuvrant(precedent) ? OUVRANT + INSECABLE : INSECABLE + FERMANT
    return substitutionSimple({ from: pos, to: pos + 1, insert }, caractere, caractere, pos)
  }

  if (regles.ponctuation && PONCTUATION_DOUBLE.includes(caractere)) {
    if (precedent === undefined || precedent === '\n') return null
    // Heures et rapports : 14:30, 3:2.
    if (caractere === ':' && /\d/u.test(precedent)) return null
    // Seul le premier signe d'une suite (« ?! ») prend l'espace ; « <! » ouvre du HTML.
    if (PONCTUATION_DOUBLE.includes(precedent) || '([{<'.includes(precedent)) return null
    const espace = espaceAvant(caractere, regles)
    if (precedent === ' ' || precedent === '\t') {
      return substitutionSimple({ from: pos - 1, to: pos, insert: espace }, caractere, precedent, pos)
    }
    if (estEspaceInsecable(precedent)) {
      if (precedent === espace) return null
      return substitutionSimple({ from: pos - 1, to: pos, insert: espace }, caractere, precedent, pos)
    }
    return substitutionSimple({ from: pos, to: pos, insert: espace }, caractere, '', pos)
  }

  if (regles.suspension && caractere === '.' && texte.slice(pos - 2, pos) === '..' && texte[pos - 3] !== '.' && apres !== '.') {
    return substitutionSimple({ from: pos - 2, to: pos + 1, insert: POINTS }, caractere, '...', pos)
  }
  return null
}

/** Normalise un caractère tapé : un guillemet anglais compte comme « " ». */
export function estDeclencheur(caractere: string): boolean {
  return (
    caractere.length === 1 &&
    (GUILLEMETS_A_CONVERTIR.includes(caractere) ||
      APOSTROPHES_A_CONVERTIR.includes(caractere) ||
      PONCTUATION_DOUBLE.includes(caractere) ||
      caractere === '.' ||
      caractere === '[')
  )
}

/**
 * Simule la frappe d'une chaîne, caractère par caractère, avec les
 * substitutions. Sert aux tests et à vérifier la cohérence avec Normaliser.
 */
export function taper(depart: string, saisie: string, regles: ReglesTypo): string {
  let texte = depart
  let precedente: Substitution | null = null
  for (const caractere of saisie) {
    const pos = texte.length
    const sub = substitutionFrappe(texte, pos, caractere, regles, precedente)
    texte += caractere
    if (sub) {
      const c = sub.changement
      texte = texte.slice(0, c.from) + c.insert + texte.slice(c.to)
      precedente = sub.signe === 'annulation' ? null : sub
    } else {
      precedente = null
    }
  }
  return texte
}
