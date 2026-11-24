/**
 * Imitation de l'API Git Data de GitHub, pour les tests unitaires (via
 * `enFetch`) et les tests de bout en bout (via `repondre`). Lecture et
 * écriture : arbres, commits, mise à jour de branche en avance rapide.
 * Les empreintes des blobs sont de vrais SHA-1 Git. Jamais importé par le site.
 */

import { shaBlobGit } from '../github/empreinte'

export { shaBlobGit }

export interface ReponseFaux {
  statut: number
  corps: unknown
  entetes?: Record<string, string>
}

interface Commit {
  arbre: string
  parents: string[]
  message: string
}

export class FauxGitHub {
  readonly proprietaire = 'autrice'
  readonly nom = 'katastrophe'
  readonly branche = 'main'
  jetonValide = 'jeton-valide'
  /** Simule un dépôt créé sans aucun commit. */
  vide = false
  /** Requêtes reçues (« GET /chemin »), dans l'ordre. */
  readonly requetes: string[] = []
  /** Appelé juste avant d'accepter une mise à jour de branche : permet de simuler un envoi concurrent. */
  avantMiseAJourBranche: (() => Promise<void>) | null = null

  private readonly blobs = new Map<string, string>()
  private readonly arbres = new Map<string, Map<string, string>>()
  private readonly commits = new Map<string, Commit>()
  private compteur = 0
  /** SHA du commit en tête de branche. */
  commit = ''

  static async creer(fichiers: Record<string, string>): Promise<FauxGitHub> {
    const faux = new FauxGitHub()
    await faux.publier(fichiers, 'Création')
    return faux
  }

  /** Remplace tout le contenu du dépôt par un nouveau commit (comme un autre appareil). */
  async publier(fichiers: Record<string, string>, message = 'Modification ailleurs'): Promise<void> {
    const arbre = new Map<string, string>()
    for (const [chemin, contenu] of Object.entries(fichiers)) arbre.set(chemin, await this.ajouterBlob(contenu))
    const shaArbre = this.ajouterArbre(arbre)
    this.commit = this.ajouterCommit({ arbre: shaArbre, parents: this.commit ? [this.commit] : [], message })
  }

  /** Contenu des fichiers en tête de branche. */
  fichiers(): Record<string, string> {
    const resultat: Record<string, string> = {}
    for (const [chemin, sha] of this.arbreDe(this.commit)) resultat[chemin] = this.blobs.get(sha) ?? ''
    return resultat
  }

  /** Messages des commits, du plus récent au plus ancien. */
  messages(): string[] {
    const liste: string[] = []
    for (let sha: string | undefined = this.commit; sha; sha = this.commits.get(sha)?.parents[0]) {
      liste.push(this.commits.get(sha)?.message ?? '')
    }
    return liste
  }

  get blobsTelecharges(): number {
    return this.requetes.filter((r) => r.startsWith('GET') && r.includes('/git/blobs/')).length
  }

  get envois(): number {
    return this.requetes.filter((r) => r.startsWith('PATCH')).length
  }

  oublierRequetes(): void {
    this.requetes.length = 0
  }

  async repondre(methode: string, url: string, autorisation: string | null, corps: unknown = null): Promise<ReponseFaux> {
    const adresse = new URL(url)
    const chemin = adresse.pathname
    this.requetes.push(`${methode} ${chemin}${adresse.search}`)

    if (autorisation !== `Bearer ${this.jetonValide}`) return { statut: 401, corps: { message: 'Bad credentials' } }

    const prefixe = `/repos/${this.proprietaire}/${this.nom}`
    if (chemin === prefixe && methode === 'GET') {
      return ok({ default_branch: this.branche, private: true })
    }
    if (!chemin.startsWith(prefixe + '/')) return introuvable()
    if (this.vide) return { statut: 409, corps: { message: 'Git Repository is empty.' } }
    const reste = chemin.slice(prefixe.length)

    if (methode === 'GET') {
      if (reste === `/git/ref/heads/${this.branche}`) {
        return ok({ ref: `refs/heads/${this.branche}`, object: { sha: this.commit, type: 'commit' } })
      }
      const commit = /^\/git\/commits\/(\w+)$/.exec(reste)?.[1]
      if (commit !== undefined) {
        const c = this.commits.get(commit)
        return c ? ok({ sha: commit, tree: { sha: c.arbre }, parents: c.parents.map((sha) => ({ sha })) }) : introuvable()
      }
      const arbre = /^\/git\/trees\/(\w+)$/.exec(reste)?.[1]
      if (arbre !== undefined && adresse.searchParams.get('recursive') === '1') {
        const a = this.arbres.get(arbre)
        if (!a) return introuvable()
        const tree = [...a].map(([path, sha]) => ({ path, mode: '100644', type: 'blob', sha }))
        return ok({ sha: arbre, tree, truncated: false })
      }
      const blob = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(reste)?.[1]
      if (blob !== undefined) {
        const contenu = this.blobs.get(blob)
        return contenu === undefined ? introuvable() : ok({ sha: blob, encoding: 'base64', content: base64AvecRetours(contenu) })
      }
      return introuvable()
    }

    const donnees = (typeof corps === 'object' && corps !== null ? corps : {}) as Record<string, unknown>
    if (methode === 'POST' && reste === '/git/trees') {
      const base = this.arbres.get(String(donnees.base_tree))
      if (!base) return { statut: 422, corps: { message: 'base_tree invalide' } }
      const nouveau = new Map(base)
      for (const entree of donnees.tree as { path: string; sha?: string | null; content?: string }[]) {
        if (entree.sha === null) nouveau.delete(entree.path)
        else if (entree.content !== undefined) nouveau.set(entree.path, await this.ajouterBlob(entree.content))
        else if (entree.sha !== undefined && this.blobs.has(entree.sha)) nouveau.set(entree.path, entree.sha)
        else return { statut: 422, corps: { message: `Entrée invalide : ${entree.path}` } }
      }
      return { statut: 201, corps: { sha: this.ajouterArbre(nouveau) } }
    }
    if (methode === 'POST' && reste === '/git/commits') {
      const arbre = String(donnees.tree)
      if (!this.arbres.has(arbre)) return { statut: 422, corps: { message: 'Arbre inconnu' } }
      const sha = this.ajouterCommit({ arbre, parents: donnees.parents as string[], message: String(donnees.message) })
      return { statut: 201, corps: { sha } }
    }
    if (methode === 'PATCH' && reste === `/git/refs/heads/${this.branche}`) {
      if (this.avantMiseAJourBranche) {
        const rappel = this.avantMiseAJourBranche
        this.avantMiseAJourBranche = null
        await rappel()
      }
      const sha = String(donnees.sha)
      const commit = this.commits.get(sha)
      if (!commit) return { statut: 422, corps: { message: 'Object does not exist' } }
      if (donnees.force !== true && commit.parents[0] !== this.commit) {
        return { statut: 422, corps: { message: 'Update is not a fast forward' } }
      }
      this.commit = sha
      return ok({ ref: `refs/heads/${this.branche}`, object: { sha } })
    }
    return { statut: 405, corps: { message: 'Not implemented' } }
  }

  /** Un `fetch` branché sur ce faux dépôt, pour les tests unitaires. */
  enFetch(): typeof fetch {
    return async (entree, init) => {
      const url = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url
      const entetes = new Headers(init?.headers)
      const corps: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      const r = await this.repondre(init?.method ?? 'GET', url, entetes.get('Authorization'), corps)
      return new Response(JSON.stringify(r.corps), {
        status: r.statut,
        headers: { 'Content-Type': 'application/json', ...r.entetes },
      })
    }
  }

  private arbreDe(commit: string): Map<string, string> {
    return this.arbres.get(this.commits.get(commit)?.arbre ?? '') ?? new Map<string, string>()
  }

  private async ajouterBlob(contenu: string): Promise<string> {
    const sha = await shaBlobGit(contenu)
    this.blobs.set(sha, contenu)
    return sha
  }

  private ajouterArbre(arbre: Map<string, string>): string {
    const sha = `a${(++this.compteur).toString(16).padStart(39, '0')}`
    this.arbres.set(sha, arbre)
    return sha
  }

  private ajouterCommit(commit: Commit): string {
    const sha = `c${(++this.compteur).toString(16).padStart(39, '0')}`
    this.commits.set(sha, commit)
    return sha
  }
}

function ok(corps: unknown): ReponseFaux {
  return { statut: 200, corps }
}

function introuvable(): ReponseFaux {
  return { statut: 404, corps: { message: 'Not Found' } }
}

/** Base64 coupé toutes les 60 colonnes, comme le renvoie GitHub. */
function base64AvecRetours(contenu: string): string {
  const octets = new TextEncoder().encode(contenu)
  let binaire = ''
  for (const o of octets) binaire += String.fromCharCode(o)
  return (btoa(binaire).match(/.{1,60}/g) ?? []).join('\n') + '\n'
}
