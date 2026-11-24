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

export interface DemandeEnvoi {
  plan: Plan
  /** SHA de plan.json quand les modifications locales ont commencé. */
  shaPlanBase: string | null
  message: string
  /** Envoie même si plan.json a changé sur GitHub entre-temps. */
  forcer: boolean
  /** Sections dont la corbeille a été vidée : leurs fichiers sont supprimés. */
  aSupprimer?: readonly string[]
}

export type ResultatEnvoi =
  | { type: 'envoye'; commit: string; plan: Plan; contenuPlan: string }
  | { type: 'conflit'; planDistant: Plan; shaPlanDistant: string }

const ESSAIS = 4

export async function envoyerPlan(
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
    if (!demande.forcer && shaPlanDistant !== demande.shaPlanBase) {
      return { type: 'conflit', planDistant, shaPlanDistant }
    }

    const { entrees, plan } = changementsFichiers(
      planDistant,
      demande.plan,
      instantane.fichiers,
      new Set(demande.aSupprimer ?? []),
    )
    const contenuPlan = serialiserPlan(plan)
    if (contenuPlan !== texteDistant) {
      entrees.push({ path: CHEMIN_PLAN, mode: '100644', type: 'blob', content: contenuPlan })
    }
    if (entrees.length === 0) return { type: 'envoye', commit: tete, plan, contenuPlan }

    const arbre = await client.ecrire('POST', `${racine}/git/trees`, {
      base_tree: instantane.arbre,
      tree: entrees,
    })
    const commit = await client.ecrire('POST', `${racine}/git/commits`, {
      message: demande.message,
      tree: sha(arbre),
      parents: [tete],
    })
    try {
      await client.ecrire('PATCH', `${racine}/git/refs/heads/${nomRef}`, { sha: sha(commit), force: false })
      return { type: 'envoye', commit: sha(commit), plan, contenuPlan }
    } catch (e) {
      // Un autre appareil a envoyé entre notre lecture et notre écriture :
      // on recommence sur la nouvelle tête de branche.
      if (e instanceof ErreurGitHub && e.nature === 'concurrence') continue
      throw e
    }
  }
  throw new ErreurGitHub('concurrence', 'Le dépôt change trop vite : l’envoi sera retenté.')
}

function sha(reponse: unknown): string {
  if (typeof reponse === 'object' && reponse !== null && 'sha' in reponse && typeof reponse.sha === 'string') {
    return reponse.sha
  }
  throw new ErreurGitHub('reponse', 'GitHub a renvoyé une réponse inattendue.')
}

/** Message de commit en français, à partir des descriptions des opérations. */
export function messageCommit(descriptions: readonly string[]): string {
  const uniques = [...new Set(descriptions)]
  if (uniques.length === 0) return 'Plan : mise à jour'
  if (uniques.length <= 3) return `Plan : ${uniques.join(', ')}`
  const reste = uniques.length - 3
  return `Plan : ${uniques.slice(0, 3).join(', ')} et ${reste} autre${reste > 1 ? 's' : ''} modification${reste > 1 ? 's' : ''}`
}
