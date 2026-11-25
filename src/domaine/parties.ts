/**
 * Parties du livre. Fonctions pures.
 *
 * Règle de base : la grille est regroupée par partie. Les sections d'une
 * même partie se suivent, et les parties se suivent dans l'ordre de
 * `plan.parties`, qui fixe aussi leur numérotation. Une partie sans section
 * garde sa place dans cette liste : la grille l'affiche entre ses voisines.
 *
 * Le format de plan.json ne change pas : chaque section porte sa partie.
 * Un plan venu d'ailleurs (ancienne version, modification à la main) peut
 * ne pas être regroupé ; `regrouper` le remet en ordre, sur confirmation.
 */

import { slug } from './nomFichier'
import type { Partie, Plan } from './plan'

/** Identifiant d'une nouvelle partie, tiré de son titre. */
export function nouvelIdPartie(titre: string, parties: readonly Partie[]): string {
  const base = slug(titre) === 'section' ? 'partie' : slug(titre)
  const pris = new Set(parties.map((p) => p.id))
  let id = base
  for (let n = 2; pris.has(id); n++) id = `${base}-${n}`
  return id
}

function rangs(parties: readonly { id: string }[]): Map<string, number> {
  return new Map(parties.map((p, i) => [p.id, i]))
}

/** Les sections sont-elles rangées partie par partie, dans l'ordre des parties ? */
export function estRegroupe(plan: Pick<Plan, 'parties' | 'sections'>): boolean {
  const rang = rangs(plan.parties)
  let precedent = -1
  for (const s of plan.sections) {
    const r = rang.get(s.partie) ?? Number.MAX_SAFE_INTEGER
    if (r < precedent) return false
    precedent = r
  }
  return true
}

/**
 * Range les sections dans l'ordre des parties, sans changer leur ordre au
 * sein d'une partie (tri stable). Sur un plan regroupé où une seule section
 * a changé de partie, elle rejoint le bout le plus proche de sa nouvelle
 * partie : la fin si celle-ci la précède, le début sinon.
 */
export function rangerParPartie(plan: Plan): Plan {
  if (estRegroupe(plan)) return plan
  const rang = rangs(plan.parties)
  const cle = (partie: string) => rang.get(partie) ?? Number.MAX_SAFE_INTEGER
  const sections = plan.sections
    .map((s, i) => ({ s, i }))
    .sort((a, b) => cle(a.s.partie) - cle(b.s.partie) || a.i - b.i)
    .map((x) => x.s)
  return { ...plan, sections }
}

/** Applique une opération ; si le plan était regroupé, il le reste. */
export function enGardantLesParties(plan: Plan, operation: (plan: Plan) => Plan): Plan {
  const resultat = operation(plan)
  return resultat !== plan && estRegroupe(plan) ? rangerParPartie(resultat) : resultat
}

/**
 * Regroupe un plan qui ne l'est pas : les parties prennent l'ordre de leur
 * première apparition dans la grille (une partie vide reste juste avant la
 * même voisine, ou en fin de livre), puis chaque section rejoint sa partie.
 */
export function regrouper(plan: Plan): Plan {
  if (estRegroupe(plan)) return plan
  const presentes = new Set(plan.sections.map((s) => s.partie))
  const ordre: string[] = []
  for (const s of plan.sections) if (!ordre.includes(s.partie)) ordre.push(s.partie)
  // Chaque partie vide se place juste avant la partie non vide qui la
  // suivait dans la liste, ou en fin de livre s'il n'y en avait pas.
  plan.parties.forEach((p, i) => {
    if (presentes.has(p.id)) return
    const suivante = plan.parties.slice(i + 1).find((x) => presentes.has(x.id))
    if (suivante) ordre.splice(ordre.indexOf(suivante.id), 0, p.id)
    else ordre.push(p.id)
  })
  const parId = new Map(plan.parties.map((p) => [p.id, p]))
  const parties = ordre.flatMap((id) => {
    const p = parId.get(id)
    return p ? [p] : []
  })
  return rangerParPartie({ ...plan, parties })
}

/** Ce que `regrouper` déplacerait : les titres des sections qui changent de place. */
export function sectionsDeplaceesParRegroupement(plan: Plan): string[] {
  const apres = regrouper(plan).sections
  const avant = plan.sections
  // Les sections dont la position relative change : celles qui ne font pas
  // partie de la plus longue suite commune.
  const ids = new Map(apres.map((s, i) => [s.id, i]))
  const positions = avant.map((s) => ids.get(s.id) ?? 0)
  const gardees = plusLongueSuiteCroissante(positions)
  return avant.filter((_, i) => !gardees.has(i)).map((s) => s.titre)
}

function plusLongueSuiteCroissante(valeurs: readonly number[]): Set<number> {
  const longueur = valeurs.map(() => 1)
  const precedent = valeurs.map(() => -1)
  for (let i = 0; i < valeurs.length; i++) {
    for (let j = 0; j < i; j++) {
      if ((valeurs[j] ?? 0) < (valeurs[i] ?? 0) && (longueur[j] ?? 0) + 1 > (longueur[i] ?? 0)) {
        longueur[i] = (longueur[j] ?? 0) + 1
        precedent[i] = j
      }
    }
  }
  let fin = -1
  longueur.forEach((l, i) => {
    if (fin === -1 || l > (longueur[fin] ?? 0)) fin = i
  })
  const gardees = new Set<number>()
  for (let i = fin; i !== -1; i = precedent[i] ?? -1) gardees.add(i)
  return gardees
}

/**
 * Déplace une partie entière, avec ses sections, à `index` dans la liste des
 * parties (compté sans elle).
 */
export function deplacerPartie(plan: Plan, id: string, index: number): Plan {
  const partie = plan.parties.find((p) => p.id === id)
  if (!partie) return plan
  const autres = plan.parties.filter((p) => p.id !== id)
  const borne = Math.max(0, Math.min(index, autres.length))
  const parties = [...autres.slice(0, borne), partie, ...autres.slice(borne)]
  if (parties.every((p, i) => p === plan.parties[i])) return plan
  return rangerParPartie({ ...plan, parties })
}

/**
 * Fait commencer une partie à une section : son bandeau, glissé sur un
 * post-it, s'y pose.
 * - Section d'une autre partie, au milieu de celle-ci : la partie vient
 *   juste après elle et reprend cette section et les suivantes de cette
 *   partie (ses propres sections la suivent).
 * - Première section d'une autre partie : la partie se place avant elle,
 *   entière.
 * - Section de la partie elle-même : son début recule jusqu'à cette
 *   section ; celles d'avant passent dans la partie précédente.
 */
export function commencerPartieA(plan: Plan, id: string, idSection: string): Plan {
  const partie = plan.parties.find((p) => p.id === id)
  const index = plan.sections.findIndex((s) => s.id === idSection)
  const section = plan.sections[index]
  if (!partie || !section) return plan
  const premiere = plan.sections.findIndex((s) => s.partie === section.partie)

  if (section.partie === id) {
    const precedente = plan.parties[plan.parties.findIndex((p) => p.id === id) - 1]
    if (!precedente || premiere === index) return plan
    return rangerParPartie({
      ...plan,
      sections: plan.sections.map((s, i) => (i >= premiere && i < index ? { ...s, partie: precedente.id } : s)),
    })
  }

  const autres = plan.parties.filter((p) => p.id !== id)
  const rang = autres.findIndex((p) => p.id === section.partie)
  if (premiere === index) return deplacerPartie(plan, id, rang)
  let fin = index
  while (plan.sections[fin]?.partie === section.partie) fin++
  return rangerParPartie({
    ...plan,
    parties: [...autres.slice(0, rang + 1), partie, ...autres.slice(rang + 1)],
    sections: plan.sections.map((s, i) => (i >= index && i < fin ? { ...s, partie: id } : s)),
  })
}

export interface NouvellePartie {
  titre: string
  numerotee: boolean
}

/**
 * Nouvelle partie qui commence juste avant la section `avant`. Si celle-ci
 * ouvre déjà sa partie, la nouvelle partie se glisse avant, vide ; sinon,
 * elle reprend la section et toutes celles qui la suivent dans sa partie.
 * Sans section indiquée, la partie s'ajoute, vide, à la fin du livre.
 */
export function nouvellePartie(plan: Plan, nouvelle: NouvellePartie, avant: string | null): Plan {
  const titre = nouvelle.titre.trim() || 'Nouvelle partie'
  const partie: Partie = { id: nouvelIdPartie(titre, plan.parties), titre, numerotee: nouvelle.numerotee }
  const index = avant === null ? -1 : plan.sections.findIndex((s) => s.id === avant)
  const section = plan.sections[index]
  if (!section) return { ...plan, parties: [...plan.parties, partie] }
  const rang = plan.parties.findIndex((p) => p.id === section.partie)
  const ouvre = plan.sections[index - 1]?.partie !== section.partie
  if (ouvre) {
    return { ...plan, parties: [...plan.parties.slice(0, rang), partie, ...plan.parties.slice(rang)] }
  }
  let fin = index
  while (plan.sections[fin]?.partie === section.partie) fin++
  return {
    ...plan,
    parties: [...plan.parties.slice(0, rang + 1), partie, ...plan.parties.slice(rang + 1)],
    sections: plan.sections.map((s, i) => (i >= index && i < fin ? { ...s, partie: partie.id } : s)),
  }
}

export function modifierPartie(plan: Plan, id: string, modif: Partial<NouvellePartie>): Plan {
  const titre = modif.titre?.trim()
  return {
    ...plan,
    parties: plan.parties.map((p) =>
      p.id === id
        ? { ...p, ...(titre ? { titre } : {}), ...(modif.numerotee !== undefined ? { numerotee: modif.numerotee } : {}) }
        : p,
    ),
  }
}

/** Une partie vide se supprime ; il en reste toujours au moins une. */
export function supprimerPartie(plan: Plan, id: string): Plan {
  if (plan.parties.length <= 1 || plan.sections.some((s) => s.partie === id)) return plan
  return { ...plan, parties: plan.parties.filter((p) => p.id !== id) }
}

/**
 * Fond une partie dans sa voisine : la précédente, ou la suivante pour la
 * première. Ses sections restent à leur place et changent de partie.
 */
export function fusionnerPartie(plan: Plan, id: string): Plan {
  const rang = plan.parties.findIndex((p) => p.id === id)
  const voisine = plan.parties[rang - 1] ?? plan.parties[rang + 1]
  if (rang === -1 || !voisine) return plan
  return rangerParPartie({
    ...plan,
    parties: plan.parties.filter((p) => p.id !== id),
    sections: plan.sections.map((s) => (s.partie === id ? { ...s, partie: voisine.id } : s)),
  })
}

/** Voisine dans laquelle `fusionnerPartie` verserait cette partie. */
export function voisineDeFusion(plan: Plan, id: string): Partie | undefined {
  const rang = plan.parties.findIndex((p) => p.id === id)
  return rang === -1 ? undefined : (plan.parties[rang - 1] ?? plan.parties[rang + 1])
}

/** Index, dans l'ordre du plan, de la fin d'une partie : là où l'on y ajoute une section. */
export function finDePartie(plan: Pick<Plan, 'parties' | 'sections'>, id: string): number {
  const rang = rangs(plan.parties)
  const cible = rang.get(id) ?? Number.MAX_SAFE_INTEGER
  return plan.sections.filter((s) => (rang.get(s.partie) ?? Number.MAX_SAFE_INTEGER) <= cible).length
}

/** Parties vides, rangées selon la partie non vide qu'elles précèdent (null : en fin de livre). */
export function partiesVidesAvant(plan: Pick<Plan, 'parties' | 'sections'>): Map<string | null, Partie[]> {
  const presentes = new Set(plan.sections.map((s) => s.partie))
  const resultat = new Map<string | null, Partie[]>()
  let enAttente: Partie[] = []
  for (const p of plan.parties) {
    if (presentes.has(p.id)) {
      if (enAttente.length > 0) resultat.set(p.id, enAttente)
      enAttente = []
    } else {
      enAttente.push(p)
    }
  }
  if (enAttente.length > 0) resultat.set(null, enAttente)
  return resultat
}
