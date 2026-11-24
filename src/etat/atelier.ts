/**
 * État global de l'application et enchaînement connexion → cache → synchro.
 * Indépendant de React : l'interface s'y abonne par useSyncExternalStore.
 */

import { ErreurPlan, lirePlan, type Plan } from '../domaine/plan'
import {
  creerClient,
  ErreurGitHub,
  lireNomDepot,
  memeDepot,
  type ClientGitHub,
  type Depot,
} from '../github/client'
import { lireInfosDepot, lireTete } from '../github/lecture'
import { CHEMIN_PLAN, synchroniser } from '../github/synchro'
import { Cache, demanderStockagePersistant, NOM_BASE, type Connexion } from '../stockage/cache'

export type EtatSynchro =
  | { etat: 'en-cours' }
  | { etat: 'a-jour'; le: string }
  | { etat: 'hors-ligne'; le: string | null }
  | { etat: 'erreur'; message: string; le: string | null }

export interface Manuscrit {
  plan: Plan | null
  /** Pourquoi le plan n'a pas pu être lu, le cas échéant. */
  erreurPlan: string | null
  /** Chemin → contenu, pour chaque fichier .md en cache. */
  textes: ReadonlyMap<string, string>
}

export interface ConnexionActive extends Connexion {
  jeton: string
}

export type EtatAtelier =
  | { phase: 'demarrage' }
  | { phase: 'panne'; message: string }
  | { phase: 'connexion'; depot: Depot | null; message: string | null }
  | {
      phase: 'atelier'
      connexion: ConnexionActive
      /** null tant que rien n'a jamais été synchronisé sur cet appareil. */
      manuscrit: Manuscrit | null
      synchro: EtatSynchro
    }

export interface OptionsAtelier {
  fetch?: typeof fetch
  nomBase?: string
}

export class Atelier {
  private etat: EtatAtelier = { phase: 'demarrage' }
  private readonly ecouteurs = new Set<() => void>()
  private cache: Cache | null = null
  private client: ClientGitHub | null = null
  private synchroEnCours: Promise<void> | null = null
  private synchroSuivante: Promise<void> | null = null

  constructor(private readonly options: OptionsAtelier = {}) {}

  // --- Abonnement (useSyncExternalStore) --------------------------------

  readonly lire = (): EtatAtelier => this.etat

  readonly abonner = (ecouteur: () => void): (() => void) => {
    this.ecouteurs.add(ecouteur)
    return () => this.ecouteurs.delete(ecouteur)
  }

  private changer(etat: EtatAtelier): void {
    this.etat = etat
    for (const e of this.ecouteurs) e()
  }

  // --- Cycle de vie -------------------------------------------------------

  async demarrer(): Promise<void> {
    try {
      this.cache = await Cache.ouvrir(this.options.nomBase ?? NOM_BASE)
    } catch {
      this.changer({
        phase: 'panne',
        message:
          'Le stockage local du navigateur est indisponible. La navigation privée le bloque parfois : ouvrez l’Atelier dans une fenêtre normale.',
      })
      return
    }
    const connexion = await this.cache.lireConnexion()
    if (connexion?.jeton == null) {
      this.changer({ phase: 'connexion', depot: connexion?.depot ?? null, message: null })
      return
    }
    await this.ouvrirAtelier({ ...connexion, jeton: connexion.jeton })
  }

  /** Synchronise au retour au premier plan et au retour du réseau. */
  ecouterNavigateur(): () => void {
    const auPremierPlan = () => {
      if (document.visibilityState === 'visible') void this.synchroniser()
    }
    const enLigne = () => void this.synchroniser()
    document.addEventListener('visibilitychange', auPremierPlan)
    window.addEventListener('online', enLigne)
    return () => {
      document.removeEventListener('visibilitychange', auPremierPlan)
      window.removeEventListener('online', enLigne)
    }
  }

  // --- Connexion ------------------------------------------------------------

  /** Renvoie un message d'erreur à afficher, ou null si la connexion a réussi. */
  async seConnecter(jetonSaisi: string, saisieDepot: string): Promise<string | null> {
    const cache = this.cache
    if (!cache) return 'L’Atelier n’a pas fini de démarrer.'
    const jeton = jetonSaisi.trim()
    if (jeton === '') return 'Collez votre jeton d’accès.'
    const depot = lireNomDepot(saisieDepot)
    if (!depot) return 'Nom de dépôt invalide : écrivez-le sous la forme utilisateur/katastrophe.'

    const client = creerClient(jeton, this.options.fetch)
    let branche: string
    try {
      branche = (await lireInfosDepot(client, depot)).brancheParDefaut
      // Vérifie dès maintenant l'accès au contenu, pour que l'erreur
      // s'affiche ici plutôt qu'après la connexion.
      await lireTete(client, depot, branche)
    } catch (e) {
      if (e instanceof ErreurGitHub && e.nature === 'jeton') {
        return 'GitHub refuse ce jeton : vérifiez qu’il est copié en entier et qu’il n’a pas expiré.'
      }
      return messageErreur(e)
    }

    const precedente = await cache.lireConnexion()
    if (precedente && !memeDepot(precedente.depot, depot)) await cache.viderManuscrit()
    const connexion: ConnexionActive = { jeton, depot, branche }
    await cache.enregistrerConnexion(connexion)
    void demanderStockagePersistant()
    await this.ouvrirAtelier(connexion)
    return null
  }

  async seDeconnecter(): Promise<void> {
    if (!this.cache) return
    await this.cache.toutEffacer()
    this.client = null
    this.changer({ phase: 'connexion', depot: null, message: null })
  }

  private async ouvrirAtelier(connexion: ConnexionActive): Promise<void> {
    this.client = creerClient(connexion.jeton, this.options.fetch)
    const manuscrit = await this.chargerManuscrit()
    this.changer({ phase: 'atelier', connexion, manuscrit, synchro: { etat: 'en-cours' } })
    void this.synchroniser()
  }

  // --- Synchronisation ------------------------------------------------------

  /**
   * Lance une synchronisation. Si une autre est en cours, en programme une
   * seule de plus à sa suite : la promesse renvoyée se résout quand une
   * synchronisation commencée après l'appel est terminée.
   */
  synchroniser(): Promise<void> {
    const enCours = this.synchroEnCours
    if (!enCours) {
      const nouvelle = this.executerSynchro().finally(() => {
        this.synchroEnCours = null
      })
      this.synchroEnCours = nouvelle
      return nouvelle
    }
    this.synchroSuivante ??= enCours
      .catch(() => undefined)
      .then(() => {
        this.synchroSuivante = null
        return this.synchroniser()
      })
    return this.synchroSuivante
  }

  private async executerSynchro(): Promise<void> {
    const depart = this.etat
    const cache = this.cache
    const client = this.client
    if (depart.phase !== 'atelier' || !cache || !client) return
    const { connexion } = depart
    this.changer({ ...depart, synchro: { etat: 'en-cours' } })

    // Après chaque attente, vérifier que l'utilisateur ne s'est pas
    // déconnecté ou reconnecté entre-temps.
    const toujoursActif = () => this.etat.phase === 'atelier' && this.etat.connexion === connexion

    try {
      await synchroniser(client, connexion.depot, connexion.branche, cache)
      const manuscrit = await this.chargerManuscrit()
      const base = await cache.lireBase()
      if (!toujoursActif()) return
      this.changer({
        phase: 'atelier',
        connexion,
        manuscrit,
        synchro: { etat: 'a-jour', le: base?.le ?? new Date().toISOString() },
      })
    } catch (e) {
      if (!toujoursActif()) return
      const le = (await cache.lireBase())?.le ?? null
      const actuel = this.etat
      if (actuel.phase !== 'atelier') return
      if (e instanceof ErreurGitHub && e.nature === 'jeton') {
        // Le dépôt et le cache sont gardés : seul le jeton est à ressaisir.
        await cache.enregistrerConnexion({ ...connexion, jeton: null })
        this.client = null
        this.changer({
          phase: 'connexion',
          depot: connexion.depot,
          message:
            'GitHub n’accepte plus votre jeton (expiré ou révoqué). Saisissez-en un nouveau : rien n’est perdu sur cet appareil.',
        })
      } else if (e instanceof ErreurGitHub && e.nature === 'reseau') {
        this.changer({ ...actuel, synchro: { etat: 'hors-ligne', le } })
      } else {
        this.changer({ ...actuel, synchro: { etat: 'erreur', message: messageErreur(e), le } })
      }
    }
  }

  private async chargerManuscrit(): Promise<Manuscrit | null> {
    const cache = this.cache
    if (!cache) return null
    const [fichiers, base] = await Promise.all([cache.lireFichiers(), cache.lireBase()])
    if (!base) return null

    const textes = new Map<string, string>()
    for (const f of fichiers.values()) {
      if (f.chemin.endsWith('.md')) textes.set(f.chemin, f.contenu)
    }
    const fichierPlan = fichiers.get(CHEMIN_PLAN)
    if (!fichierPlan) {
      return {
        plan: null,
        erreurPlan:
          'Le dépôt ne contient pas de plan.json. Copiez-y le manuscrit d’exemple (voir la documentation).',
        textes,
      }
    }
    try {
      return { plan: lirePlan(fichierPlan.contenu), erreurPlan: null, textes }
    } catch (e) {
      return { plan: null, erreurPlan: messageErreur(e), textes }
    }
  }
}

function messageErreur(e: unknown): string {
  if (e instanceof ErreurGitHub || e instanceof ErreurPlan) return e.message
  return 'Erreur inattendue. Rechargez la page ; si elle persiste, notez ce message : ' + String(e)
}
