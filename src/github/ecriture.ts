/**
 * Envoi du plan vers GitHub, en un seul commit atomique (API Git Data :
 * arbre, commit, puis mise à jour de la référence de branche).
 *
 * Les déplacements de fichiers ne sont pas mémorisés opération par
 * opération : ils se déduisent en comparant le plan local au plan distant.
 * Une section dont le chemin a changé voit son fichier déplacé, une section
 * nouvelle reçoit un fichier vide. Un fichier n'est supprimé que sur demande
 * explicite (corbeille vidée) : un fichier qui n'est simplement plus
 * référencé reste en place, et son texte avec.
 */

import { baseDuChemin, cheminLibre, type Dossier } from '../domaine/nomFichier'
import { lirePlan, serialiserPlan, toutesLesSections, type Plan } from '../domaine/plan'
import { shaBlobGit } from './empreinte'
import { ErreurGitHub, type ClientGitHub, type Depot } from './client'
import { lireArbreDuCommit, lireBlob, lireTete, racineDepot } from './lecture'
import { CHEMIN_PLAN } from './synchro'

export interface EntreeArbre {
  path: string
  mode: '100644'
  type: 'blob'
  /** null : suppression du fichier. */
  sha?: string | null
  content?: string
}

export interface Changements {
  entrees: EntreeArbre[]
  /** Le plan local, avec des chemins éventuellement corrigés pour éviter d'écraser un fichier. */
  plan: Plan
}

function cheminsParId(plan: Plan): Map<string, string> {
  const chemins = new Map<string, string>()
  for (const s of toutesLesSections(plan)) if (s.type === 'texte') chemins.set(s.id, s.fichier)
  return chemins
}

function dossierDe(chemin: string): Dossier {
  return chemin.startsWith('corbeille/') ? 'corbeille/' : 'sections/'
}

/**
 * @param aSupprimer identifiants des sections dont la corbeille a été vidée :
 *   seuls leurs fichiers peuvent être supprimés, et seulement si elles ne
 *   sont plus du tout dans le plan local (une annulation les y aurait remises).
 */
export function changementsFichiers(
  planDistant: Plan,
  planLocal: Plan,
  arbre: ReadonlyMap<string, string>,
  aSupprimer: ReadonlySet<string> = new Set(),
): Changements {
  const distants = cheminsParId(planDistant)
  const locaux = cheminsParId(planLocal)
  const referencesDistantes = new Set(distants.values())

  const deplacements: { id: string; de: string; vers: string }[] = []
  const creations: { id: string; vers: string }[] = []
  for (const [id, vers] of locaux) {
    const de = distants.get(id)
    if (de === undefined) creations.push({ id, vers })
    else if (de !== vers) deplacements.push({ id, de, vers })
  }
  const suppressions = new Set<string>()
  for (const [id, de] of distants) {
    if (!locaux.has(id) && aSupprimer.has(id) && arbre.has(de)) suppressions.add(de)
  }

  // Fichiers qui resteront en place : tout l'arbre, sauf ce qui part.
  const sources = new Set(deplacements.map((d) => d.de).filter((c) => arbre.has(c)))
  const occupes = new Set([...arbre.keys()].filter((c) => !sources.has(c) && !suppressions.has(c)))
  const reserves = new Set([...occupes, ...locaux.values()])
  const corrections = new Map<string, string>()

  function cheminSur(id: string, vers: string): string {
    if (!occupes.has(vers)) {
      occupes.add(vers)
      return vers
    }
    const libre = cheminLibre(dossierDe(vers), baseDuChemin(vers).replace(/-\d+$/, ''), reserves)
    reserves.add(libre)
    occupes.add(libre)
    corrections.set(id, libre)
    return libre
  }

  const entrees: EntreeArbre[] = []
  const destinations = new Set<string>()
  for (const d of deplacements) {
    const vers = cheminSur(d.id, d.vers)
    destinations.add(vers)
    const sha = arbre.get(d.de)
    // Fichier source absent du dépôt (jamais créé) : on crée un fichier vide.
    entrees.push(sha === undefined ? fichierVide(vers) : { path: vers, mode: '100644', type: 'blob', sha })
  }
  for (const c of creations) {
    // Un fichier orphelin au même chemin (laissé par une annulation, par
    // exemple) est repris tel quel : son texte n'est jamais écrasé.
    const orphelin = arbre.has(c.vers) && !referencesDistantes.has(c.vers) && !destinations.has(c.vers)
    if (orphelin && !sources.has(c.vers)) {
      destinations.add(c.vers)
      continue
    }
    const vers = cheminSur(c.id, c.vers)
    destinations.add(vers)
    entrees.push(fichierVide(vers))
  }
  for (const chemin of [...sources, ...suppressions]) {
    if (!destinations.has(chemin)) entrees.push({ path: chemin, mode: '100644', type: 'blob', sha: null })
  }

  return { entrees, plan: corrections.size === 0 ? planLocal : corrigerChemins(planLocal, corrections) }
}

function fichierVide(path: string): EntreeArbre {
  return { path, mode: '100644', type: 'blob', content: '' }
}

function corrigerChemins(plan: Plan, corrections: ReadonlyMap<string, string>): Plan {
  const corriger = <S extends Plan['sections'][number]>(s: S): S => {
    const chemin = corrections.get(s.id)
    return chemin !== undefined && s.type === 'texte' ? { ...s, fichier: chemin } : s
  }
  return {
    ...plan,
    sections: plan.sections.map(corriger),
    corbeille: plan.corbeille.map((e) => ({ ...e, section: corriger(e.section) })),
  }
}

/** Texte d'une section à envoyer. */
export interface TexteAEnvoyer {
  id: string
  contenu: string
  /** SHA du fichier sur GitHub quand la modification a commencé. */
  shaBase: string | null
  /** Conflit déjà détecté : la version locale est sauvegardée à ce chemin. */
  conflit?: { chemin: string } | undefined
  /** Résolution « garder ma version » : écrire même si GitHub a changé. */
  forcer?: boolean
  /** Résolution « prendre celle de GitHub » : ne rien écrire, effacer la sauvegarde. */
  abandonner?: boolean
}

export type ResultatTexte =
  | { type: 'ecrit' }
  | { type: 'identique' }
  | { type: 'abandonne' }
  /** GitHub a une autre version : la locale est sauvegardée dans conflits/. */
  | { type: 'conflit'; chemin: string; shaDistant: string | null }

export interface DemandeEnvoi {
  /** Plan modifié sur l'appareil, ou null si seul du texte est à envoyer. */
  plan: Plan | null
  /** SHA de plan.json quand les modifications du plan ont commencé. */
  shaPlanBase: string | null
  /** Envoie le plan même si plan.json a changé sur GitHub entre-temps. */
  forcer: boolean
  /** Sections dont la corbeille a été vidée : leurs fichiers sont supprimés. */
  aSupprimer?: readonly string[]
  textes?: readonly TexteAEnvoyer[]
  /** Message de commit, selon les textes finalement en conflit. */
  message: (conflits: readonly string[]) => string
  maintenant?: Date
}

export type ResultatEnvoi =
  | {
      type: 'envoye'
      commit: string
      plan: Plan
      contenuPlan: string
      textes: ReadonlyMap<string, ResultatTexte>
      /** Contenus écrits : connus de l'appareil, inutile de les retélécharger. */
      contenus: string[]
    }
  | { type: 'conflit'; planDistant: Plan; shaPlanDistant: string }

const ESSAIS = 4

export async function envoyer(
  client: ClientGitHub,
  depot: Depot,
  branche: string,
  demande: DemandeEnvoi,
): Promise<ResultatEnvoi> {
  const racine = racineDepot(depot)
  const nomRef = branche.split('/').map(encodeURIComponent).join('/')

  for (let essai = 0; essai < ESSAIS; essai++) {
    const tete = await lireTete(client, depot, branche)
    const instantane = await lireArbreDuCommit(client, depot, tete)
    const shaPlanDistant = instantane.fichiers.get(CHEMIN_PLAN)
    if (shaPlanDistant === undefined) {
      throw new ErreurGitHub('reponse', 'plan.json a disparu du dépôt sur GitHub.')
    }
    const texteDistant = await lireBlob(client, depot, shaPlanDistant)
    const planDistant = lirePlan(texteDistant)
    if (demande.plan && !demande.forcer && shaPlanDistant !== demande.shaPlanBase) {
      return { type: 'conflit', planDistant, shaPlanDistant }
    }

    const { entrees, plan } = changementsFichiers(
      planDistant,
      demande.plan ?? planDistant,
      instantane.fichiers,
      new Set(demande.aSupprimer ?? []),
    )
    const { resultats, conflits, contenus } = await ajouterTextes(
      entrees,
      demande.textes ?? [],
      planDistant,
      plan,
      instantane.fichiers,
      demande.maintenant ?? new Date(),
    )
    const contenuPlan = serialiserPlan(plan)
    if (contenuPlan !== texteDistant) {
      entrees.push({ path: CHEMIN_PLAN, mode: '100644', type: 'blob', content: contenuPlan })
    }
    contenus.push(contenuPlan, '')
    if (entrees.length === 0) return { type: 'envoye', commit: tete, plan, contenuPlan, textes: resultats, contenus }

    const arbre = await client.ecrire('POST', `${racine}/git/trees`, {
      base_tree: instantane.arbre,
      tree: entrees,
    })
    const commit = await client.ecrire('POST', `${racine}/git/commits`, {
      message: demande.message(conflits),
      tree: sha(arbre),
      parents: [tete],
    })
    try {
      await client.ecrire('PATCH', `${racine}/git/refs/heads/${nomRef}`, { sha: sha(commit), force: false })
      return { type: 'envoye', commit: sha(commit), plan, contenuPlan, textes: resultats, contenus }
    } catch (e) {
      // Un autre appareil a envoyé entre notre lecture et notre écriture :
      // on recommence sur la nouvelle tête de branche.
      if (e instanceof ErreurGitHub && e.nature === 'concurrence') continue
      throw e
    }
  }
  throw new ErreurGitHub('concurrence', 'Le dépôt change trop vite : l’envoi sera retenté.')
}

/**
 * Ajoute les textes aux entrées de l'arbre. Un texte n'écrase jamais une
 * version de GitHub qu'il n'a pas vue : si le fichier a changé depuis le
 * début des modifications locales, la version locale est écrite dans
 * conflits/ et celle de GitHub reste en place.
 */
async function ajouterTextes(
  entrees: EntreeArbre[],
  textes: readonly TexteAEnvoyer[],
  planDistant: Plan,
  planLocal: Plan,
  arbre: ReadonlyMap<string, string>,
  maintenant: Date,
): Promise<{ resultats: Map<string, ResultatTexte>; conflits: string[]; contenus: string[] }> {
  const distants = cheminsParId(planDistant)
  const locaux = cheminsParId(planLocal)
  const resultats = new Map<string, ResultatTexte>()
  const conflits: string[] = []
  const contenus: string[] = []
  const pris = new Set([...arbre.keys(), ...entrees.map((e) => e.path)])

  const ecrire = (path: string, content: string) => {
    const i = entrees.findIndex((e) => e.path === path)
    const entree: EntreeArbre = { path, mode: '100644', type: 'blob', content }
    if (i === -1) entrees.push(entree)
    else entrees[i] = entree
    contenus.push(content)
  }
  const effacer = (path: string) => {
    if (arbre.has(path) && !entrees.some((e) => e.path === path)) {
      entrees.push({ path, mode: '100644', type: 'blob', sha: null })
    }
  }

  for (const t of textes) {
    if (t.abandonner) {
      if (t.conflit) effacer(t.conflit.chemin)
      resultats.set(t.id, { type: 'abandonne' })
      continue
    }
    const cheminDistant = distants.get(t.id)
    const shaDistant = (cheminDistant !== undefined ? arbre.get(cheminDistant) : undefined) ?? null
    const cheminLocal = locaux.get(t.id)
    const shaLocal = await shaBlobGit(t.contenu)

    if (cheminLocal !== undefined && shaDistant === shaLocal) {
      if (t.conflit) effacer(t.conflit.chemin)
      resultats.set(t.id, { type: 'identique' })
      continue
    }
    if (cheminLocal === undefined || (shaDistant !== t.shaBase && !t.forcer)) {
      // Section disparue du plan, ou texte modifié ailleurs : on sauvegarde.
      const base = cheminLocal ?? cheminDistant ?? `section-${t.id}.md`
      const chemin = t.conflit?.chemin ?? cheminLibre('conflits/', `${baseDuChemin(base)}-${horodatage(maintenant)}`, pris)
      pris.add(chemin)
      ecrire(chemin, t.contenu)
      conflits.push(t.id)
      resultats.set(t.id, { type: 'conflit', chemin, shaDistant })
      continue
    }
    ecrire(cheminLocal, t.contenu)
    if (t.conflit) effacer(t.conflit.chemin)
    resultats.set(t.id, { type: 'ecrit' })
  }
  return { resultats, conflits, contenus }
}

/**
 * Écrit des fichiers dans le dépôt en un commit, sans toucher au reste :
 * compilation et script de compilation. Recommence si la branche a bougé.
 */
export async function ecrireFichiers(
  client: ClientGitHub,
  depot: Depot,
  branche: string,
  fichiers: readonly { chemin: string; contenu: string }[],
  message: string,
): Promise<string> {
  const racine = racineDepot(depot)
  const nomRef = branche.split('/').map(encodeURIComponent).join('/')
  const tree: EntreeArbre[] = fichiers.map((f) => ({ path: f.chemin, mode: '100644', type: 'blob', content: f.contenu }))
  for (let essai = 0; essai < ESSAIS; essai++) {
    const tete = await lireTete(client, depot, branche)
    const instantane = await lireArbreDuCommit(client, depot, tete)
    const arbre = await client.ecrire('POST', `${racine}/git/trees`, { base_tree: instantane.arbre, tree })
    const commit = await client.ecrire('POST', `${racine}/git/commits`, { message, tree: sha(arbre), parents: [tete] })
    try {
      await client.ecrire('PATCH', `${racine}/git/refs/heads/${nomRef}`, { sha: sha(commit), force: false })
      return sha(commit)
    } catch (e) {
      if (e instanceof ErreurGitHub && e.nature === 'concurrence') continue
      throw e
    }
  }
  throw new ErreurGitHub('concurrence', 'Le dépôt change trop vite : réessayez dans un instant.')
}

/** « 2026-11-25-1432 », à l'heure de l'appareil. */
function horodatage(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}-${deux(d.getHours())}${deux(d.getMinutes())}`
}

function sha(reponse: unknown): string {
  if (typeof reponse === 'object' && reponse !== null && 'sha' in reponse && typeof reponse.sha === 'string') {
    return reponse.sha
  }
  throw new ErreurGitHub('reponse', 'GitHub a renvoyé une réponse inattendue.')
}

/**
 * Message de commit en français. Exemples : « Rédaction : Le heurt, Les
 * serments » ; « Plan : déplacement de Le heurt » ; les deux séparés par
 * un point-virgule.
 */
export function messageCommit(
  descriptionsPlan: readonly string[],
  titresRedaction: readonly string[] = [],
  titresEnConflit: readonly string[] = [],
): string {
  const parties: string[] = []
  const redaction = [...new Set(titresRedaction)]
  if (redaction.length > 0) parties.push(`Rédaction : ${liste(redaction)}`)
  if (titresEnConflit.length > 0) {
    parties.push(`Conflit : version de l’appareil sauvegardée dans conflits/ pour ${liste([...new Set(titresEnConflit)])}`)
  }
  const plan = [...new Set(descriptionsPlan)]
  if (plan.length > 0) parties.push(`Plan : ${liste(plan)}`)
  return parties.length > 0 ? parties.join(' ; ') : 'Plan : mise à jour'
}

function liste(elements: readonly string[]): string {
  if (elements.length <= 3) return elements.join(', ')
  const reste = elements.length - 3
  return `${elements.slice(0, 3).join(', ')} et ${reste} autre${reste > 1 ? 's' : ''} modification${reste > 1 ? 's' : ''}`
}
