/**
 * Lecture du dépôt par l'API Git Data : référence → commit → arbre → blobs.
 * Les blobs sont adressés par leur empreinte SHA, ce qui permet de ne
 * télécharger que les fichiers qui ont changé.
 */

import { ErreurGitHub, type ClientGitHub, type Depot } from './client'

export interface InfosDepot {
  brancheParDefaut: string
}

export interface InstantaneDistant {
  /** SHA du commit en tête de branche. */
  commit: string
  /** SHA de l'arbre racine de ce commit. */
  arbre: string
  /** Date du commit (ISO), pour départager une fusion ; null si GitHub ne la donne pas. */
  date: string | null
  /** Chemin du fichier → SHA de son blob. */
  fichiers: Map<string, string>
}

function racine(depot: Depot): string {
  return `/repos/${encodeURIComponent(depot.proprietaire)}/${encodeURIComponent(depot.nom)}`
}

export async function lireInfosDepot(client: ClientGitHub, depot: Depot): Promise<InfosDepot> {
  const reponse = objet(await client.lire(racine(depot)))
  return { brancheParDefaut: chaine(reponse, 'default_branch') }
}

/** SHA du commit en tête de branche : une seule requête. */
export async function lireTete(client: ClientGitHub, depot: Depot, branche: string): Promise<string> {
  const nomRef = branche.split('/').map(encodeURIComponent).join('/')
  const ref = objet(await client.lire(`${racine(depot)}/git/ref/heads/${nomRef}`))
  return chaine(objet(ref.object), 'sha')
}

export async function lireInstantane(
  client: ClientGitHub,
  depot: Depot,
  branche: string,
): Promise<InstantaneDistant> {
  return lireArbreDuCommit(client, depot, await lireTete(client, depot, branche))
}

export async function lireArbreDuCommit(
  client: ClientGitHub,
  depot: Depot,
  commit: string,
): Promise<InstantaneDistant> {
  const donneesCommit = objet(await client.lire(`${racine(depot)}/git/commits/${commit}`))
  const arbre = chaine(objet(donneesCommit.tree), 'sha')

  const donneesArbre = objet(await client.lire(`${racine(depot)}/git/trees/${arbre}?recursive=1`))
  if (donneesArbre.truncated === true) {
    throw new ErreurGitHub('reponse', 'Le dépôt contient trop de fichiers pour être lu en une fois.')
  }
  const fichiers = new Map<string, string>()
  const entrees = donneesArbre.tree
  if (!Array.isArray(entrees)) throw reponseInattendue()
  for (const brute of entrees as unknown[]) {
    const entree = objet(brute)
    if (entree.type === 'blob') fichiers.set(chaine(entree, 'path'), chaine(entree, 'sha'))
  }
  const auteur = donneesCommit.committer
  const date =
    typeof auteur === 'object' && auteur !== null && 'date' in auteur && typeof auteur.date === 'string' ? auteur.date : null
  return { commit, arbre, date, fichiers }
}

export async function lireBlob(client: ClientGitHub, depot: Depot, sha: string): Promise<string> {
  const blob = objet(await client.lire(`${racine(depot)}/git/blobs/${sha}`))
  if (blob.encoding !== 'base64') throw reponseInattendue()
  return decoderBase64Utf8(chaine(blob, 'content'))
}

/**
 * Décode le contenu d'un blob. Aucune transformation du texte : la marque
 * d'ordre des octets éventuelle est conservée, et un fichier qui n'est pas
 * en UTF-8 valide est refusé plutôt que corrompu.
 */
export function racineDepot(depot: Depot): string {
  return racine(depot)
}

/** Ce que contient un dépôt, vu de l'Atelier. */
export type ContenuDepot = 'manuscrit' | 'sans-plan' | 'vide'

/**
 * Branche par défaut d'un dépôt et ce qu'il contient : un manuscrit (un
 * plan.json à la racine), d'autres fichiers seulement, ou rien du tout (un
 * dépôt créé sans README n'a encore aucun commit).
 */
export async function examinerDepot(
  client: ClientGitHub,
  depot: Depot,
): Promise<{ branche: string; contenu: ContenuDepot }> {
  const { brancheParDefaut: branche } = await lireInfosDepot(client, depot)
  let tete: string
  try {
    tete = await lireTete(client, depot, branche)
  } catch (e) {
    if (e instanceof ErreurGitHub && e.nature === 'depot-vide') return { branche, contenu: 'vide' }
    throw e
  }
  const { fichiers } = await lireArbreDuCommit(client, depot, tete)
  return { branche, contenu: fichiers.has('plan.json') ? 'manuscrit' : 'sans-plan' }
}

/** Encode un texte en base64, octets UTF-8 compris. */
export function encoderBase64Utf8(texte: string): string {
  let binaire = ''
  for (const o of new TextEncoder().encode(texte)) binaire += String.fromCharCode(o)
  return btoa(binaire)
}

export function decoderBase64Utf8(base64: string): string {
  const binaire = atob(base64.replace(/\s/g, ''))
  const octets = Uint8Array.from(binaire, (c) => c.charCodeAt(0))
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(octets)
  } catch {
    throw new ErreurGitHub('reponse', 'Un fichier du dépôt n’est pas encodé en UTF-8.')
  }
}

function reponseInattendue(): ErreurGitHub {
  return new ErreurGitHub('reponse', 'GitHub a renvoyé une réponse inattendue.')
}

function objet(valeur: unknown): Record<string, unknown> {
  if (typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)) {
    return valeur as Record<string, unknown>
  }
  throw reponseInattendue()
}

function chaine(o: Record<string, unknown>, cle: string): string {
  const valeur = o[cle]
  if (typeof valeur !== 'string') throw reponseInattendue()
  return valeur
}
