/**
 * État global de l'application et enchaînement connexion → cache → synchro.
 * Indépendant de React : l'interface s'y abonne par useSyncExternalStore.
 *
 * Toute modification du plan est d'abord écrite sur l'appareil (brouillon
 * dans IndexedDB), puis envoyée à GitHub environ 5 secondes après la
 * dernière opération, en un seul commit.
 */

import { ErreurPlan, lirePlan, serialiserPlan, type Plan } from '../domaine/plan'
import {
  creerClient,
  ErreurGitHub,
  lireNomDepot,
  memeDepot,
  type ClientGitHub,
  type Depot,
} from '../github/client'
import { envoyerPlan, messageCommit } from '../github/ecriture'
import { shaBlobGit } from '../github/empreinte'
import { lireInfosDepot, lireTete } from '../github/lecture'
import { CHEMIN_PLAN, synchroniser } from '../github/synchro'
import {
  Cache,
  demanderStockagePersistant,
  NOM_BASE,
  type BrouillonPlan,
  type Connexion,
} from '../stockage/cache'

/** Délai entre la dernière opération du plan et l'envoi groupé. */
export const DELAI_ENVOI_PLAN_MS = 5_000
/** Nouvel essai d'envoi après une coupure ou une erreur. */
const DELAI_NOUVEL_ESSAI_MS = 30_000
const NIVEAUX_ANNULATION = 50

export type EtatSynchro =
  | { etat: 'en-cours' }
  | { etat: 'envoi' }
  | { etat: 'a-jour'; le: string }
  /** Modifications enregistrées sur l'appareil, envoi programmé. */
  | { etat: 'local' }
  | { etat: 'hors-ligne'; le: string | null }
  | { etat: 'erreur'; message: string; le: string | null }

export interface Manuscrit {
  /** Le plan affiché : brouillon local s'il existe, sinon celui de GitHub. */
  plan: Plan | null
  /** Pourquoi le plan n'a pas pu être lu, le cas échéant. */
  erreurPlan: string | null
  /** Chemin → contenu, pour chaque fichier .md en cache. */
  textes: ReadonlyMap<string, string>
}

export interface ConnexionActive extends Connexion {
  jeton: string
}

export interface EtatOuvert {
  phase: 'atelier'
  connexion: ConnexionActive
  /** null tant que rien n'a jamais été synchronisé sur cet appareil. */
  manuscrit: Manuscrit | null
  synchro: EtatSynchro
  /** Nombre d'opérations pas encore envoyées. */
  enAttente: number
  /** Plan trouvé sur GitHub quand il a changé ailleurs pendant nos modifications. */
  conflit: Plan | null
  /** Description de l'opération que Cmd+Z annulerait. */
  annulable: string | null
  retablissable: string | null
}

export type EtatAtelier =
  | { phase: 'demarrage' }
  | { phase: 'panne'; message: string }
  | { phase: 'connexion'; depot: Depot | null; message: string | null }
  | EtatOuvert

export interface OptionsAtelier {
  fetch?: typeof fetch
  nomBase?: string
  delaiEnvoiMs?: number
}

interface DonneesCache {
  plan: Plan | null
  shaPlan: string | null
  erreurPlan: string | null
  textes: ReadonlyMap<string, string>
}

interface EntreeHistorique {
  avant: Plan
  apres: Plan
  description: string
}

export class Atelier {
  private etat: EtatAtelier = { phase: 'demarrage' }
  private readonly ecouteurs = new Set<() => void>()
  private cache: Cache | null = null
  private client: ClientGitHub | null = null

  private donnees: DonneesCache | null = null
  private brouillon: BrouillonPlan | null = null
  private conflit: Plan | null = null
  private forcerProchainEnvoi = false
  private annulations: EntreeHistorique[] = []
  private retablissements: EntreeHistorique[] = []

  private minuterie: ReturnType<typeof setTimeout> | null = null
  private cycleEnCours: Promise<void> | null = null
  private cycleSuivant: Promise<void> | null = null

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

  /** Republie l'état ouvert à partir des données internes. */
  private publier(synchro?: EtatSynchro): void {
    if (this.etat.phase !== 'atelier') return
    this.changer({
      ...this.etat,
      manuscrit: this.manuscrit(),
      synchro: synchro ?? this.etat.synchro,
      enAttente: this.brouillon?.descriptions.length ?? 0,
      conflit: this.conflit,
      annulable: this.annulations.at(-1)?.description ?? null,
      retablissable: this.retablissements.at(-1)?.description ?? null,
    })
  }

  private manuscrit(): Manuscrit | null {
    if (!this.donnees) return null
    return {
      plan: this.brouillon?.plan ?? this.donnees.plan,
      erreurPlan: this.brouillon ? null : this.donnees.erreurPlan,
      textes: this.donnees.textes,
    }
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

  /**
   * Synchronise au retour au premier plan et au retour du réseau ; envoie
   * ce qui est en attente quand l'onglet passe en arrière-plan.
   */
  ecouterNavigateur(): () => void {
    const visibilite = () => {
      if (document.visibilityState === 'visible') void this.synchroniser()
      else void this.envoyerMaintenant()
    }
    const enLigne = () => void this.synchroniser()
    document.addEventListener('visibilitychange', visibilite)
    window.addEventListener('online', enLigne)
    return () => {
      document.removeEventListener('visibilitychange', visibilite)
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
    this.arreterMinuterie()
    await this.cache.toutEffacer()
    this.client = null
    this.donnees = null
    this.brouillon = null
    this.conflit = null
    this.annulations = []
    this.retablissements = []
    this.changer({ phase: 'connexion', depot: null, message: null })
  }

  private async ouvrirAtelier(connexion: ConnexionActive): Promise<void> {
    const cache = this.cache
    if (!cache) return
    this.client = creerClient(connexion.jeton, this.options.fetch)
    this.brouillon = await cache.lireBrouillon()
    this.donnees = await this.lireDonnees()
    this.changer({
      phase: 'atelier',
      connexion,
      manuscrit: null,
      synchro: { etat: 'en-cours' },
      enAttente: 0,
      conflit: null,
      annulable: null,
      retablissable: null,
    })
    this.publier()
    void this.synchroniser()
  }

  // --- Opérations du plan ---------------------------------------------------

  /** Applique une opération au plan affiché. Elle sera annulable. */
  modifierPlan(transformer: (plan: Plan) => Plan, description: string): void {
    const plan = this.manuscrit()?.plan
    if (!plan || this.etat.phase !== 'atelier') return
    const nouveau = transformer(plan)
    if (nouveau === plan) return
    this.annulations.push({ avant: plan, apres: nouveau, description })
    if (this.annulations.length > NIVEAUX_ANNULATION) this.annulations.shift()
    this.retablissements = []
    void this.enregistrer(nouveau, description)
  }

  /**
   * Vide la corbeille : les fichiers de ses sections seront supprimés du
   * dépôt (ils restent dans l'historique Git). Ne s'annule pas.
   */
  viderCorbeille(): void {
    const plan = this.manuscrit()?.plan
    if (!plan || plan.corbeille.length === 0 || this.etat.phase !== 'atelier') return
    const ids = plan.corbeille.map((e) => e.section.id)
    this.annulations = []
    this.retablissements = []
    void this.enregistrer({ ...plan, corbeille: [] }, 'vidage de la corbeille', ids)
  }

  annuler(): void {
    const entree = this.annulations.pop()
    if (!entree) return
    this.retablissements.push(entree)
    void this.enregistrer(entree.avant, `annulation : ${entree.description}`)
  }

  retablir(): void {
    const entree = this.retablissements.pop()
    if (!entree) return
    this.annulations.push(entree)
    void this.enregistrer(entree.apres, entree.description)
  }

  /** Écrit le nouveau plan dans le brouillon de l'appareil et programme l'envoi. */
  private async enregistrer(plan: Plan, description: string, aSupprimer: string[] = []): Promise<void> {
    const cache = this.cache
    if (!cache) return
    const reference = this.donnees?.plan
    const suppressions = [...(this.brouillon?.aSupprimer ?? []), ...aSupprimer]
    if (
      reference &&
      !this.conflit &&
      suppressions.length === 0 &&
      serialiserPlan(plan) === serialiserPlan(reference)
    ) {
      // Retour exact au plan de GitHub (par annulation) : plus rien à envoyer.
      this.brouillon = null
      this.arreterMinuterie()
      this.publier(this.etat.phase === 'atelier' && this.etat.synchro.etat === 'local' ? { etat: 'a-jour', le: new Date().toISOString() } : undefined)
      await cache.effacerBrouillon()
      return
    }
    const precedent = this.brouillon
    this.brouillon = {
      plan,
      shaPlanBase: precedent ? precedent.shaPlanBase : (this.donnees?.shaPlan ?? null),
      descriptions: [...(precedent?.descriptions ?? []), description],
      aSupprimer: suppressions,
      revision: (precedent?.revision ?? 0) + 1,
      modifieLe: new Date().toISOString(),
    }
    const enCours = this.etat.phase === 'atelier' && ['envoi', 'en-cours'].includes(this.etat.synchro.etat)
    this.publier(enCours ? undefined : { etat: 'local' })
    try {
      await cache.enregistrerBrouillon(this.brouillon)
    } catch {
      this.publier({
        etat: 'erreur',
        message: 'Impossible d’enregistrer sur cet appareil : la modification n’est pas encore protégée.',
        le: null,
      })
    }
    this.programmerEnvoi(this.options.delaiEnvoiMs ?? DELAI_ENVOI_PLAN_MS)
  }

  /** Choix de l'utilisateur après un conflit sur le plan. */
  resoudreConflit(choix: 'local' | 'distant'): Promise<void> {
    if (!this.conflit) return Promise.resolve()
    this.conflit = null
    if (choix === 'local') {
      this.forcerProchainEnvoi = true
    } else {
      this.brouillon = null
      this.annulations = []
      this.retablissements = []
      void this.cache?.effacerBrouillon()
    }
    this.publier()
    return this.synchroniser()
  }

  /** Envoie tout de suite ce qui est en attente (onglet en arrière-plan, Cmd+S). */
  envoyerMaintenant(): Promise<void> {
    if (!this.brouillon) return Promise.resolve()
    this.arreterMinuterie()
    return this.synchroniser()
  }

  private programmerEnvoi(delai: number): void {
    this.arreterMinuterie()
    this.minuterie = setTimeout(() => {
      this.minuterie = null
      void this.synchroniser()
    }, delai)
  }

  private arreterMinuterie(): void {
    if (this.minuterie !== null) clearTimeout(this.minuterie)
    this.minuterie = null
  }

  // --- Synchronisation ------------------------------------------------------

  /**
   * Envoie le brouillon s'il y en a un, puis met le cache à jour. Si un cycle
   * est en cours, en programme un seul de plus à sa suite : la promesse
   * renvoyée se résout quand un cycle commencé après l'appel est terminé.
   */
  synchroniser(): Promise<void> {
    const enCours = this.cycleEnCours
    if (!enCours) {
      const nouveau = this.executerCycle().finally(() => {
        this.cycleEnCours = null
      })
      this.cycleEnCours = nouveau
      return nouveau
    }
    this.cycleSuivant ??= enCours
      .catch(() => undefined)
      .then(() => {
        this.cycleSuivant = null
        return this.synchroniser()
      })
    return this.cycleSuivant
  }

  private async executerCycle(): Promise<void> {
    const depart = this.etat
    const cache = this.cache
    const client = this.client
    if (depart.phase !== 'atelier' || !cache || !client) return
    const { connexion } = depart

    // Après chaque attente, vérifier que l'utilisateur ne s'est pas
    // déconnecté ou reconnecté entre-temps.
    const toujoursActif = () => this.etat.phase === 'atelier' && this.etat.connexion === connexion

    try {
      let contenusConnus: string[] = []
      if (this.brouillon && !this.conflit) {
        this.arreterMinuterie()
        this.publier({ etat: 'envoi' })
        contenusConnus = await this.envoyerBrouillon(client, connexion, cache)
        if (!toujoursActif()) return
      }
      this.publier({ etat: 'en-cours' })
      await synchroniser(client, connexion.depot, connexion.branche, cache, contenusConnus)
      const donnees = await this.lireDonnees()
      const base = await cache.lireBase()
      if (!toujoursActif()) return
      if (!this.brouillon && donnees?.shaPlan !== this.donnees?.shaPlan) {
        // Le plan a changé sur un autre appareil : l'historique d'annulation
        // ne correspond plus à ce qui est affiché.
        this.annulations = []
        this.retablissements = []
      }
      this.donnees = donnees
      this.publier(
        this.brouillon ? { etat: 'local' } : { etat: 'a-jour', le: base?.le ?? new Date().toISOString() },
      )
    } catch (e) {
      if (!toujoursActif()) return
      const le = (await cache.lireBase())?.le ?? null
      if (this.etat.phase !== 'atelier') return
      if (e instanceof ErreurGitHub && e.nature === 'jeton') {
        // Le dépôt, le cache et le brouillon sont gardés : seul le jeton est à ressaisir.
        this.arreterMinuterie()
        await cache.enregistrerConnexion({ ...connexion, jeton: null })
        this.client = null
        this.changer({
          phase: 'connexion',
          depot: connexion.depot,
          message:
            'GitHub n’accepte plus votre jeton (expiré ou révoqué). Saisissez-en un nouveau : rien n’est perdu sur cet appareil.',
        })
        return
      }
      if (this.brouillon) this.programmerEnvoi(DELAI_NOUVEL_ESSAI_MS)
      if (e instanceof ErreurGitHub && e.nature === 'reseau') {
        this.publier({ etat: 'hors-ligne', le })
      } else {
        this.publier({ etat: 'erreur', message: messageErreur(e), le })
      }
    }
  }

  /** Envoie le brouillon. Renvoie les contenus envoyés, connus sans téléchargement. */
  private async envoyerBrouillon(client: ClientGitHub, connexion: ConnexionActive, cache: Cache): Promise<string[]> {
    const envoye = this.brouillon
    if (!envoye) return []
    const resultat = await envoyerPlan(client, connexion.depot, connexion.branche, {
      plan: envoye.plan,
      shaPlanBase: envoye.shaPlanBase,
      message: messageCommit(envoye.descriptions),
      forcer: this.forcerProchainEnvoi,
      aSupprimer: envoye.aSupprimer ?? [],
    })
    this.forcerProchainEnvoi = false
    if (resultat.type === 'conflit') {
      this.conflit = resultat.planDistant
      return []
    }

    // Le plan envoyé devient la nouvelle référence, avant même la
    // synchronisation : une opération faite entre-temps partira de lui.
    const shaEnvoye = await shaBlobGit(resultat.contenuPlan)
    this.donnees = this.donnees && { ...this.donnees, plan: resultat.plan, shaPlan: shaEnvoye, erreurPlan: null }

    const actuel = this.brouillon
    if (actuel?.revision === envoye.revision) {
      this.brouillon = null
      await cache.effacerBrouillon()
    } else if (actuel) {
      // Des opérations ont eu lieu pendant l'envoi : elles partiront au prochain.
      this.brouillon = {
        ...actuel,
        shaPlanBase: shaEnvoye,
        descriptions: actuel.descriptions.slice(envoye.descriptions.length),
        aSupprimer: (actuel.aSupprimer ?? []).slice((envoye.aSupprimer ?? []).length),
      }
      await cache.enregistrerBrouillon(this.brouillon)
      this.programmerEnvoi(this.options.delaiEnvoiMs ?? DELAI_ENVOI_PLAN_MS)
    }
    return [resultat.contenuPlan, '']
  }

  /** Lit le manuscrit en cache ; null si rien n'a jamais été synchronisé. */
  private async lireDonnees(): Promise<DonneesCache | null> {
    const cache = this.cache
    if (!cache) return null
    const [fichiers, base] = await Promise.all([cache.lireFichiers(), cache.lireBase()])
    if (!base) return null
    const vide: DonneesCache = { plan: null, shaPlan: null, erreurPlan: null, textes: new Map() }

    const textes = new Map<string, string>()
    for (const f of fichiers.values()) {
      if (f.chemin.endsWith('.md')) textes.set(f.chemin, f.contenu)
    }
    const fichierPlan = fichiers.get(CHEMIN_PLAN)
    if (!fichierPlan) {
      return {
        ...vide,
        textes,
        erreurPlan:
          'Le dépôt ne contient pas de plan.json. Copiez-y le manuscrit d’exemple (voir la documentation).',
      }
    }
    try {
      return { plan: lirePlan(fichierPlan.contenu), shaPlan: fichierPlan.sha, erreurPlan: null, textes }
    } catch (e) {
      return { ...vide, textes, shaPlan: fichierPlan.sha, erreurPlan: messageErreur(e) }
    }
  }
}

function messageErreur(e: unknown): string {
  if (e instanceof ErreurGitHub || e instanceof ErreurPlan) return e.message
  return 'Erreur inattendue. Rechargez la page ; si elle persiste, notez ce message : ' + String(e)
}
