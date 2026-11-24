/**
 * Cache local dans IndexedDB : la connexion de l'appareil et une copie des
 * fichiers du manuscrit telle qu'au dernier commit synchronisé.
 *
 * Les modifications locales en attente auront leur propre magasin
 * (jalon 3) : ce magasin-ci ne contient que ce qui est sur GitHub.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
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
}

interface Schema extends DBSchema {
  appareil: { key: 'connexion'; value: Connexion }
  synchro: { key: 'base'; value: BaseSynchro }
  fichiers: { key: string; value: FichierCache }
}

export class Cache {
  private constructor(private readonly db: IDBPDatabase<Schema>) {}

  static async ouvrir(nom: string = NOM_BASE): Promise<Cache> {
    const db = await openDB<Schema>(nom, 1, {
      upgrade(base) {
        base.createObjectStore('appareil')
        base.createObjectStore('synchro')
        base.createObjectStore('fichiers', { keyPath: 'chemin' })
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

  /** Vide le manuscrit en cache (changement de dépôt). */
  async viderManuscrit(): Promise<void> {
    const tx = this.db.transaction(['fichiers', 'synchro'], 'readwrite')
    await Promise.all([tx.objectStore('fichiers').clear(), tx.objectStore('synchro').clear(), tx.done])
  }

  /** Déconnexion : efface le jeton et tout le cache de l'appareil. */
  async toutEffacer(): Promise<void> {
    const tx = this.db.transaction(['appareil', 'fichiers', 'synchro'], 'readwrite')
    await Promise.all([
      tx.objectStore('appareil').clear(),
      tx.objectStore('fichiers').clear(),
      tx.objectStore('synchro').clear(),
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
