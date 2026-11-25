/**
 * Modèle de plan.json : source unique de l'ordre et des métadonnées.
 * Tout plan lu depuis le dépôt passe par `lirePlan`, qui refuse un fichier
 * mal formé avec des messages en français plutôt que de deviner.
 */

import { modeleValide } from './compilation'
import { REGLES_PAR_DEFAUT, type ReglesTypo } from './typographie/regles'

export const STATUTS = ['a-ecrire', 'premier-jet', 'relu', 'definitif'] as const
export type Statut = (typeof STATUTS)[number]

export const LIBELLES_STATUT: Record<Statut, string> = {
  'a-ecrire': 'À écrire',
  'premier-jet': 'Premier jet',
  relu: 'Relu',
  definitif: 'Définitif',
}

export const DEBUTS = ['indifferent', 'gauche', 'droite'] as const
export type Debut = (typeof DEBUTS)[number]

export type Cote = 'gauche' | 'droite'

export interface Livre {
  titre: string
  /**
   * Ancien budget de pages, d'avant le livre « à la demande » : gardé tel
   * quel s'il figure dans plan.json, mais l'Atelier ne s'en sert plus. Le
   * nombre de pages est celui que les sections occupent.
   */
  pagesTotal?: number
  motsParPage: number
  premierePage: Cote
}

export interface Partie {
  id: string
  titre: string
  numerotee: boolean
}

interface SectionCommune {
  id: string
  titre: string
  partie: string
  statut: Statut
  pages: number
  debut: Debut
  resume: string
}

export interface SectionTexte extends SectionCommune {
  type: 'texte'
  fichier: string
  /** Remplace celui du livre s'il est renseigné. */
  motsParPage: number | null
}

export interface SectionHorsTexte extends SectionCommune {
  type: 'hors-texte'
}

/** Page laissée blanche à dessein (les blanches de parité, elles, sont calculées). */
export interface SectionBlanche extends SectionCommune {
  type: 'blanche'
}

export type Section = SectionTexte | SectionHorsTexte | SectionBlanche

export const TITRE_PAGE_BLANCHE = 'Page blanche'

/** Une section sans texte : hors-texte ou page blanche. */
export function sansTexte(s: Section): s is SectionHorsTexte | SectionBlanche {
  return s.type !== 'texte'
}

export interface ElementCorbeille {
  section: Section
  /** Date ISO 8601. */
  supprimeLe: string
  /** Index de la section dans `sections` au moment de la suppression. */
  position: number
}

/** Réglages partagés entre appareils. Facultatifs : absents, les valeurs par défaut s'appliquent. */
export interface ReglagesLivre {
  typographie: ReglesTypo
  compilation?: { modele: string }
}

export interface Plan {
  version: 1
  livre: Livre
  reglages?: ReglagesLivre
  parties: Partie[]
  sections: Section[]
  corbeille: ElementCorbeille[]
}

/** Règles typographiques du livre. */
export function reglesTypo(plan: Plan): ReglesTypo {
  return plan.reglages?.typographie ?? REGLES_PAR_DEFAUT
}

export const MOTIF_ID = /^[a-z0-9]{6}$/

export class ErreurPlan extends Error {
  readonly problemes: readonly string[]

  constructor(problemes: string[]) {
    super(`plan.json est invalide : ${problemes.join(' ; ')}`)
    this.name = 'ErreurPlan'
    this.problemes = problemes
  }
}

/** Lit le texte de plan.json. Lève `ErreurPlan` s'il est invalide. */
export function lirePlan(texte: string): Plan {
  let donnees: unknown
  try {
    donnees = JSON.parse(texte)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new ErreurPlan([`ce n’est pas du JSON valide (${detail})`])
  }
  return validerPlan(donnees)
}

/** Valide une valeur quelconque et la convertit en `Plan`. */
export function validerPlan(donnees: unknown): Plan {
  const v = new Verificateur()
  const racine = v.objet(donnees, 'plan.json')
  if (!racine) throw new ErreurPlan(v.problemes)

  if (racine.version !== 1) {
    v.signaler(`« version » doit valoir 1 (trouvé : ${JSON.stringify(racine.version)})`)
  }

  const livre = lireLivre(v, racine.livre)
  const reglages = racine.reglages === undefined ? undefined : lireReglages(v, racine.reglages)
  const parties = lireParties(v, racine.parties)
  const idsParties = new Set(parties.map((p) => p.id))

  const sections: Section[] = []
  const brutes = v.liste(racine.sections, 'sections')
  brutes.forEach((brute, i) => {
    const s = lireSection(v, brute, `sections[${i}]`, 'sections/')
    if (!s) return
    if (!idsParties.has(s.partie)) {
      v.signaler(`${nomSection(i, s)} : la partie « ${s.partie} » n’existe pas`)
    }
    sections.push(s)
  })

  const corbeille: ElementCorbeille[] = []
  const elements = racine.corbeille === undefined ? [] : v.liste(racine.corbeille, 'corbeille')
  elements.forEach((brut, i) => {
    const chemin = `corbeille[${i}]`
    const o = v.objet(brut, chemin)
    if (!o) return
    // La partie d'une section supprimée peut avoir disparu depuis : on ne
    // vérifie pas qu'elle existe, la restauration s'en chargera.
    const section = lireSection(v, o.section, `${chemin}.section`, 'corbeille/')
    const supprimeLe = v.chaine(o.supprimeLe, `${chemin}.supprimeLe`)
    if (supprimeLe !== null && Number.isNaN(Date.parse(supprimeLe))) {
      v.signaler(`${chemin}.supprimeLe : date invalide`)
    }
    const position = v.entier(o.position, `${chemin}.position`, 0)
    if (section && supprimeLe !== null && position !== null) {
      corbeille.push({ section, supprimeLe, position })
    }
  })

  verifierUnicite(v, [...sections, ...corbeille.map((e) => e.section)])

  if (v.problemes.length > 0 || !livre) throw new ErreurPlan(v.problemes)
  return { version: 1, livre, ...(reglages ? { reglages } : {}), parties, sections, corbeille }
}

function lireReglages(v: Verificateur, brut: unknown): ReglagesLivre | undefined {
  const o = v.objet(brut, 'reglages')
  if (!o) return undefined
  const typo = o.typographie === undefined ? {} : v.objet(o.typographie, 'reglages.typographie')
  if (!typo) return undefined
  const typographie: ReglesTypo = { ...REGLES_PAR_DEFAUT }
  for (const cle of Object.keys(REGLES_PAR_DEFAUT) as (keyof ReglesTypo)[]) {
    if (typo[cle] === undefined) continue
    const valeur = v.booleen(typo[cle], `reglages.typographie.${cle}`)
    if (valeur !== null) typographie[cle] = valeur
  }
  if (o.compilation === undefined) return { typographie }
  const compilation = v.objet(o.compilation, 'reglages.compilation')
  const modele = compilation ? v.chaine(compilation.modele, 'reglages.compilation.modele') : null
  if (modele !== null && !modeleValide(modele)) {
    v.signaler('reglages.compilation.modele : un nom en .md contenant {n}, sans dossier, est attendu')
  }
  return modele ? { typographie, compilation: { modele } } : { typographie }
}

function nomSection(i: number, s: { titre: string }): string {
  return `sections[${i}] (${s.titre})`
}

function lireLivre(v: Verificateur, brut: unknown): Livre | null {
  const o = v.objet(brut, 'livre')
  if (!o) return null
  const titre = v.chaine(o.titre, 'livre.titre')
  const pagesTotal = o.pagesTotal === undefined ? undefined : v.entier(o.pagesTotal, 'livre.pagesTotal', 1)
  const motsParPage = v.entier(o.motsParPage, 'livre.motsParPage', 1)
  const premierePage = v.choix(o.premierePage, 'livre.premierePage', ['gauche', 'droite'] as const)
  if (titre === null || pagesTotal === null || motsParPage === null || premierePage === null) {
    return null
  }
  return { titre, ...(pagesTotal === undefined ? {} : { pagesTotal }), motsParPage, premierePage }
}

function lireParties(v: Verificateur, brut: unknown): Partie[] {
  const parties: Partie[] = []
  const vus = new Set<string>()
  v.liste(brut, 'parties').forEach((p, i) => {
    const chemin = `parties[${i}]`
    const o = v.objet(p, chemin)
    if (!o) return
    const id = v.chaine(o.id, `${chemin}.id`)
    const titre = v.chaine(o.titre, `${chemin}.titre`)
    const numerotee = v.booleen(o.numerotee, `${chemin}.numerotee`)
    if (id === null || titre === null || numerotee === null) return
    if (id === '') v.signaler(`${chemin}.id : ne doit pas être vide`)
    if (vus.has(id)) v.signaler(`${chemin} : l’identifiant de partie « ${id} » est en double`)
    vus.add(id)
    parties.push({ id, titre, numerotee })
  })
  return parties
}

function lireSection(
  v: Verificateur,
  brut: unknown,
  chemin: string,
  dossier: 'sections/' | 'corbeille/',
): Section | null {
  const o = v.objet(brut, chemin)
  if (!o) return null

  const id = v.chaine(o.id, `${chemin}.id`)
  if (id !== null && !MOTIF_ID.test(id)) {
    v.signaler(`${chemin}.id : 6 caractères parmi a-z et 0-9 attendus (trouvé : « ${id} »)`)
  }
  const type = v.choix(o.type, `${chemin}.type`, ['texte', 'hors-texte', 'blanche'] as const)
  const titre = v.chaine(o.titre, `${chemin}.titre`)
  const partie = v.chaine(o.partie, `${chemin}.partie`)
  const statut = v.choix(o.statut, `${chemin}.statut`, STATUTS)
  const pages = v.entier(o.pages, `${chemin}.pages`, 1)
  const debut = v.choix(o.debut, `${chemin}.debut`, DEBUTS)
  const resume = o.resume === undefined ? '' : v.chaine(o.resume, `${chemin}.resume`)

  if (
    id === null ||
    type === null ||
    titre === null ||
    partie === null ||
    statut === null ||
    pages === null ||
    debut === null ||
    resume === null
  ) {
    return null
  }
  const commun = { id, titre, partie, statut, pages, debut, resume }

  if (type === 'hors-texte' || type === 'blanche') {
    const nom = type === 'blanche' ? 'une page blanche' : 'un hors-texte'
    if (o.fichier !== undefined) v.signaler(`${chemin} : ${nom} n’a pas de fichier`)
    if (o.motsParPage !== undefined && o.motsParPage !== null) {
      v.signaler(`${chemin} : ${nom} n’a pas de mots par page`)
    }
    return { type, ...commun }
  }

  const fichier = v.chaine(o.fichier, `${chemin}.fichier`)
  if (fichier !== null && !(fichier.startsWith(dossier) && fichier.endsWith('.md'))) {
    v.signaler(`${chemin}.fichier : un chemin de la forme « ${dossier}….md » est attendu`)
  }
  const motsParPage =
    o.motsParPage === undefined || o.motsParPage === null
      ? null
      : v.entier(o.motsParPage, `${chemin}.motsParPage`, 1)
  if (fichier === null) return null
  return { type, ...commun, fichier, motsParPage }
}

function verifierUnicite(v: Verificateur, toutes: Section[]): void {
  const ids = new Set<string>()
  const fichiers = new Set<string>()
  for (const s of toutes) {
    if (ids.has(s.id)) v.signaler(`l’identifiant « ${s.id} » est utilisé deux fois`)
    ids.add(s.id)
    if (s.type === 'texte') {
      if (fichiers.has(s.fichier)) v.signaler(`le fichier « ${s.fichier} » est utilisé deux fois`)
      fichiers.add(s.fichier)
    }
  }
}

/** Accumule les problèmes au lieu de s'arrêter au premier. */
class Verificateur {
  readonly problemes: string[] = []

  signaler(message: string): void {
    this.problemes.push(message)
  }

  objet(valeur: unknown, chemin: string): Record<string, unknown> | null {
    if (typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)) {
      return valeur as Record<string, unknown>
    }
    this.signaler(`${chemin} : un objet est attendu`)
    return null
  }

  liste(valeur: unknown, chemin: string): unknown[] {
    if (Array.isArray(valeur)) return valeur as unknown[]
    this.signaler(`${chemin} : une liste est attendue`)
    return []
  }

  chaine(valeur: unknown, chemin: string): string | null {
    if (typeof valeur === 'string') return valeur
    this.signaler(`${chemin} : un texte est attendu`)
    return null
  }

  booleen(valeur: unknown, chemin: string): boolean | null {
    if (typeof valeur === 'boolean') return valeur
    this.signaler(`${chemin} : vrai ou faux attendu`)
    return null
  }

  entier(valeur: unknown, chemin: string, minimum: number): number | null {
    if (typeof valeur === 'number' && Number.isInteger(valeur) && valeur >= minimum) return valeur
    this.signaler(`${chemin} : un entier supérieur ou égal à ${minimum} est attendu`)
    return null
  }

  choix<T extends string>(valeur: unknown, chemin: string, valeurs: readonly T[]): T | null {
    const trouve = valeurs.find((c) => c === valeur)
    if (trouve !== undefined) return trouve
    this.signaler(
      `${chemin} : une valeur parmi ${valeurs.map((c) => `« ${c} »`).join(', ')} est attendue`,
    )
    return null
  }
}

/**
 * Écrit plan.json : indentation de deux espaces, clés dans un ordre fixe,
 * fin de ligne finale. Relire puis réécrire un plan donne les mêmes octets.
 */
export function serialiserPlan(plan: Plan): string {
  const donnees = {
    version: plan.version,
    livre: {
      titre: plan.livre.titre,
      ...(plan.livre.pagesTotal === undefined ? {} : { pagesTotal: plan.livre.pagesTotal }),
      motsParPage: plan.livre.motsParPage,
      premierePage: plan.livre.premierePage,
    },
    ...(plan.reglages
      ? {
          reglages: {
            typographie: {
              apostrophe: plan.reglages.typographie.apostrophe,
              guillemets: plan.reglages.typographie.guillemets,
              ponctuation: plan.reglages.typographie.ponctuation,
              suspension: plan.reglages.typographie.suspension,
              espaceFine: plan.reglages.typographie.espaceFine,
            },
            ...(plan.reglages.compilation ? { compilation: { modele: plan.reglages.compilation.modele } } : {}),
          },
        }
      : {}),
    parties: plan.parties.map((p) => ({ id: p.id, titre: p.titre, numerotee: p.numerotee })),
    sections: plan.sections.map(ordonnerSection),
    corbeille: plan.corbeille.map((e) => ({
      section: ordonnerSection(e.section),
      supprimeLe: e.supprimeLe,
      position: e.position,
    })),
  }
  return JSON.stringify(donnees, null, 2) + '\n'
}

function ordonnerSection(s: Section): Record<string, unknown> {
  const debut = { id: s.id, type: s.type, titre: s.titre }
  const fin = { partie: s.partie, statut: s.statut, pages: s.pages, debut: s.debut, resume: s.resume }
  if (s.type !== 'texte') return { ...debut, ...fin }
  return { ...debut, fichier: s.fichier, ...fin, motsParPage: s.motsParPage }
}

/** Sections du plan puis sections de la corbeille. */
export function toutesLesSections(plan: Plan): Section[] {
  return [...plan.sections, ...plan.corbeille.map((e) => e.section)]
}
