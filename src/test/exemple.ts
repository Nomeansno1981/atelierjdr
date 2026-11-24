import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const DOSSIER_EXEMPLE = join(import.meta.dirname, '..', '..', 'exemple')

/** Le manuscrit d'exemple, chemin → contenu, tel qu'il serait dans le dépôt. */
export function lireExemple(): Record<string, string> {
  const fichiers: Record<string, string> = {
    'plan.json': readFileSync(join(DOSSIER_EXEMPLE, 'plan.json'), 'utf8'),
  }
  for (const nom of readdirSync(join(DOSSIER_EXEMPLE, 'sections')).sort()) {
    fichiers[`sections/${nom}`] = readFileSync(join(DOSSIER_EXEMPLE, 'sections', nom), 'utf8')
  }
  return fichiers
}
