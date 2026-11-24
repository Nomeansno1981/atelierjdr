/**
 * Accès bas niveau à l'API REST de GitHub. Seul fichier qui appelle fetch.
 * Toutes les erreurs sont traduites en `ErreurGitHub`, avec un message en
 * français et une nature exploitable par l'interface.
 */

export const API_GITHUB = 'https://api.github.com'
const DELAI_MAX_MS = 20_000

export interface Depot {
  proprietaire: string
  nom: string
}

export function nomComplet(depot: Depot): string {
  return `${depot.proprietaire}/${depot.nom}`
}

export function memeDepot(a: Depot, b: Depot): boolean {
  return (
    a.proprietaire.toLowerCase() === b.proprietaire.toLowerCase() &&
    a.nom.toLowerCase() === b.nom.toLowerCase()
  )
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/

/**
 * Accepte « utilisateur/katastrophe » ou une adresse GitHub complète.
 * Renvoie null si la saisie ne désigne pas un dépôt.
 */
export function lireNomDepot(saisie: string): Depot | null {
  const nettoye = saisie
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  const morceaux = nettoye.split('/')
  if (morceaux.length !== 2) return null
  const [proprietaire, nom] = morceaux
  if (!proprietaire || !nom || !SEGMENT.test(proprietaire) || !SEGMENT.test(nom)) return null
  return { proprietaire, nom }
}

export type NatureErreur =
  | 'jeton'
  | 'permission'
  | 'introuvable'
  | 'depot-vide'
  | 'limite'
  | 'reseau'
  /** La branche a bougé entre la lecture et l'écriture : il faut recommencer. */
  | 'concurrence'
  | 'reponse'

export class ErreurGitHub extends Error {
  readonly nature: NatureErreur
  readonly statut: number | null

  constructor(nature: NatureErreur, message: string, statut: number | null = null) {
    super(message)
    this.name = 'ErreurGitHub'
    this.nature = nature
    this.statut = statut
  }
}

export interface ClientGitHub {
  /** GET sur un chemin de l'API, par exemple « /repos/a/b ». */
  lire(chemin: string): Promise<unknown>
  /** POST ou PATCH avec un corps JSON. */
  ecrire(methode: 'POST' | 'PATCH', chemin: string, corps: unknown): Promise<unknown>
}

export function creerClient(
  jeton: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): ClientGitHub {
  async function requete(methode: string, chemin: string, corps?: unknown): Promise<unknown> {
    const entetes: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${jeton}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (corps !== undefined) entetes['Content-Type'] = 'application/json'
    let reponse: Response
    try {
      reponse = await fetchImpl(API_GITHUB + chemin, {
        method: methode,
        headers: entetes,
        body: corps === undefined ? null : JSON.stringify(corps),
        // Les réponses de l'API sont mises en cache 60 s par le navigateur :
        // une référence de branche périmée ferait manquer des modifications.
        cache: 'no-store',
        signal: AbortSignal.timeout(DELAI_MAX_MS),
      })
    } catch {
      throw new ErreurGitHub('reseau', 'GitHub est injoignable : vérifiez la connexion.')
    }
    if (!reponse.ok) throw await traduireErreur(reponse)
    try {
      return (await reponse.json()) as unknown
    } catch {
      throw new ErreurGitHub('reponse', 'GitHub a renvoyé une réponse illisible.', reponse.status)
    }
  }

  return {
    lire: (chemin) => requete('GET', chemin),
    ecrire: (methode, chemin, corps) => requete(methode, chemin, corps),
  }
}

async function traduireErreur(reponse: Response): Promise<ErreurGitHub> {
  const statut = reponse.status
  let detail = ''
  try {
    const corps: unknown = await reponse.json()
    if (typeof corps === 'object' && corps !== null && 'message' in corps) {
      detail = String(corps.message)
    }
  } catch {
    // Corps absent ou non JSON : le statut suffit.
  }

  if (statut === 401) {
    return new ErreurGitHub('jeton', 'Le jeton est invalide, expiré ou révoqué.', statut)
  }
  if ((statut === 403 || statut === 429) && reponse.headers.get('x-ratelimit-remaining') === '0') {
    return new ErreurGitHub(
      'limite',
      'Trop de requêtes vers GitHub : réessayez dans quelques minutes.',
      statut,
    )
  }
  if (statut === 403) {
    return new ErreurGitHub(
      'permission',
      'Le jeton n’a pas les droits nécessaires sur ce dépôt (permission « Contents » en lecture et écriture).',
      statut,
    )
  }
  if (statut === 404) {
    return new ErreurGitHub(
      'introuvable',
      'Dépôt introuvable : vérifiez son nom et que le jeton y donne accès.',
      statut,
    )
  }
  if (statut === 422 && /fast.?forward/i.test(detail)) {
    return new ErreurGitHub('concurrence', 'La branche a changé pendant l’envoi.', statut)
  }
  if (statut === 409 && /empty/i.test(detail)) {
    return new ErreurGitHub(
      'depot-vide',
      'Le dépôt est vide. Créez-le avec un README (voir la documentation de l’Atelier).',
      statut,
    )
  }
  return new ErreurGitHub(
    'reponse',
    `GitHub a répondu par une erreur ${statut}${detail ? ` (${detail})` : ''}.`,
    statut,
  )
}
