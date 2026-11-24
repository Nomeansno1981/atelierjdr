/**
 * Noms de fichiers des sections : le titre en minuscules, sans accents,
 * mots séparés par des tirets, suffixé en cas de doublon.
 */

const LONGUEUR_MAX = 60

export function slug(titre: string): string {
  const simple = titre
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (simple.length <= LONGUEUR_MAX) return simple || 'section'
  const coupe = simple.slice(0, LONGUEUR_MAX + 1)
  const dernierTiret = coupe.lastIndexOf('-')
  return (dernierTiret > 0 ? coupe.slice(0, dernierTiret) : simple.slice(0, LONGUEUR_MAX)) || 'section'
}

export type Dossier = 'sections/' | 'corbeille/'

/** Premier chemin libre : `dossier/base.md`, puis `dossier/base-2.md`, etc. */
export function cheminLibre(dossier: Dossier, base: string, pris: ReadonlySet<string>): string {
  let chemin = `${dossier}${base}.md`
  for (let n = 2; pris.has(chemin); n++) chemin = `${dossier}${base}-${n}.md`
  return chemin
}

/** « sections/le-heurt-2.md » → « le-heurt-2 ». */
export function baseDuChemin(chemin: string): string {
  return chemin.slice(chemin.lastIndexOf('/') + 1).replace(/\.md$/, '')
}
