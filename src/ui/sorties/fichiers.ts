/**
 * Fichiers produits par l'Atelier : compilation et archive complète du
 * manuscrit, prises dans l'état de l'appareil (modifications pas encore
 * envoyées comprises), donc utilisables même sans GitHub.
 */

import { strToU8, zipSync } from 'fflate'
import { slug } from '../../domaine/nomFichier'
import { serialiserPlan, toutesLesSections, type Plan } from '../../domaine/plan'
import scriptCompilation from '../../../outils/compiler.py?raw'

/** Le script de compilation, de la même version que le site. */
export const SCRIPT_COMPILATION = scriptCompilation
export const CHEMIN_SCRIPT = 'outils/compiler.py'

/** Propose un fichier au téléchargement. */
export function telecharger(nom: string, contenu: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([contenu], { type }))
  const lien = document.createElement('a')
  lien.href = url
  lien.download = nom
  lien.rel = 'noopener'
  document.body.append(lien)
  lien.click()
  lien.remove()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 10_000)
}

/** Archive .zip du manuscrit : plan.json, sections, corbeille et script de compilation. */
export function archiveManuscrit(plan: Plan, textes: ReadonlyMap<string, string>): Uint8Array<ArrayBuffer> {
  const contenu: Record<string, Uint8Array> = {
    'plan.json': strToU8(serialiserPlan(plan)),
    [CHEMIN_SCRIPT]: strToU8(SCRIPT_COMPILATION),
  }
  for (const s of toutesLesSections(plan)) {
    if (s.type === 'texte') contenu[s.fichier] = strToU8(textes.get(s.id) ?? '')
  }
  // Copie dans un ArrayBuffer ordinaire, ce qu'attend Blob.
  return new Uint8Array(zipSync(contenu, { level: 6 }))
}

export function nomArchive(plan: Plan, date: Date): string {
  const jour = date.toISOString().slice(0, 10)
  return `${slug(plan.livre.titre)}-${jour}.zip`
}

/** Dernière version compilée sur cet appareil (téléchargements compris). */
export function derniereVersionLocale(cle: string): number {
  try {
    return Number(localStorage.getItem(`atelier.compilation.${cle}`)) || 0
  } catch {
    return 0
  }
}

export function noterVersionLocale(cle: string, version: number): void {
  try {
    localStorage.setItem(`atelier.compilation.${cle}`, String(Math.max(version, derniereVersionLocale(cle))))
  } catch {
    // Sans stockage, la proposition se fondera sur le dépôt seulement.
  }
}
