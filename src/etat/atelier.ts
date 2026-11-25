/**
 * État global de l'application et enchaînement connexion → cache → synchro.
 * Indépendant de React : l'interface s'y abonne par useSyncExternalStore.
 *
 * Toute modification est d'abord écrite sur l'appareil (IndexedDB), puis
 * envoyée à GitHub en un seul commit : environ 5 s après la dernière
 * opération du plan, 30 s après la dernière frappe, ou tout de suite sur
 * demande (Cmd+S, changement de section, onglet en arrière-plan).
 */

import { ErreurPlan, lirePlan, serialiserPlan, toutesLesSections, type Plan } from '../domaine/plan'
import {
  creerClient,
  ErreurGitHub,
  lireNomDepot,
  memeDepot,
  type ClientGitHub,
  type Depot,
} from '../github/client'
import { ecrireFichiers, envoyer, messageCommit, type TexteAEnvoyer } from '../github/ecriture'
import { shaBlobGit } from '../github/empreinte'
import { lireInfosDepot, lireTete } from '../github/lecture'
import { CHEMIN_PLAN, synchroniser } from '../github/synchro'
import {
  Cache,
  demanderStockagePersistant,
  NOM_BASE,
  type BrouillonPlan,
  type BrouillonTexte,
  type Connexion,
  type FichierCache,
} from '../stockage/cache'

/** Délai entre la dernière opération du plan et l'envoi groupé. */
export const DELAI_ENVOI_PLAN_MS = 5_000
/** Délai entre la dernière frappe et l'envoi du texte. */
export const DELAI_ENVOI_TEXTE_MS = 30_000
/** Délai maximal entre une frappe et son écriture sur l'appareil. */
const DELAI_ECRITURE_LOCALE_MS = 300
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
  /** Texte de chaque section de texte, par identifiant (modifications locales comprises). */
  textes: ReadonlyMap<string, string>
  /** Texte de chaque section tel qu'il est sur GitHub (dernière synchronisation). */
  textesDistants: ReadonlyMap<string, string>
  /** Sections dont le texte a des modifications pas encore envoyées. */
  textesModifies: ReadonlySet<string>
  /** Sections en conflit : chemin de la sauvegarde de la version locale. */
  conflitsTexte: ReadonlyMap<string, string>
  /** Noms des compilations déjà enregistrées dans le dépôt. */
  compilations: readonly string[]
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
  /** Nombre de modifications pas encore envoyées (opérations du plan et textes). */
  enAttente: number
  /** Plan trouvé sur GitHub quand il a changé ailleurs et n'a pas pu être fusionné. */
  conflit: Plan | null
  /** Le plan vient d'être fusionné avec celui d'un autre appareil : ce qui a été remplacé. */
  fusion: { remplacements: string[] } | null
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
  delaiEnvoiTexteMs?: number
}

interface DonneesCache {
  plan: Plan | null
  shaPlan: string | null
  erreurPlan: string | null
  /** Fichiers .md en cache, par chemin. */
  fichiers: ReadonlyMap<string, FichierCache>
  compilations: readonly string[]
}

interface EntreeHistorique {
  avant: Plan
  apres: Plan
  description: string
}

type Minuterie = 'plan' | 'texte' | 'essai' | 'ecriture'

export class Atelier {
  private etat: EtatAtelier = { phase: 'demarrage' }
  private readonly ecouteurs = new Set<() => void>()
  private cache: Cache | null = null
  private client: ClientGitHub | null = null

  private donnees: DonneesCache | null = null
  private brouillon: BrouillonPlan | null = null
  private readonly brouillonsTexte = new Map<string, BrouillonTexte>()
  /** Textes modifiés en mémoire, pas encore écrits dans IndexedDB. */
  private readonly ecrituresEnAttente = new Set<string>()
  private conflit: Plan | null = null
  private fusion: { remplacements: string[] } | null = null
  private forcerProchainEnvoi = false
  private annulations: EntreeHistorique[] = []
  private retablissements: EntreeHistorique[] = []

  private readonly minuteries = new Map<Minuterie, ReturnType<typeof setTimeout>>()
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
      enAttente: (this.brouillon?.descriptions.length ?? 0) + this.brouillonsTexte.size,
      conflit: this.conflit,
      fusion: this.fusion,
      annulable: this.annulations.at(-1)?.description ?? null,
      retablissable: this.retablissements.at(-1)?.description ?? null,
    })
  }

  private aDesModifications(): boolean {
    return this.brouillon !== null || this.brouillonsTexte.size > 0
  }

  /** Fichier de GitHub (en cache) qui porte le texte d'une section. */
  private base(id: string, cheminLocal?: string): FichierCache | undefined {
    const donnees = this.donnees
    if (!donnees) return undefined
    const distante = donnees.plan && toutesLesSections(donnees.plan).find((s) => s.id === id)
    const chemin = distante?.type === 'texte' ? distante.fichier : cheminLocal
    return chemin === undefined ? undefined : donnees.fichiers.get(chemin)
  }

  private manuscrit(): Manuscrit | null {
    if (!this.donnees) return null
    const plan = this.brouillon?.plan ?? this.donnees.plan
    const textes = new Map<string, string>()
    const textesDistants = new Map<string, string>()
    const conflitsTexte = new Map<string, string>()
    if (plan) {
      for (const s of toutesLesSections(plan)) {
        if (s.type !== 'texte') continue
        const distant = this.base(s.id, s.fichier)?.contenu ?? ''
        textesDistants.set(s.id, distant)
        textes.set(s.id, this.brouillonsTexte.get(s.id)?.contenu ?? distant)
      }
    }
    for (const b of this.brouillonsTexte.values()) if (b.conflit) conflitsTexte.set(b.id, b.conflit.chemin)
    return {
      plan,
      erreurPlan: this.brouillon ? null : this.donnees.erreurPlan,
      textes,
      textesDistants,
      textesModifies: new Set(this.brouillonsTexte.keys()),
      conflitsTexte,
      compilations: this.donnees.compilations,
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
   * Synchronise au retour au premier plan et au retour du réseau ; écrit et
   * envoie ce qui est en attente quand l'onglet passe en arrière-plan.
   */
  ecouterNavigateur(): () => void {
    const visibilite = () => {
      if (document.visibilityState === 'visible') void this.synchroniser()
      else void this.envoyerMaintenant()
    }
    const enLigne = () => void this.synchroniser()
    const fermeture = () => void this.ecrireTextes()
    document.addEventListener('visibilitychange', visibilite)
    window.addEventListener('online', enLigne)
    window.addEventListener('pagehide', fermeture)
    return () => {
      document.removeEventListener('visibilitychange', visibilite)
      window.removeEventListener('online', enLigne)
      window.removeEventListener('pagehide', fermeture)
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
    this.arreterMinuteries()
    await this.cache.toutEffacer()
    this.client = null
    this.donnees = null
    this.brouillon = null
    this.brouillonsTexte.clear()
    this.ecrituresEnAttente.clear()
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
    this.brouillonsTexte.clear()
    for (const [id, b] of await cache.lireBrouillonsTexte()) this.brouillonsTexte.set(id, b)
    this.donnees = await this.lireDonnees()
    this.changer({
      phase: 'atelier',
      connexion,
      manuscrit: null,
      synchro: { etat: 'en-cours' },
      enAttente: 0,
      conflit: null,
      fusion: null,
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
      this.arreter('plan')
      const etaitLocal = this.etat.phase === 'atelier' && this.etat.synchro.etat === 'local'
      this.publier(etaitLocal && !this.aDesModifications() ? { etat: 'a-jour', le: new Date().toISOString() } : undefined)
      await cache.effacerBrouillon()
      return
    }
    const precedent = this.brouillon
    this.brouillon = {
      plan,
      shaPlanBase: precedent ? precedent.shaPlanBase : (this.donnees?.shaPlan ?? null),
      ...(precedent ? (precedent.planBase ? { planBase: precedent.planBase } : {}) : this.donnees?.plan ? { planBase: this.donnees.plan } : {}),
      descriptions: [...(precedent?.descriptions ?? []), description],
      aSupprimer: suppressions,
      revision: (precedent?.revision ?? 0) + 1,
      modifieLe: new Date().toISOString(),
    }
    this.publier(this.envoiEnCours() ? undefined : { etat: 'local' })
    try {
      await cache.enregistrerBrouillon(this.brouillon)
    } catch {
      this.signalerEchecLocal()
    }
    this.programmer('plan', this.options.delaiEnvoiMs ?? DELAI_ENVOI_PLAN_MS)
  }

  /** Ferme la notification de fusion du plan. */
  oublierFusion(): void {
    this.fusion = null
    this.publier()
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

  // --- Textes ---------------------------------------------------------------

  /**
   * Enregistre le texte d'une section. Appelée à chaque frappe : le texte
   * est écrit sur l'appareil en moins d'une seconde et envoyé 30 s après la
   * dernière frappe.
   */
  modifierTexte(id: string, contenu: string): void {
    const plan = this.manuscrit()?.plan
    const section = plan && toutesLesSections(plan).find((s) => s.id === id)
    if (section?.type !== 'texte') return
    const precedent = this.brouillonsTexte.get(id)
    if (precedent?.contenu === contenu) return
    const base = this.base(id, section.fichier)
    if (!precedent && contenu === (base?.contenu ?? '')) return

    if (precedent && !precedent.conflit && contenu === (base?.contenu ?? '')) {
      // Retour exact au texte de GitHub : plus rien à envoyer pour lui.
      this.brouillonsTexte.delete(id)
    } else {
      this.brouillonsTexte.set(id, {
        id,
        contenu,
        shaBase: precedent ? precedent.shaBase : (base?.sha ?? null),
        revision: (precedent?.revision ?? 0) + 1,
        modifieLe: new Date().toISOString(),
        ...(precedent?.conflit ? { conflit: precedent.conflit } : {}),
      })
    }
    this.ecrituresEnAttente.add(id)
    // Première modification depuis la dernière synchronisation : écrite tout
    // de suite, pour que l'indicateur ne dise jamais « Synchronisé » à tort.
    // Les frappes suivantes sont regroupées.
    const indicateurAJour = this.etat.phase === 'atelier' && this.etat.synchro.etat === 'a-jour'
    if (indicateurAJour) {
      this.programmer('ecriture', 0, () => void this.ecrireTextes())
    } else if (!this.minuteries.has('ecriture')) {
      this.programmer('ecriture', DELAI_ECRITURE_LOCALE_MS, () => void this.ecrireTextes())
    }
    this.programmer('texte', this.options.delaiEnvoiTexteMs ?? DELAI_ENVOI_TEXTE_MS)
  }

  /** Écrit dans IndexedDB les textes modifiés en mémoire. */
  private async ecrireTextes(): Promise<void> {
    this.arreter('ecriture')
    const cache = this.cache
    if (!cache || this.ecrituresEnAttente.size === 0) return
    const ids = [...this.ecrituresEnAttente]
    this.ecrituresEnAttente.clear()
    try {
      await Promise.all(
        ids.map((id) => {
          const b = this.brouillonsTexte.get(id)
          return b ? cache.enregistrerBrouillonTexte(b) : cache.effacerBrouillonTexte(id)
        }),
      )
    } catch {
      for (const id of ids) this.ecrituresEnAttente.add(id)
      this.signalerEchecLocal()
      return
    }
    if (this.envoiEnCours()) this.publier()
    else if (this.aDesModifications()) this.publier({ etat: 'local' })
    else this.publier({ etat: 'a-jour', le: new Date().toISOString() })
  }

  /** Choix de l'utilisateur après un conflit sur un texte. */
  async resoudreConflitTexte(id: string, choix: 'local' | 'distant'): Promise<void> {
    const b = this.brouillonsTexte.get(id)
    if (!b?.conflit) return
    if (choix === 'local') {
      // Le texte de l'appareil remplacera celui de GitHub (qui reste dans
      // l'historique) ; la sauvegarde dans conflits/ sera retirée.
      this.brouillonsTexte.set(id, { ...b, shaBase: b.conflit.shaDistant, revision: b.revision + 1 })
    } else {
      // On reprend le texte de GitHub. La sauvegarde reste dans conflits/.
      this.brouillonsTexte.delete(id)
    }
    this.ecrituresEnAttente.add(id)
    await this.ecrireTextes()
    await this.synchroniser()
  }

  /**
   * Enregistre des fichiers dans le dépôt (compilation et script) en un
   * commit, après avoir envoyé ce qui était en attente. Renvoie null si tout
   * s'est bien passé, sinon un message d'erreur.
   */
  async enregistrerFichiers(fichiers: readonly { chemin: string; contenu: string }[], message: string): Promise<string | null> {
    const etat = this.etat
    if (etat.phase !== 'atelier' || !this.client) return 'L’Atelier n’est pas connecté.'
    await this.envoyerMaintenant()
    if (this.conflit) return 'Réglez d’abord le conflit sur le plan.'
    try {
      await ecrireFichiers(this.client, etat.connexion.depot, etat.connexion.branche, fichiers, message)
    } catch (e) {
      return messageErreur(e)
    }
    await this.synchroniser()
    return null
  }

  /** Écrit et envoie tout de suite ce qui est en attente (Cmd+S, changement de section…). */
  async envoyerMaintenant(): Promise<void> {
    await this.ecrireTextes()
    if (!this.aDesModifications()) return
    this.arreter('plan')
    this.arreter('texte')
    await this.synchroniser()
  }

  private envoiEnCours(): boolean {
    return this.etat.phase === 'atelier' && ['envoi', 'en-cours'].includes(this.etat.synchro.etat)
  }

  private signalerEchecLocal(): void {
    this.publier({
      etat: 'erreur',
      message: 'Impossible d’enregistrer sur cet appareil : la modification n’est pas encore protégée.',
      le: null,
    })
  }

  private programmer(type: Minuterie, delai: number, action: () => void = () => void this.synchroniser()): void {
    this.arreter(type)
    this.minuteries.set(
      type,
      setTimeout(() => {
        this.minuteries.delete(type)
        action()
      }, delai),
    )
  }

  private arreter(type: Minuterie): void {
    const m = this.minuteries.get(type)
    if (m !== undefined) clearTimeout(m)
    this.minuteries.delete(type)
  }

  private arreterMinuteries(): void {
    for (const m of this.minuteries.values()) clearTimeout(m)
    this.minuteries.clear()
  }

  // --- Synchronisation ------------------------------------------------------

  /**
   * Envoie ce qui est en attente, puis met le cache à jour. Si un cycle est
   * en cours, en programme un seul de plus à sa suite : la promesse renvoyée
   * se résout quand un cycle commencé après l'appel est terminé.
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
      // Tant qu'un conflit sur le plan n'est pas réglé, rien ne part :
      // les chemins des textes dépendent du plan.
      if (this.aDesModifications() && !this.conflit) {
        await this.ecrireTextes()
        this.arreter('plan')
        this.arreter('texte')
        this.arreter('essai')
        this.publier({ etat: 'envoi' })
        contenusConnus = await this.envoyerModifications(client, connexion, cache)
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
        this.aDesModifications() ? { etat: 'local' } : { etat: 'a-jour', le: base?.le ?? new Date().toISOString() },
      )
    } catch (e) {
      if (!toujoursActif()) return
      const le = (await cache.lireBase())?.le ?? null
      if (this.etat.phase !== 'atelier') return
      if (e instanceof ErreurGitHub && e.nature === 'jeton') {
        // Le dépôt, le cache et les brouillons sont gardés : seul le jeton est à ressaisir.
        this.arreterMinuteries()
        await this.ecrireTextes()
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
      if (this.aDesModifications()) this.programmer('essai', DELAI_NOUVEL_ESSAI_MS)
      if (e instanceof ErreurGitHub && e.nature === 'reseau') {
        this.publier({ etat: 'hors-ligne', le })
      } else {
        this.publier({ etat: 'erreur', message: messageErreur(e), le })
      }
    }
  }

  /** Envoie le plan et les textes en un commit. Renvoie les contenus envoyés. */
  private async envoyerModifications(client: ClientGitHub, connexion: ConnexionActive, cache: Cache): Promise<string[]> {
    const planEnvoye = this.brouillon
    const textesEnvoyes = [...this.brouillonsTexte.values()]
    const planLocal = this.manuscrit()?.plan
    const titre = (id: string) => (planLocal && toutesLesSections(planLocal).find((s) => s.id === id)?.titre) ?? id

    const textes: TexteAEnvoyer[] = textesEnvoyes.map((b) => ({
      id: b.id,
      contenu: b.contenu,
      shaBase: b.shaBase,
      conflit: b.conflit,
    }))
    const resultat = await envoyer(client, connexion.depot, connexion.branche, {
      plan: planEnvoye?.plan ?? null,
      shaPlanBase: planEnvoye?.shaPlanBase ?? null,
      forcer: this.forcerProchainEnvoi,
      fusion: planEnvoye?.planBase ? { base: planEnvoye.planBase, modifieLe: planEnvoye.modifieLe } : undefined,
      aSupprimer: planEnvoye?.aSupprimer ?? [],
      textes,
      message: (conflits) =>
        messageCommit(
          planEnvoye?.descriptions ?? [],
          textesEnvoyes.filter((b) => !conflits.includes(b.id)).map((b) => titre(b.id)),
          conflits.map(titre),
        ),
    })
    this.forcerProchainEnvoi = false
    if (resultat.type === 'conflit') {
      this.conflit = resultat.planDistant
      return []
    }

    if (resultat.fusion) {
      // Le plan affiché change sous les pas de l'historique d'annulation.
      this.fusion = resultat.fusion
      this.annulations = []
      this.retablissements = []
    }

    // Le plan envoyé devient la nouvelle référence, avant même la
    // synchronisation : une opération faite entre-temps partira de lui.
    const shaPlan = await shaBlobGit(resultat.contenuPlan)
    if (this.donnees) this.donnees = { ...this.donnees, plan: resultat.plan, shaPlan, erreurPlan: null }

    if (planEnvoye) {
      const actuel = this.brouillon
      if (actuel?.revision === planEnvoye.revision) {
        this.brouillon = null
        await cache.effacerBrouillon()
      } else if (actuel) {
        // Des opérations ont eu lieu pendant l'envoi : elles partiront au prochain.
        this.brouillon = {
          ...actuel,
          shaPlanBase: shaPlan,
          planBase: resultat.plan,
          descriptions: actuel.descriptions.slice(planEnvoye.descriptions.length),
          aSupprimer: (actuel.aSupprimer ?? []).slice((planEnvoye.aSupprimer ?? []).length),
        }
        await cache.enregistrerBrouillon(this.brouillon)
        this.programmer('plan', this.options.delaiEnvoiMs ?? DELAI_ENVOI_PLAN_MS)
      }
    }

    for (const envoye of textesEnvoyes) {
      const r = resultat.textes.get(envoye.id)
      const actuel = this.brouillonsTexte.get(envoye.id)
      if (!r || !actuel) continue
      if (r.type === 'conflit') {
        const marque: BrouillonTexte = { ...actuel, conflit: { chemin: r.chemin, shaDistant: r.shaDistant } }
        this.brouillonsTexte.set(envoye.id, marque)
        await cache.enregistrerBrouillonTexte(marque)
      } else if (actuel.revision === envoye.revision) {
        this.brouillonsTexte.delete(envoye.id)
        await cache.effacerBrouillonTexte(envoye.id)
      } else {
        // Frappes pendant l'envoi : elles partiront au prochain, depuis ce qui vient d'être écrit.
        const suite: BrouillonTexte = { ...actuel, shaBase: await shaBlobGit(envoye.contenu) }
        delete suite.conflit
        this.brouillonsTexte.set(envoye.id, suite)
        await cache.enregistrerBrouillonTexte(suite)
        this.programmer('texte', this.options.delaiEnvoiTexteMs ?? DELAI_ENVOI_TEXTE_MS)
      }
    }
    return resultat.contenus
  }

  /** Lit le manuscrit en cache ; null si rien n'a jamais été synchronisé. */
  private async lireDonnees(): Promise<DonneesCache | null> {
    const cache = this.cache
    if (!cache) return null
    const [tous, base] = await Promise.all([cache.lireFichiers(), cache.lireBase()])
    if (!base) return null
    const fichiers = new Map([...tous].filter(([chemin]) => chemin.endsWith('.md')))
    const vide: DonneesCache = { plan: null, shaPlan: null, erreurPlan: null, fichiers, compilations: base.compilations ?? [] }
    const fichierPlan = tous.get(CHEMIN_PLAN)
    if (!fichierPlan) {
      return {
        ...vide,
        erreurPlan:
          'Le dépôt ne contient pas de plan.json. Copiez-y le manuscrit d’exemple (voir la documentation).',
      }
    }
    try {
      return { ...vide, plan: lirePlan(fichierPlan.contenu), shaPlan: fichierPlan.sha }
    } catch (e) {
      return { ...vide, shaPlan: fichierPlan.sha, erreurPlan: messageErreur(e) }
    }
  }
}

function messageErreur(e: unknown): string {
  if (e instanceof ErreurGitHub || e instanceof ErreurPlan) return e.message
  return 'Erreur inattendue. Rechargez la page ; si elle persiste, notez ce message : ' + String(e)
}
