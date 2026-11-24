/**
 * Synchronisation descendante : met le cache local au niveau du dernier
 * commit de la branche, en ne téléchargeant que les blobs modifiés.
 * L'envoi des modifications locales viendra au jalon 3.
 */

import type { BaseSynchro, Cache, FichierCache } from '../stockage/cache'
import type { ClientGitHub, Depot } from './client'
import { shaBlobGit } from './empreinte'
import { lireArbreDuCommit, lireBlob, lireTete } from './lecture'

export const CHEMIN_PLAN = 'plan.json'

/** Fichiers du manuscrit gardés sur l'appareil. Les compilations n'en font pas partie. */
export function faitPartieDuManuscrit(chemin: string): boolean {
  return chemin === CHEMIN_PLAN || /^(sections|corbeille)\/[^/]+\.md$/.test(chemin)
}

export interface ResultatSynchro {
  commit: string
  telecharges: number
  supprimes: number
}

const TELECHARGEMENTS_SIMULTANES = 6

export async function synchroniser(
  client: ClientGitHub,
  depot: Depot,
  branche: string,
  cache: Cache,
  /** Contenus que l'appareil vient d'envoyer : inutile de les retélécharger. */
  contenusConnus: readonly string[] = [],
  maintenant: () => Date = () => new Date(),
): Promise<ResultatSynchro> {
  const tete = await lireTete(client, depot, branche)
  const base = await cache.lireBase()
  if (base?.commit === tete) return { commit: tete, telecharges: 0, supprimes: 0 }

  const distant = await lireArbreDuCommit(client, depot, tete)

  const locaux = await cache.lireFichiers()
  // Contenus déjà présents sur l'appareil, par empreinte : un fichier
  // renommé ou que l'on vient d'envoyer n'est pas retéléchargé.
  const parSha = new Map<string, string>()
  for (const f of locaux.values()) parSha.set(f.sha, f.contenu)
  for (const contenu of contenusConnus) parSha.set(await shaBlobGit(contenu), contenu)

  const aTelecharger: [chemin: string, sha: string][] = []
  const reutilises: FichierCache[] = []
  for (const [chemin, sha] of distant.fichiers) {
    if (!faitPartieDuManuscrit(chemin) || locaux.get(chemin)?.sha === sha) continue
    const connu = parSha.get(sha)
    if (connu === undefined) aTelecharger.push([chemin, sha])
    else reutilises.push({ chemin, sha, contenu: connu })
  }
  const aSupprimer = [...locaux.keys()].filter(
    (chemin) => !distant.fichiers.has(chemin) || !faitPartieDuManuscrit(chemin),
  )

  // Tout est téléchargé avant d'écrire : une coupure en cours de route
  // laisse le cache dans son état précédent, cohérent.
  const nouveaux = await enParallele(aTelecharger, TELECHARGEMENTS_SIMULTANES, async ([chemin, sha]) => {
    const fichier: FichierCache = { chemin, sha, contenu: await lireBlob(client, depot, sha) }
    return fichier
  })

  const nouvelleBase: BaseSynchro = { commit: distant.commit, le: maintenant().toISOString() }
  await cache.appliquerSynchro(nouvelleBase, [...reutilises, ...nouveaux], aSupprimer)
  return { commit: distant.commit, telecharges: nouveaux.length, supprimes: aSupprimer.length }
}

async function enParallele<E, R>(
  elements: readonly E[],
  limite: number,
  traiter: (e: E) => Promise<R>,
): Promise<R[]> {
  const resultats: R[] = new Array<R>(elements.length)
  let suivant = 0
  async function travailleur(): Promise<void> {
    while (suivant < elements.length) {
      const i = suivant++
      resultats[i] = await traiter(elements[i] as E)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, elements.length) }, travailleur))
  return resultats
}
