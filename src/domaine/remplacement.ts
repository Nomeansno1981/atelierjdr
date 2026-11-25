/**
 * Remplacer dans tout le manuscrit : textes, titres et résumés des sections.
 * Fonctions pures. La recherche est celle de `recherche.ts` (ni casse, ni
 * accents) ; le remplacement garde la majuscule initiale ou les capitales
 * de ce qu'il remplace.
 */

import { modifierSection } from './operations'
import type { Plan } from './plan'
import { rechercher, type Occurrence } from './recherche'

export type Champ = 'texte' | 'titre' | 'resume'

export const LIBELLES_CHAMP: Record<Champ, string> = { texte: 'Texte', titre: 'Titre', resume: 'Résumé' }

export interface ResultatRemplacement {
  id: string
  /** Titre de la section, pour l'affichage. */
  titre: string
  champ: Champ
  occurrences: Occurrence[]
}

export interface OccurrenceChoisie {
  id: string
  champ: Champ
  debut: number
  fin: number
  trouve: string
}

/** Toutes les occurrences, sans limite : textes, puis titres et résumés de chaque section. */
export function rechercherPartout(
  plan: Plan,
  textes: ReadonlyMap<string, string>,
  requete: string,
  motEntier = false,
): ResultatRemplacement[] {
  const resultats: ResultatRemplacement[] = []
  for (const s of plan.sections) {
    const champs: [Champ, string][] = [
      ...(s.type === 'texte' ? [['texte', textes.get(s.id) ?? ''] as [Champ, string]] : []),
      ['titre', s.titre],
      ['resume', s.resume],
    ]
    for (const [champ, texte] of champs) {
      const [trouve] = rechercher([{ id: s.id, titre: s.titre, texte }], requete, { max: Infinity, motEntier })
      if (trouve) resultats.push({ id: s.id, titre: s.titre, champ, occurrences: trouve.occurrences })
    }
  }
  return resultats
}

const lettres = (s: string) =>
  Array.from(s.matchAll(/\p{L}/gu), (m) => m[0]).filter((c) => c.toLocaleLowerCase('fr') !== c.toLocaleUpperCase('fr'))

/**
 * Le remplacement prend la casse de ce qu'il remplace : tout en capitales
 * si c'en était (« HEURT » → « CHOC »), majuscule initiale si le mot en
 * avait une (« Heurt » → « Choc »), sinon tel qu'il a été saisi.
 */
export function adapterCasse(trouve: string, remplacement: string): string {
  const l = lettres(trouve)
  const premiere = l[0]
  if (premiere === undefined) return remplacement
  if (l.length > 1 && l.every((c) => c === c.toLocaleUpperCase('fr'))) return remplacement.toLocaleUpperCase('fr')
  if (premiere === premiere.toLocaleUpperCase('fr')) {
    return remplacement.replace(/\p{L}/u, (c) => c.toLocaleUpperCase('fr'))
  }
  return remplacement
}

/** Remplace ces occurrences d'un texte (positions dans ce texte), de la fin vers le début. */
export function remplacerDans(
  texte: string,
  occurrences: readonly { debut: number; fin: number; trouve: string }[],
  remplacement: string,
): string {
  let resultat = texte
  for (const o of [...occurrences].sort((a, b) => b.debut - a.debut)) {
    // Garde-fou : le texte a changé depuis la recherche, on ne touche à rien ici.
    if (resultat.slice(o.debut, o.fin) !== o.trouve) continue
    resultat = resultat.slice(0, o.debut) + adapterCasse(o.trouve, remplacement) + resultat.slice(o.fin)
  }
  return resultat
}

/** Regroupe les occurrences choisies par section et par champ. */
export function parEndroit(choix: readonly OccurrenceChoisie[]): Map<string, OccurrenceChoisie[]> {
  const groupes = new Map<string, OccurrenceChoisie[]>()
  for (const o of choix) {
    const cle = `${o.id}|${o.champ}`
    groupes.set(cle, [...(groupes.get(cle) ?? []), o])
  }
  return groupes
}

/** Applique au plan les remplacements choisis dans les titres et les résumés. */
export function remplacerDansLePlan(plan: Plan, choix: readonly OccurrenceChoisie[], remplacement: string): Plan {
  let resultat = plan
  for (const groupe of parEndroit(choix.filter((o) => o.champ !== 'texte')).values()) {
    const premier = groupe[0]
    const section = premier && resultat.sections.find((s) => s.id === premier.id)
    if (!premier || !section) continue
    const avant = premier.champ === 'titre' ? section.titre : section.resume
    const apres = remplacerDans(avant, groupe, remplacement)
    if (apres === avant) continue
    resultat = modifierSection(resultat, premier.id, premier.champ === 'titre' ? { titre: apres } : { resume: apres })
  }
  return resultat
}
