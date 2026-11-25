/**
 * Cache local dans IndexedDB.
 *
 * La base « atelier » tient le registre de l'appareil : le jeton et les
 * livres connus. Chaque livre a sa propre base, qui garde une copie des
 * fichiers de son manuscrit telle qu'au dernier commit synchronisé, et ses
 * modifications pas encore envoyées. Le premier livre connecté avant
 * l'arrivée des livres multiples garde, lui, la base « atelier » : rien
 * n'a été déplacé.
 *
 * Le magasin « fichiers » ne contient que ce qui est sur GitHub. Les
 * modifications locales pas encore envoyées vivent dans « brouillon ».
 */

import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Plan } from '../domaine/plan'
import { memeDepot, nomComplet, type Depot } from '../github/client'

export const NOM_BASE = 'atelier'

export interface Connexion {
  /** null après un 401 : le dépôt reste connu, le jeton est à ressaisir. */
  jeton: string | null
  depot: Depot
  branche: string
}

/** Un livre connu de cet appareil. */
export interface ProjetConnu {
  depot: Depot
  branche: string
  /** Base IndexedDB qui garde la copie de son manuscrit. */
  base: string
  /** Titre du livre au dernier passage ; null s'il n'a jamais été lu. */
  titre: string | null
}

/** Registre de l'appareil : un jeton pour tous les livres. */
export interface Registre {
  /** null après un 401 : les livres restent connus, le jeton est à ressaisir. */
  jeton: string | null
  projets: ProjetConnu[]
  /** Livre ouvert (« propriétaire/nom »). */
  courant: string
}

/** Base IndexedDB d'un livre, nommée d'après le registre et le dépôt. */
export function baseDuProjet(nomRegistre: string, depot: Depot): string {
  return `${nomRegistre}:${nomComplet(depot).toLowerCase()}`
}

export function projetDe(registre: Registre, depot: Depot): ProjetConnu | undefined {
  return registre.projets.find((p) => memeDepot(p.depot, depot))
}

export function projetCourant(registre: Registre): ProjetConnu | undefined {
  return registre.projets.find((p) => nomComplet(p.depot).toLowerCase() === registre.courant.toLowerCase())
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
  /** Le plan au début des modifications : base commune d'une fusion à trois voies. */
  planBase?: Plan
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
  /** « registre » ; « connexion » est l'ancien format, d'avant les livres multiples. */
  appareil: { key: 'connexion' | 'registre'; value: Connexion | Registre }
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
      // Un autre onglet supprime cette base (livre retiré, déconnexion) : on la libère.
      blocking() {
        db.close()
      },
    })
    return new Cache(db)
  }

  /** Supprime la base d'un livre. Attend que ses connexions soient fermées. */
  static async supprimer(nom: string): Promise<void> {
    await deleteDB(nom)
  }

  get nom(): string {
    return this.db.name
  }

  fermer(): void {
    this.db.close()
  }

  /**
   * Registre de l'appareil. Une connexion de l'ancien format devient un
   * registre d'un seul livre, dont le manuscrit reste dans cette base.
   */
  async lireRegistre(): Promise<Registre | null> {
    const tx = this.db.transaction('appareil', 'readwrite')
    const magasin = tx.objectStore('appareil')
    const registre = (await magasin.get('registre')) as Registre | undefined
    if (registre) {
      await tx.done
      return registre
    }
    const ancienne = (await magasin.get('connexion')) as Connexion | undefined
    if (!ancienne) {
      await tx.done
      return null
    }
    const converti: Registre = {
      jeton: ancienne.jeton,
      projets: [{ depot: ancienne.depot, branche: ancienne.branche, base: this.db.name, titre: null }],
      courant: nomComplet(ancienne.depot),
    }
    await Promise.all([magasin.put(converti, 'registre'), magasin.delete('connexion'), tx.done])
    return converti
  }

  async enregistrerRegistre(registre: Registre): Promise<void> {
    await this.db.put('appareil', registre, 'registre')
  }

  /** Nombre de modifications en attente : opérations du plan et textes. */
  async compterEnAttente(): Promise<number> {
    const [brouillon, textes] = await Promise.all([this.lireBrouillon(), this.db.count('textes')])
    return (brouillon?.descriptions.length ?? 0) + textes
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

  /** Vide le manuscrit en cache (livre retiré de l'appareil). */
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

  /** Déconnexion : efface le registre (jeton compris) et tout le cache de cette base. */
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
