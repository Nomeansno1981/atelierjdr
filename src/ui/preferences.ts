/**
 * Préférences propres à cet appareil (affichage), gardées dans le
 * localStorage. Elles ne partent pas sur GitHub ; si le stockage est
 * indisponible, elles valent pour la session seulement.
 */

import { useSyncExternalStore } from 'react'

const CLE_INSECABLES = 'atelier.insecablesVisibles'
const ecouteurs = new Set<() => void>()
let enMemoire: boolean | null = null

function lire(): boolean {
  if (enMemoire !== null) return enMemoire
  try {
    return localStorage.getItem(CLE_INSECABLES) === '1'
  } catch {
    return false
  }
}

export function afficherInsecables(valeur: boolean): void {
  enMemoire = valeur
  try {
    localStorage.setItem(CLE_INSECABLES, valeur ? '1' : '0')
  } catch {
    // Préférence gardée pour la session seulement.
  }
  for (const e of ecouteurs) e()
}

function abonner(ecouteur: () => void): () => void {
  ecouteurs.add(ecouteur)
  return () => ecouteurs.delete(ecouteur)
}

export function useInsecablesVisibles(): boolean {
  return useSyncExternalStore(abonner, lire)
}
