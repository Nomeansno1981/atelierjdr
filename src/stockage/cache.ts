/**
 * Cache local dans IndexedDB : la connexion de l'appareil et une copie des
 * fichiers du manuscrit telle qu'au dernier commit synchronisé.
 *
 * Le magasin « fichiers » ne contient que ce qui est sur GitHub. Les
 * modifications locales pas encore envoyées vivent dans « brouillon ».
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Plan } from '../domaine/plan'
import type { Depot } from '../github/client'

export const NOM_BASE = 'atelier'

export interface Connexion {
  /** null après un 401 : le dépôt reste connu, le jeton est à ressaisir. */
  jeton: string | null
  depot: Depot
  branche: string
}

export interface FichierCache {
  chemin: string
  /** SHA du blob Git, pour ne retélécharger que ce qui a changé. */
  sha: string
  contenu: string
}

export interface BaseSynchro {
  /** Dernier commit dont le contenu est entièrement dans le cache. */
  commit: string
  /** Date ISO de la synchronisation. */
  le: string
  /** Noms des fichiers de compilations/ sur GitHub (pas leur contenu). */
  compilations?: string[]
}

/** Plan modifié sur cet appareil et pas encore envoyé à GitHub. */
export interface BrouillonPlan {
  plan: Plan
  /** SHA de plan.json au début des modifications : sert à détecter un conflit. */
  shaPlanBase: string | null
  /** Descriptions des opérations, pour le message de commit. */
  descriptions: string[]
  /** Sections dont la corbeille a été vidée : leurs fichiers seront supprimés. */
  aSupprimer?: string[]
  /** Augmente à chaque opération : distingue un brouillon modifié pendant l'envoi. */
  revision: number
  /** Date ISO de la dernière opération. */
  modifieLe: string
}

/** Texte d'une section modifié sur cet appareil et pas encore envoyé. */
export interface BrouillonTexte {
  /** Identifiant de la section (stable, contrairement au chemin du fichier). */
  id: string
  contenu: string
  /** SHA du blob sur GitHub quand la modification a commencé ; null si le fichier n'existait pas. */
  shaBase: string | null
  revision: number
  modifieLe: string
  /** Conflit détecté à l'envoi : la version locale est sauvegardée à ce chemin. */
  conflit?: { chemin: string; shaDistant: string | null }
}

interface Schema extends DBSchema {
  appareil: { key: 'connexion'; value: Connexion }
  synchro: { key: 'base'; value: BaseSynchro }
  fichiers: { key: string; value: FichierCache }
  brouillon: { key: 'plan'; value: BrouillonPlan }
  textes: { key: string; value: BrouillonTexte }
}

export class Cache {
  private constructor(private readonly db: IDBPDatabase<Schema>) {}

  static async ouvrir(nom: string = NOM_BASE): Promise<Cache> {
    const db = await openDB<Schema>(nom, 3, {
      upgrade(base, ancienneVersion) {
        if (ancienneVersion < 1) {
          base.createObjectStore('appareil')
          base.createObjectStore('synchro')
          base.createObjectStore('fichiers', { keyPath: 'chemin' })
        }
        if (ancienneVersion < 2) base.createObjectStore('brouillon')
        if (ancienneVersion < 3) base.createObjectStore('textes', { keyPath: 'id' })
      },
    })
    return new Cache(db)
  }

  fermer(): void {
    this.db.close()
  }

  async lireConnexion(): Promise<Connexion | null> {
    return (await this.db.get('appareil', 'connexion')) ?? null
  }

  async enregistrerConnexion(connexion: Connexion): Promise<void> {
    await this.db.put('appareil', connexion, 'connexion')
  }

  async lireBase(): Promise<BaseSynchro | null> {
    return (await this.db.get('synchro', 'base')) ?? null
  }

  async lireFichiers(): Promise<Map<string, FichierCache>> {
    const tous = await this.db.getAll('fichiers')
    return new Map(tous.map((f) => [f.chemin, f]))
  }

  /**
   * Applique une synchronisation en une seule transaction : soit tout le
   * nouveau commit est dans le cache, soit rien ne change.
   */
  async appliquerSynchro(
    base: BaseSynchro,
    aEcrire: readonly FichierCache[],
    aSupprimer: readonly string[],
  ): Promise<void> {
    const tx = this.db.transaction(['fichiers', 'synchro'], 'readwrite')
    const fichiers = tx.objectStore('fichiers')
    await Promise.all([
      ...aEcrire.map((f) => fichiers.put(f)),
      ...aSupprimer.map((c) => fichiers.delete(c)),
      tx.objectStore('synchro').put(base, 'base'),
      tx.done,
    ])
  }

  async lireBrouillon(): Promise<BrouillonPlan | null> {
    return (await this.db.get('brouillon', 'plan')) ?? null
  }

  async enregistrerBrouillon(brouillon: BrouillonPlan): Promise<void> {
    await this.db.put('brouillon', brouillon, 'plan')
  }

  async effacerBrouillon(): Promise<void> {
    await this.db.delete('brouillon', 'plan')
  }

  async lireBrouillonsTexte(): Promise<Map<string, BrouillonTexte>> {
    const tous = await this.db.getAll('textes')
    return new Map(tous.map((t) => [t.id, t]))
  }

  async enregistrerBrouillonTexte(brouillon: BrouillonTexte): Promise<void> {
    await this.db.put('textes', brouillon)
  }

  async effacerBrouillonTexte(id: string): Promise<void> {
    await this.db.delete('textes', id)
  }

  /** Vide le manuscrit en cache (changement de dépôt). */
  async viderManuscrit(): Promise<void> {
    const tx = this.db.transaction(['fichiers', 'synchro', 'brouillon', 'textes'], 'readwrite')
    await Promise.all([
      tx.objectStore('fichiers').clear(),
      tx.objectStore('synchro').clear(),
      tx.objectStore('brouillon').clear(),
      tx.objectStore('textes').clear(),
      tx.done,
    ])
  }

  /** Déconnexion : efface le jeton et tout le cache de l'appareil. */
  async toutEffacer(): Promise<void> {
    const tx = this.db.transaction(['appareil', 'fichiers', 'synchro', 'brouillon', 'textes'], 'readwrite')
    await Promise.all([
      tx.objectStore('appareil').clear(),
      tx.objectStore('fichiers').clear(),
      tx.objectStore('synchro').clear(),
      tx.objectStore('brouillon').clear(),
      tx.objectStore('textes').clear(),
      tx.done,
    ])
  }
}

/**
 * Demande au navigateur de ne pas effacer le stockage de lui-même. Safari
 * efface sinon IndexedDB après sept jours sans visite (hors PWA installée).
 */
export async function demanderStockagePersistant(): Promise<boolean> {
  try {
    // Absent de certains navigateurs malgré ce qu'annoncent les types.
    const storage = navigator.storage as StorageManager | undefined
    if (typeof storage?.persist !== 'function') return false
    return await storage.persist()
  } catch {
    return false
  }
}
