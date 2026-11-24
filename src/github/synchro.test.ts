import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { Cache } from '../stockage/cache'
import { lireExemple } from '../test/exemple'
import { FauxGitHub } from '../test/fauxGitHub'
import { creerClient, type Depot } from './client'
import { faitPartieDuManuscrit, synchroniser } from './synchro'

let numero = 0
const ouverts: Cache[] = []

async function preparer(fichiers: Record<string, string>) {
  const faux = await FauxGitHub.creer(fichiers)
  const depot: Depot = { proprietaire: faux.proprietaire, nom: faux.nom }
  const client = creerClient(faux.jetonValide, faux.enFetch())
  const cache = await Cache.ouvrir(`test-synchro-${++numero}`)
  ouverts.push(cache)
  const synchro = () => synchroniser(client, depot, 'main', cache)
  return { faux, cache, synchro }
}

afterEach(() => {
  for (const c of ouverts.splice(0)) c.fermer()
})

describe('faitPartieDuManuscrit', () => {
  it.each([
    ['plan.json', true],
    ['sections/le-heurt.md', true],
    ['corbeille/ancienne.md', true],
    ['compilations/Katastrophe__v27.md', false],
    ['outils/compiler.py', false],
    ['README.md', false],
    ['sections/sous/dossier.md', false],
  ])('%s → %s', (chemin, attendu) => {
    expect(faitPartieDuManuscrit(chemin)).toBe(attendu)
  })
})

describe('synchroniser', () => {
  it('télécharge tout le manuscrit d’exemple au premier passage, texte intact', async () => {
    const exemple = lireExemple()
    const { cache, synchro } = await preparer({ ...exemple, 'README.md': '# Manuscrit\n' })
    const resultat = await synchro()
    expect(resultat.telecharges).toBe(Object.keys(exemple).length)
    const fichiers = await cache.lireFichiers()
    expect(fichiers.has('README.md')).toBe(false)
    for (const [chemin, contenu] of Object.entries(exemple)) {
      expect(fichiers.get(chemin)?.contenu).toBe(contenu)
    }
  })

  it('ne télécharge rien si le commit n’a pas changé', async () => {
    const { faux, synchro } = await preparer(lireExemple())
    await synchro()
    faux.oublierRequetes()
    const resultat = await synchro()
    expect(resultat.telecharges).toBe(0)
    expect(faux.requetes).toHaveLength(1) // seulement la référence de branche
  })

  it('ne télécharge que les fichiers dont le SHA a changé', async () => {
    const exemple = lireExemple()
    const { faux, cache, synchro } = await preparer(exemple)
    await synchro()

    const modifie: Record<string, string> = { ...exemple, 'sections/le-heurt.md': 'Nouvelle version\n' }
    delete modifie['sections/lexique.md']
    modifie['sections/nouvelle.md'] = 'Ajoutée\n'
    await faux.publier(modifie)
    faux.oublierRequetes()

    const resultat = await synchro()
    expect(resultat).toMatchObject({ telecharges: 2, supprimes: 1, commit: faux.commit })
    expect(faux.blobsTelecharges).toBe(2)
    const fichiers = await cache.lireFichiers()
    expect(fichiers.get('sections/le-heurt.md')?.contenu).toBe('Nouvelle version\n')
    expect(fichiers.has('sections/lexique.md')).toBe(false)
    expect((await cache.lireBase())?.commit).toBe(faux.commit)
  })

  it('laisse le cache intact si un téléchargement échoue', async () => {
    const exemple = lireExemple()
    const faux = await FauxGitHub.creer(exemple)
    const depot: Depot = { proprietaire: faux.proprietaire, nom: faux.nom }
    const cache = await Cache.ouvrir(`test-synchro-${++numero}`)
    ouverts.push(cache)
    await synchroniser(creerClient(faux.jetonValide, faux.enFetch()), depot, 'main', cache)
    const avant = await cache.lireBase()

    await faux.publier({ ...exemple, 'sections/le-heurt.md': 'Modifié\n', 'sections/autre.md': 'Autre\n' })
    const fetchNormal = faux.enFetch()
    let blobs = 0
    const fetchCoupe: typeof fetch = (entree, init) => {
      const url = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url
      if (url.includes('/git/blobs/') && ++blobs === 2) {
        return Promise.reject(new TypeError('Failed to fetch'))
      }
      return fetchNormal(entree, init)
    }
    await expect(
      synchroniser(creerClient(faux.jetonValide, fetchCoupe), depot, 'main', cache),
    ).rejects.toMatchObject({ nature: 'reseau' })

    expect(await cache.lireBase()).toEqual(avant)
    expect((await cache.lireFichiers()).get('sections/le-heurt.md')?.contenu).toBe(exemple['sections/le-heurt.md'])
  })
})
