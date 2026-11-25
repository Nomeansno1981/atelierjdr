/**
 * Fusion à trois voies du plan, section par section, à partir de la base
 * commune (le plan tel qu'il était quand les modifications locales ont
 * commencé). Ce qui n'a changé que d'un côté est repris ; si le même champ a
 * changé des deux côtés, la modification la plus récente l'emporte et la
 * fusion le signale. Fonction pure.
 */

import { cheminLibre, slug } from './nomFichier'
import {
  LIBELLES_STATUT,
  reglesTypo,
  type ElementCorbeille,
  type Livre,
  type Partie,
  type Plan,
  type ReglagesLivre,
  type Section,
  type Statut,
} from './plan'
import type { ReglesTypo } from './typographie/regles'

export interface ResultatFusion {
  plan: Plan
  /** Ce qui a été remplacé, en clair, pour la notification. */
  remplacements: string[]
}

type Cote = 'local' | 'distant'

const identiques = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

class Fusion {
  readonly remplacements: string[] = []
  constructor(readonly gagnant: Cote) {}

  /**
   * Fusionne une valeur. `decrire` produit le message quand les deux côtés
   * l'ont changée différemment (perdue → gardée).
   */
  valeur<T>(base: T | undefined, local: T, distant: T, decrire?: (perdue: T, gardee: T) => string): T {
    if (identiques(local, distant)) return local
    if (base !== undefined && identiques(local, base)) return distant
    if (base !== undefined && identiques(distant, base)) return local
    const gardee = this.gagnant === 'local' ? local : distant
    const perdue = this.gagnant === 'local' ? distant : local
    if (decrire) this.remplacements.push(decrire(perdue, gardee))
    return gardee
  }
}

const INSECABLE = String.fromCharCode(0xa0)
const guillemets = (v: unknown) => `«${INSECABLE}${String(v)}${INSECABLE}»`

export function fusionnerPlans(base: Plan, local: Plan, distant: Plan, localPlusRecent: boolean): ResultatFusion {
  const f = new Fusion(localPlusRecent ? 'local' : 'distant')

  const livre = fusionnerLivre(f, base.livre, local.livre, distant.livre)
  const reglages = fusionnerReglages(f, base, local, distant)
  let parties = fusionnerParties(f, base.parties, local.parties, distant.parties)
  const { sections, corbeille } = fusionnerSections(f, base, local, distant)

  // Toute section doit appartenir à une partie qui existe.
  const connues = new Set(parties.map((p) => p.id))
  for (const s of [...sections, ...corbeille.map((e) => e.section)]) {
    if (connues.has(s.partie)) continue
    const retrouvee = [local, distant, base].flatMap((p) => p.parties).find((p) => p.id === s.partie)
    if (retrouvee && s.partie !== '') {
      parties = [...parties, retrouvee]
      connues.add(retrouvee.id)
    }
  }

  const plan: Plan = { version: 1, livre, ...(reglages ? { reglages } : {}), parties, sections, corbeille }
  return { plan: cheminsUniques(plan, distant), remplacements: f.remplacements }
}

function fusionnerLivre(f: Fusion, b: Livre, l: Livre, d: Livre): Livre {
  // L'ancien budget de pages n'est plus modifié : on garde celui de GitHub, s'il y en a un.
  return {
    titre: f.valeur(b.titre, l.titre, d.titre, (p, g) => `Titre du livre : ${guillemets(p)} remplacé par ${guillemets(g)}`),
    ...(d.pagesTotal === undefined ? {} : { pagesTotal: d.pagesTotal }),
    motsParPage: f.valeur(b.motsParPage, l.motsParPage, d.motsParPage, (p, g) => `Mots par page : ${p} remplacé par ${g}`),
    premierePage: f.valeur(b.premierePage, l.premierePage, d.premierePage),
  }
}

function fusionnerReglages(f: Fusion, b: Plan, l: Plan, d: Plan): ReglagesLivre | undefined {
  if (!b.reglages && !l.reglages && !d.reglages) return undefined
  const [tb, tl, td] = [reglesTypo(b), reglesTypo(l), reglesTypo(d)]
  const typographie = { ...tl }
  for (const cle of Object.keys(tl) as (keyof ReglesTypo)[]) {
    typographie[cle] = f.valeur(tb[cle], tl[cle], td[cle], () => `Réglage typographique « ${cle} » : la version la plus récente est gardée`)
  }
  const modele = f.valeur(
    b.reglages?.compilation?.modele ?? null,
    l.reglages?.compilation?.modele ?? null,
    d.reglages?.compilation?.modele ?? null,
    (p, g) => `Nom des compilations : ${guillemets(p ?? 'par défaut')} remplacé par ${guillemets(g ?? 'par défaut')}`,
  )
  return modele === null ? { typographie } : { typographie, compilation: { modele } }
}

function fusionnerParties(f: Fusion, b: Partie[], l: Partie[], d: Partie[]): Partie[] {
  const indexer = (liste: Partie[]) => new Map(liste.map((p) => [p.id, p]))
  const mb = indexer(b)
  const ml = indexer(l)
  const md = indexer(d)
  const resultat = new Map<string, Partie>()
  for (const id of new Set([...ml.keys(), ...md.keys(), ...mb.keys()])) {
    const pb = mb.get(id)
    const pl = ml.get(id)
    const pd = md.get(id)
    // Présence : une partie retirée d'un côté et inchangée de l'autre disparaît.
    const presente = f.valeur(pb !== undefined, pl !== undefined, pd !== undefined)
    if (!presente) continue
    if (pl && pd) {
      resultat.set(id, {
        id,
        titre: f.valeur(pb?.titre, pl.titre, pd.titre, (p, g) => `Partie ${guillemets(p)} renommée ${guillemets(g)}`),
        numerotee: f.valeur(pb?.numerotee, pl.numerotee, pd.numerotee),
      })
    } else {
      const seule = pl ?? pd ?? pb
      if (seule) resultat.set(id, seule)
    }
  }
  const ordre = fusionnerOrdre(f, b.map((p) => p.id), l.map((p) => p.id), d.map((p) => p.id), 'ordre des parties')
  return ordre.filter((id) => resultat.has(id)).map((id) => resultat.get(id) as Partie)
}

interface Position {
  ou: 'sections' | 'corbeille'
  section: Section
  corbeille?: ElementCorbeille
}

function indexer(plan: Plan): Map<string, Position> {
  const index = new Map<string, Position>()
  for (const s of plan.sections) index.set(s.id, { ou: 'sections', section: s })
  for (const e of plan.corbeille) index.set(e.section.id, { ou: 'corbeille', section: e.section, corbeille: e })
  return index
}

const LIBELLES_CHAMPS: Record<string, string> = {
  titre: 'titre',
  partie: 'partie',
  statut: 'statut',
  pages: 'pages',
  debut: 'début',
  resume: 'résumé',
  motsParPage: 'mots par page',
}

function afficher(champ: string, v: unknown): string {
  if (champ === 'statut') return LIBELLES_STATUT[v as Statut]
  if (v === null || v === undefined) return 'valeur du livre'
  return typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v)
}

function fusionnerSections(f: Fusion, base: Plan, local: Plan, distant: Plan): { sections: Section[]; corbeille: ElementCorbeille[] } {
  const [ib, il, id] = [indexer(base), indexer(local), indexer(distant)]
  const finales = new Map<string, Position>()

  for (const cle of new Set([...il.keys(), ...id.keys(), ...ib.keys()])) {
    const pb = ib.get(cle)
    const pl = il.get(cle)
    const pd = id.get(cle)
    const titre = (pl ?? pd ?? pb)?.section.titre ?? cle
    const ou = f.valeur<Position['ou'] | 'absente'>(pb?.ou ?? 'absente', pl?.ou ?? 'absente', pd?.ou ?? 'absente', (p, g) => {
      const etat = (v: string) => (v === 'absente' ? 'supprimée' : v === 'corbeille' ? 'dans la corbeille' : 'dans le plan')
      return `${titre} : ${etat(p)} sur un appareil, ${etat(g)} sur l’autre ; la version la plus récente est gardée (${etat(g)})`
    })
    if (ou === 'absente') continue

    let section: Section
    if (pl && pd) {
      const sb = pb?.section
      const fusionne: Record<string, unknown> = { ...pd.section }
      for (const champ of Object.keys(LIBELLES_CHAMPS)) {
        if (!(champ in pl.section) && !(champ in pd.section)) continue
        fusionne[champ] = f.valeur(
          sb ? (sb as unknown as Record<string, unknown>)[champ] : undefined,
          (pl.section as unknown as Record<string, unknown>)[champ],
          (pd.section as unknown as Record<string, unknown>)[champ],
          (p, g) => `${titre} : ${LIBELLES_CHAMPS[champ] ?? champ} ${guillemets(afficher(champ, p))} remplacé par ${guillemets(afficher(champ, g))}`,
        )
      }
      if (pl.section.type === 'texte' && pd.section.type === 'texte') {
        // Le chemin du fichier suit l'emplacement retenu.
        fusionne.fichier =
          pl.ou !== pd.ou
            ? (ou === pl.ou ? pl.section.fichier : pd.section.fichier)
            : f.valeur(sb?.type === 'texte' ? sb.fichier : undefined, pl.section.fichier, pd.section.fichier)
      }
      section = fusionne as unknown as Section
    } else {
      const seule = pl ?? pd ?? pb
      if (!seule) continue
      section = seule.section
    }
    const source = [pl, pd].find((p) => p?.ou === 'corbeille')
    finales.set(cle, {
      ou,
      section,
      ...(ou === 'corbeille' && source?.corbeille ? { corbeille: { ...source.corbeille, section } } : {}),
    })
  }

  const ids = (plan: Plan) => plan.sections.map((s) => s.id)
  const ordre = fusionnerOrdre(f, ids(base), ids(local), ids(distant), 'ordre des sections')
  const dansLePlan = ordre.filter((cle) => finales.get(cle)?.ou === 'sections')
  const sections = dansLePlan.map((cle) => (finales.get(cle) as Position).section)

  const ordreCorbeille = [...distant.corbeille, ...local.corbeille, ...base.corbeille].map((e) => e.section.id)
  const corbeille: ElementCorbeille[] = []
  for (const cle of new Set(ordreCorbeille)) {
    const p = finales.get(cle)
    if (p?.ou === 'corbeille' && p.corbeille) corbeille.push(p.corbeille)
  }
  return { sections, corbeille }
}

/**
 * Ordre fusionné d'une liste d'identifiants. Si un seul côté a changé
 * l'ordre des éléments communs, on le reprend ; si les deux l'ont changé,
 * l'ordre le plus récent l'emporte. Les éléments ajoutés de l'autre côté
 * sont ensuite insérés après leur voisin précédent.
 */
function fusionnerOrdre(f: Fusion, base: string[], local: string[], distant: string[], quoi: string): string[] {
  const communs = (liste: string[], avec: string[]) => {
    const s = new Set(avec)
    return liste.filter((x) => s.has(x))
  }
  const localChange = !identiques(communs(local, base), communs(base, local))
  const distantChange = !identiques(communs(distant, base), communs(base, distant))
  let principal: string[]
  if (!localChange) principal = [...distant]
  else if (!distantChange) principal = [...local]
  else {
    principal = f.gagnant === 'local' ? [...local] : [...distant]
    if (!identiques(communs(local, distant), communs(distant, local))) {
      f.remplacements.push(`L’${quoi} a changé sur les deux appareils : celui de la version la plus récente est gardé`)
    }
  }
  const autre = principal === local || identiques(principal, local) ? distant : local
  for (const [i, x] of autre.entries()) {
    if (principal.includes(x)) continue
    // Après le voisin précédent qui est déjà placé, sinon en tête.
    let position = 0
    for (let j = i - 1; j >= 0; j--) {
      const k = principal.indexOf(autre[j] ?? '')
      if (k !== -1) {
        position = k + 1
        break
      }
    }
    principal.splice(position, 0, x)
  }
  return principal
}

/** Deux sections ne peuvent pas partager un fichier : celle de GitHub garde le sien. */
function cheminsUniques(plan: Plan, distant: Plan): Plan {
  const deGitHub = new Map<string, string>()
  for (const s of [...distant.sections, ...distant.corbeille.map((e) => e.section)]) {
    if (s.type === 'texte') deGitHub.set(s.fichier, s.id)
  }
  const pris = new Set<string>()
  const toutes = [...plan.sections, ...plan.corbeille.map((e) => e.section)]
  // D'abord les chemins tenus par leur propriétaire sur GitHub.
  for (const s of toutes) if (s.type === 'texte' && deGitHub.get(s.fichier) === s.id) pris.add(s.fichier)
  const renommer = (s: Section): Section => {
    if (s.type !== 'texte') return s
    if (deGitHub.get(s.fichier) === s.id) return s
    if (!pris.has(s.fichier)) {
      pris.add(s.fichier)
      return s
    }
    const dossier = s.fichier.startsWith('corbeille/') ? 'corbeille/' : 'sections/'
    const fichier = cheminLibre(dossier, slug(s.titre), pris)
    pris.add(fichier)
    return { ...s, fichier }
  }
  return {
    ...plan,
    sections: plan.sections.map(renommer),
    corbeille: plan.corbeille.map((e) => ({ ...e, section: renommer(e.section) })),
  }
}
