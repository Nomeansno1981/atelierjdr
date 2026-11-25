import { compterMots, cibleMots } from '../../domaine/mots'
import type { Plan } from '../../domaine/plan'

const NOMBRE = new Intl.NumberFormat('fr-FR')

export function formaterNombre(n: number): string {
  return NOMBRE.format(n)
}

/** Compteur mémorisé par contenu : un texte inchangé n'est pas recompté. */
const memoire = new Map<string, number>()
export function motsDe(texte: string): number {
  let n = memoire.get(texte)
  if (n === undefined) {
    n = compterMots(texte)
    if (memoire.size > 500) memoire.clear()
    memoire.set(texte, n)
  }
  return n
}

export interface MotsSection {
  ecrits: number
  cible: number
}

/**
 * Mots écrits et cible de chaque section de texte.
 * @param textes texte de chaque section, par identifiant ; un texte absent compte pour vide.
 */
export function motsParSection(plan: Plan, textes: ReadonlyMap<string, string>): Map<string, MotsSection> {
  const resultat = new Map<string, MotsSection>()
  for (const s of plan.sections) {
    if (s.type !== 'texte') continue
    resultat.set(s.id, {
      ecrits: motsDe(textes.get(s.id) ?? ''),
      cible: cibleMots(s, plan.livre.motsParPage),
    })
  }
  return resultat
}
