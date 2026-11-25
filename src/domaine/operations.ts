/**
 * Opérations du mode plan. Fonctions pures : chacune prend un plan et
 * renvoie un nouveau plan, sans jamais modifier celui qu'elle reçoit.
 * Elles ne touchent qu'à plan.json ; les déplacements de fichiers qui en
 * découlent sont déduits au moment de l'envoi (github/ecriture.ts).
 */

import { modelePourTitre } from './compilation'
import { baseDuChemin, cheminLibre, slug } from './nomFichier'
import { REGLES_PAR_DEFAUT, type ReglesTypo } from './typographie/regles'
import {
  TITRE_PAGE_BLANCHE,
  toutesLesSections,
  type Debut,
  type Livre,
  type Partie,
  type Plan,
  type Section,
  type SectionTexte,
  type Statut,
} from './plan'

const CARACTERES_ID = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Identifiant de 6 caractères [a-z0-9], absent du plan et de la corbeille. */
export function nouvelId(plan: Plan, aleatoire: () => number = Math.random): string {
  const pris = new Set(toutesLesSections(plan).map((s) => s.id))
  for (;;) {
    let id = ''
    for (let i = 0; i < 6; i++) id += CARACTERES_ID.charAt(Math.floor(aleatoire() * CARACTERES_ID.length))
    if (!pris.has(id)) return id
  }
}

/** Chemins de fichiers déjà utilisés, sauf celui de la section `sauf`. */
function cheminsPris(plan: Plan, sauf?: string): Set<string> {
  const pris = new Set<string>()
  for (const s of toutesLesSections(plan)) {
    if (s.type === 'texte' && s.id !== sauf) pris.add(s.fichier)
  }
  return pris
}

function trouver(plan: Plan, id: string): Section {
  const s = plan.sections.find((x) => x.id === id)
  if (!s) throw new Error(`Section inconnue : ${id}`)
  return s
}

function remplacer(plan: Plan, section: Section): Plan {
  return { ...plan, sections: plan.sections.map((s) => (s.id === section.id ? section : s)) }
}

/** Ordre des sections avec `id` placé à `index` (index compté sans elle). */
export function ordreAvecDeplacement<T extends { id: string }>(sections: readonly T[], id: string, index: number): T[] {
  const element = sections.find((s) => s.id === id)
  if (!element) return [...sections]
  const sans = sections.filter((s) => s.id !== id)
  const borne = Math.max(0, Math.min(index, sans.length))
  return [...sans.slice(0, borne), element, ...sans.slice(borne)]
}

/**
 * Partie d'une section placée entre ces deux voisines : celle des voisines
 * si elles sont de la même partie ; à la frontière entre deux parties, la
 * sienne si elle est l'une des deux, sinon celle de la précédente. Une
 * partie reste ainsi d'un seul tenant dans le livre.
 */
export function partieEntre(propre: string, avant: { partie: string } | undefined, apres: { partie: string } | undefined): string {
  if (avant && apres && avant.partie === apres.partie) return avant.partie
  if (avant?.partie === propre || apres?.partie === propre) return propre
  return avant?.partie ?? apres?.partie ?? propre
}

/** Déplace une section ; elle prend au besoin la partie de ses nouvelles voisines. */
export function deplacer(plan: Plan, id: string, index: number): Plan {
  const actuel = plan.sections.findIndex((s) => s.id === id)
  if (actuel === -1 || actuel === index) return plan
  const ordre = ordreAvecDeplacement(plan.sections, id, index)
  const i = ordre.findIndex((s) => s.id === id)
  const section = ordre[i]
  if (!section) return plan
  const partie = partieEntre(section.partie, ordre[i - 1], ordre[i + 1])
  return {
    ...plan,
    sections: partie === section.partie ? ordre : ordre.map((s) => (s.id === id ? { ...s, partie } : s)),
  }
}

export function changerPages(plan: Plan, id: string, delta: number): Plan {
  const s = trouver(plan, id)
  const pages = Math.max(1, s.pages + delta)
  return pages === s.pages ? plan : remplacer(plan, { ...s, pages })
}

export interface ModificationSection {
  titre: string
  resume: string
  partie: string
  statut: Statut
  pages: number
  debut: Debut
  /** Sections de texte seulement ; null pour reprendre celui du livre. */
  motsParPage: number | null
}

/** Modifie une section. Si le titre change, le fichier est renommé. */
export function modifierSection(plan: Plan, id: string, modif: Partial<ModificationSection>): Plan {
  const s = trouver(plan, id)
  const { motsParPage, ...communs } = modif
  if (communs.titre !== undefined) communs.titre = communs.titre.trim()
  if (communs.titre === '') delete communs.titre
  if (communs.pages !== undefined) communs.pages = Math.max(1, Math.round(communs.pages))
  if (communs.partie !== undefined && !plan.parties.some((p) => p.id === communs.partie)) delete communs.partie

  if (s.type !== 'texte') return remplacer(plan, { ...s, ...communs })

  const nouvelle: SectionTexte = { ...s, ...communs }
  if (motsParPage !== undefined) {
    nouvelle.motsParPage = motsParPage === null ? null : Math.max(1, Math.round(motsParPage))
  }
  if (nouvelle.titre !== s.titre && slug(nouvelle.titre) !== slug(s.titre)) {
    nouvelle.fichier = cheminLibre('sections/', slug(nouvelle.titre), cheminsPris(plan, id))
  }
  return remplacer(plan, nouvelle)
}

export interface NouvelleSection {
  type: 'texte' | 'hors-texte' | 'blanche'
  titre: string
  partie: string
  pages: number
}

/** Crée une section à `index` dans l'ordre du plan. */
export function creerSection(plan: Plan, nouvelle: NouvelleSection, index: number, id: string): Plan {
  const titre = nouvelle.titre.trim() || (nouvelle.type === 'blanche' ? TITRE_PAGE_BLANCHE : 'Sans titre')
  const commun = {
    id,
    titre,
    partie: nouvelle.partie,
    // Une page blanche n'a rien à écrire : elle est d'emblée définitive.
    statut: nouvelle.type === 'blanche' ? ('definitif' as const) : ('a-ecrire' as const),
    pages: Math.max(1, Math.round(nouvelle.pages)),
    debut: 'indifferent' as const,
    resume: '',
  }
  const section: Section =
    nouvelle.type !== 'texte'
      ? { type: nouvelle.type, ...commun }
      : {
          type: 'texte',
          ...commun,
          fichier: cheminLibre('sections/', slug(titre), cheminsPris(plan)),
          motsParPage: null,
        }
  const borne = Math.max(0, Math.min(index, plan.sections.length))
  return { ...plan, sections: [...plan.sections.slice(0, borne), section, ...plan.sections.slice(borne)] }
}

/** Envoie une section à la corbeille, avec sa date et sa position. */
export function supprimerSection(plan: Plan, id: string, maintenant: Date): Plan {
  const position = plan.sections.findIndex((s) => s.id === id)
  const s = plan.sections[position]
  if (!s) return plan
  const enCorbeille: Section =
    s.type === 'texte'
      ? { ...s, fichier: cheminLibre('corbeille/', baseDuChemin(s.fichier), cheminsPris(plan, id)) }
      : s
  return {
    ...plan,
    sections: plan.sections.filter((x) => x.id !== id),
    corbeille: [...plan.corbeille, { section: enCorbeille, supprimeLe: maintenant.toISOString(), position }],
  }
}

/**
 * Remet une section de la corbeille à sa position d'origine, ou en fin de
 * grille si cette position n'existe plus.
 */
export function restaurerSection(plan: Plan, id: string): Plan {
  const element = plan.corbeille.find((e) => e.section.id === id)
  if (!element) return plan
  const sansElle: Plan = { ...plan, corbeille: plan.corbeille.filter((e) => e.section.id !== id) }
  let section = element.section
  if (!plan.parties.some((p) => p.id === section.partie)) {
    // Sa partie a été supprimée depuis : on la rattache à la première.
    section = { ...section, partie: plan.parties[0]?.id ?? section.partie }
  }
  if (section.type === 'texte') {
    section = { ...section, fichier: cheminLibre('sections/', slug(section.titre), cheminsPris(sansElle, id)) }
  }
  const index = element.position <= plan.sections.length ? element.position : plan.sections.length
  return { ...sansElle, sections: [...plan.sections.slice(0, index), section, ...plan.sections.slice(index)] }
}

export function viderCorbeille(plan: Plan): Plan {
  return plan.corbeille.length === 0 ? plan : { ...plan, corbeille: [] }
}

export interface Reglages {
  titre: string
  pagesTotal: number
  motsParPage: number
  parties: Partie[]
  typographie?: ReglesTypo
  modeleCompilation?: string
}

/**
 * Modifie les réglages du livre. Une partie qui contient encore des
 * sections ne peut pas être retirée : elle est conservée.
 */
export function modifierReglages(plan: Plan, reglages: Reglages): Plan {
  const utilisees = new Set(plan.sections.map((s) => s.partie))
  const gardees = new Set(reglages.parties.map((p) => p.id))
  const parties = [...reglages.parties, ...plan.parties.filter((p) => utilisees.has(p.id) && !gardees.has(p.id))]
  const livre: Livre = {
    ...plan.livre,
    titre: reglages.titre.trim() || plan.livre.titre,
    pagesTotal: Math.max(1, Math.round(reglages.pagesTotal)),
    motsParPage: Math.max(1, Math.round(reglages.motsParPage)),
  }
  let reglagesLivre = reglages.typographie ? { ...plan.reglages, typographie: reglages.typographie } : plan.reglages
  if (reglages.modeleCompilation !== undefined && reglagesLivre) {
    reglagesLivre = { ...reglagesLivre, compilation: { modele: reglages.modeleCompilation } }
  }
  return { ...plan, livre, parties, ...(reglagesLivre ? { reglages: reglagesLivre } : {}) }
}

/** Identifiant d'une nouvelle partie, tiré de son titre. */
export function nouvelIdPartie(titre: string, parties: readonly Partie[]): string {
  const base = slug(titre) === 'section' ? 'partie' : slug(titre)
  const pris = new Set(parties.map((p) => p.id))
  let id = base
  for (let n = 2; pris.has(id); n++) id = `${base}-${n}`
  return id
}

/** Ce que l'on demande pour commencer un livre ; le reste se règle ensuite. */
export interface NouveauLivre {
  titre: string
  pagesTotal: number
  motsParPage: number
  /** Titres des parties, dans l'ordre. Au moins une. */
  parties: readonly string[]
}

/**
 * Plan d'un nouveau livre : ses parties, aucune section. Les règles
 * typographiques sont reprises du livre ouvert s'il y en a un, et le nom
 * des compilations est tiré du titre.
 */
export function nouveauPlan(nouveau: NouveauLivre, typographie: ReglesTypo = REGLES_PAR_DEFAUT): Plan {
  const titre = nouveau.titre.trim()
  const parties: Partie[] = []
  for (const brut of nouveau.parties) {
    const t = brut.trim()
    if (t !== '') parties.push({ id: nouvelIdPartie(t, parties), titre: t, numerotee: true })
  }
  if (parties.length === 0) parties.push({ id: 'partie', titre: 'Première partie', numerotee: true })
  return {
    version: 1,
    livre: {
      titre,
      pagesTotal: Math.max(1, Math.round(nouveau.pagesTotal)),
      motsParPage: Math.max(1, Math.round(nouveau.motsParPage)),
      premierePage: 'droite',
    },
    reglages: { typographie: { ...typographie }, compilation: { modele: modelePourTitre(titre) } },
    parties,
    sections: [],
    corbeille: [],
  }
}
