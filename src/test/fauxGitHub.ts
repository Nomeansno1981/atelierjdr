/**
 * Imitation minimale de l'API Git Data de GitHub, pour les tests unitaires
 * (via `enFetch`) et les tests de bout en bout (via `repondre`).
 * Les empreintes des blobs sont de vrais SHA-1 Git. Jamais importé par le site.
 */

export interface ReponseFaux {
  statut: number
  corps: unknown
  entetes?: Record<string, string>
}

export class FauxGitHub {
  readonly proprietaire = 'autrice'
  readonly nom = 'katastrophe'
  readonly branche = 'main'
  jetonValide = 'jeton-valide'
  /** Simule un dépôt créé sans aucun commit. */
  vide = false
  /** Chemins d'API demandés, dans l'ordre. */
  readonly requetes: string[] = []

  private readonly blobs = new Map<string, string>()
  private arbre = new Map<string, string>()
  private numeroCommit = 0
  commit = ''

  static async creer(fichiers: Record<string, string>): Promise<FauxGitHub> {
    const faux = new FauxGitHub()
    await faux.publier(fichiers)
    return faux
  }

  /** Remplace tout le contenu du dépôt par un nouveau commit. */
  async publier(fichiers: Record<string, string>): Promise<void> {
    const arbre = new Map<string, string>()
    for (const [chemin, contenu] of Object.entries(fichiers)) {
      const sha = await shaBlobGit(contenu)
      this.blobs.set(sha, contenu)
      arbre.set(chemin, sha)
    }
    this.arbre = arbre
    this.numeroCommit++
    this.commit = this.numeroCommit.toString(16).padStart(40, 'c')
  }

  /** Nombre de blobs téléchargés depuis le début (ou depuis `oublierRequetes`). */
  get blobsTelecharges(): number {
    return this.requetes.filter((r) => r.includes('/git/blobs/')).length
  }

  oublierRequetes(): void {
    this.requetes.length = 0
  }

  repondre(methode: string, url: string, autorisation: string | null): ReponseFaux {
    const adresse = new URL(url)
    const chemin = adresse.pathname
    this.requetes.push(chemin + adresse.search)

    if (methode !== 'GET') return { statut: 405, corps: { message: 'Not implemented' } }
    if (autorisation !== `Bearer ${this.jetonValide}`) {
      return { statut: 401, corps: { message: 'Bad credentials' } }
    }

    const prefixe = `/repos/${this.proprietaire}/${this.nom}`
    if (chemin === prefixe) {
      return { statut: 200, corps: { default_branch: this.branche, private: true } }
    }
    if (!chemin.startsWith(prefixe + '/')) return introuvable()
    if (this.vide) return { statut: 409, corps: { message: 'Git Repository is empty.' } }

    const reste = chemin.slice(prefixe.length)
    if (reste === `/git/ref/heads/${this.branche}`) {
      return { statut: 200, corps: { ref: `refs/heads/${this.branche}`, object: { sha: this.commit, type: 'commit' } } }
    }
    if (reste === `/git/commits/${this.commit}`) {
      return { statut: 200, corps: { sha: this.commit, tree: { sha: `arbre-${this.commit}` } } }
    }
    if (reste === `/git/trees/arbre-${this.commit}` && adresse.searchParams.get('recursive') === '1') {
      const tree = [...this.arbre].map(([path, sha]) => ({ path, mode: '100644', type: 'blob', sha }))
      return { statut: 200, corps: { sha: `arbre-${this.commit}`, tree, truncated: false } }
    }
    const blob = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(reste)
    if (blob?.[1] !== undefined) {
      const contenu = this.blobs.get(blob[1])
      if (contenu === undefined) return introuvable()
      return { statut: 200, corps: { sha: blob[1], encoding: 'base64', content: base64AvecRetours(contenu) } }
    }
    return introuvable()
  }

  /** Un `fetch` branché sur ce faux dépôt, pour les tests unitaires. */
  enFetch(): typeof fetch {
    return (entree, init) => {
      const url = entree instanceof Request ? entree.url : String(entree)
      const entetes = new Headers(init?.headers)
      const r = this.repondre(init?.method ?? 'GET', url, entetes.get('Authorization'))
      return Promise.resolve(
        new Response(JSON.stringify(r.corps), {
          status: r.statut,
          headers: { 'Content-Type': 'application/json', ...r.entetes },
        }),
      )
    }
  }
}

function introuvable(): ReponseFaux {
  return { statut: 404, corps: { message: 'Not Found' } }
}

/** SHA-1 d'un blob Git : sha1("blob <taille>\0" + octets). */
export async function shaBlobGit(contenu: string): Promise<string> {
  const octets = new TextEncoder().encode(contenu)
  const entete = new TextEncoder().encode(`blob ${octets.length}\0`)
  const tout = new Uint8Array(entete.length + octets.length)
  tout.set(entete)
  tout.set(octets, entete.length)
  const empreinte = await crypto.subtle.digest('SHA-1', tout)
  return [...new Uint8Array(empreinte)].map((o) => o.toString(16).padStart(2, '0')).join('')
}

/** Base64 coupé toutes les 60 colonnes, comme le renvoie GitHub. */
function base64AvecRetours(contenu: string): string {
  const octets = new TextEncoder().encode(contenu)
  let binaire = ''
  for (const o of octets) binaire += String.fromCharCode(o)
  return (btoa(binaire).match(/.{1,60}/g) ?? []).join('\n') + '\n'
}
