/**
 * Commande « Normaliser » : applique à un texte existant les règles de la
 * frappe. Idempotente : l'appliquer deux fois donne le même texte. Ne touche
 * jamais au code, aux adresses, aux URL ni au HTML.
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
import { carteProtegee } from './zones'

export interface ResultatNormalisation {
  texte: string
  /** Nombre de remplacements faits. */
  remplacements: number
}

export function normaliser(texte: string, regles: ReglesTypo): ResultatNormalisation {
  const protege = carteProtegee(texte)
  const sortie: string[] = []
  let remplacements = 0
  const dernier = () => sortie.at(-1)

  /** Retire les espaces ordinaires de fin de sortie ; dit s'il y en avait. */
  const retirerEspaces = (): boolean => {
    let retire = false
    while (dernier() === ' ' || dernier() === '\t') {
      sortie.pop()
      retire = true
    }
    return retire
  }

  for (let i = 0; i < texte.length; i++) {
    const c = texte.charAt(i)
    if (protege[i]) {
      sortie.push(c)
      continue
    }

    if (regles.apostrophe && APOSTROPHES_A_CONVERTIR.includes(c)) {
      sortie.push(APOSTROPHE)
      remplacements++
      continue
    }

    if (
      regles.suspension &&
      texte.startsWith('...', i) &&
      texte[i - 1] !== '.' &&
      texte[i + 3] !== '.' &&
      !protege[i + 1] &&
      !protege[i + 2]
    ) {
      sortie.push(POINTS)
      remplacements++
      i += 2
      continue
    }

    if (regles.guillemets && (GUILLEMETS_A_CONVERTIR.includes(c) || c === OUVRANT || c === FERMANT)) {
      const ouvrant = c === OUVRANT || (c !== FERMANT && guillemetOuvrant(dernier()))
      if (ouvrant) {
        sortie.push(OUVRANT)
        // Une insécable, et une seule, après le guillemet ouvrant.
        let j = i + 1
        while (texte[j] === ' ' || texte[j] === '\t' || estEspaceInsecable(texte[j])) j++
        const suivant = texte[j]
        const espaces = texte.slice(i + 1, j)
        if (suivant !== undefined && suivant !== '\n') sortie.push(INSECABLE)
        if (c !== OUVRANT || (suivant !== undefined && suivant !== '\n' && espaces !== INSECABLE)) remplacements++
        i = j - 1
      } else {
        // Une insécable, et une seule, avant le guillemet fermant.
        const avait = dernier()
        retirerEspaces()
        if (estEspaceInsecable(dernier())) sortie.pop()
        const precedent = dernier()
        if (precedent !== undefined && precedent !== '\n') sortie.push(INSECABLE)
        sortie.push(FERMANT)
        if (c !== FERMANT || (precedent !== undefined && precedent !== '\n' && avait !== INSECABLE)) remplacements++
      }
      continue
    }

    if (regles.ponctuation && PONCTUATION_DOUBLE.includes(c)) {
      const suivant = texte[i + 1]
      const espaceLue = dernier() === ' ' || dernier() === '\t' || estEspaceInsecable(dernier())
      const signePrecedent = sortieSansEspaces(sortie)
      const exception =
        signePrecedent === undefined ||
        signePrecedent === '\n' ||
        // Heures et rapports : 14:30, 3:2.
        (c === ':' && !espaceLue && /\d/u.test(signePrecedent) && suivant !== undefined && /\d/u.test(suivant)) ||
        // Seul le premier signe d'une suite (« ?! ») prend l'espace.
        (!espaceLue && (PONCTUATION_DOUBLE.includes(signePrecedent) || '([{<'.includes(signePrecedent)))
      if (exception) {
        sortie.push(c)
        continue
      }
      const espace = espaceAvant(c, regles)
      const avant = dernier()
      const retire = retirerEspaces()
      if (estEspaceInsecable(dernier())) {
        if (dernier() !== espace || retire) remplacements++
        sortie.pop()
      } else if (retire || avant !== espace) {
        remplacements++
      }
      sortie.push(espace, c)
      continue
    }

    sortie.push(c)
  }
  return { texte: sortie.join(''), remplacements }
}

/** Dernier caractère de la sortie qui n'est pas une espace. */
function sortieSansEspaces(sortie: readonly string[]): string | undefined {
  for (let k = sortie.length - 1; k >= 0; k--) {
    const c = sortie[k]
    if (c !== ' ' && c !== '\t' && !estEspaceInsecable(c)) return c
  }
  return undefined
}
