import { describe, expect, it } from 'vitest'
import { FauxGitHub } from '../test/fauxGitHub'
import { creerClient, ErreurGitHub, lireNomDepot, type Depot } from './client'
import { decoderBase64Utf8, lireBlob, lireInfosDepot, lireInstantane } from './lecture'

function base64(octets: number[]): string {
  return btoa(String.fromCharCode(...octets))
}

describe('decoderBase64Utf8', () => {
  it('conserve les espaces insécables, les apostrophes et les accents', () => {
    const texte = 'Non ! L’acte « élevé » …'
    const octets = [...new TextEncoder().encode(texte)]
    expect(decoderBase64Utf8(base64(octets))).toBe(texte)
  })

  it('conserve une marque d’ordre des octets', () => {
    expect(decoderBase64Utf8(base64([0xef, 0xbb, 0xbf, 0x41]))).toBe('﻿A')
  })

  it('accepte le base64 coupé en lignes, comme le renvoie GitHub', () => {
    expect(decoderBase64Utf8('Qm9u\nam91\ncg==\n')).toBe('Bonjour')
  })

  it('refuse un fichier qui n’est pas en UTF-8', () => {
    expect(() => decoderBase64Utf8(base64([0xe9]))).toThrow(ErreurGitHub)
  })
})

describe('lireNomDepot', () => {
  it.each([
    ['autrice/katastrophe', { proprietaire: 'autrice', nom: 'katastrophe' }],
    ['  autrice/katastrophe  ', { proprietaire: 'autrice', nom: 'katastrophe' }],
    ['https://github.com/autrice/katastrophe', { proprietaire: 'autrice', nom: 'katastrophe' }],
    ['https://github.com/autrice/katastrophe.git', { proprietaire: 'autrice', nom: 'katastrophe' }],
    ['katastrophe', null],
    ['a/b/c', null],
    ['autrice/kata strophe', null],
  ])('« %s »', (saisie, attendu) => {
    expect(lireNomDepot(saisie)).toEqual(attendu)
  })
})

describe('lecture du dépôt', () => {
  async function preparer() {
    const faux = await FauxGitHub.creer({
      'plan.json': '{}\n',
      'sections/a.md': 'Texte A\n',
      'outils/compiler.py': 'print()\n',
    })
    const depot: Depot = { proprietaire: faux.proprietaire, nom: faux.nom }
    return { faux, depot, client: creerClient(faux.jetonValide, faux.enFetch()) }
  }

  it('lit la branche par défaut', async () => {
    const { depot, client } = await preparer()
    expect(await lireInfosDepot(client, depot)).toEqual({ brancheParDefaut: 'main' })
  })

  it('lit l’arbre complet et un blob', async () => {
    const { depot, client, faux } = await preparer()
    const instantane = await lireInstantane(client, depot, 'main')
    expect(instantane.commit).toBe(faux.commit)
    expect([...instantane.fichiers.keys()]).toEqual(['plan.json', 'sections/a.md', 'outils/compiler.py'])
    const sha = instantane.fichiers.get('sections/a.md') ?? ''
    expect(await lireBlob(client, depot, sha)).toBe('Texte A\n')
  })

  it('utilise de vrais SHA de blob Git', async () => {
    const { depot, client } = await preparer()
    const instantane = await lireInstantane(client, depot, 'main')
    // git hash-object sur un fichier contenant « Texte A\n »
    expect(instantane.fichiers.get('sections/a.md')).toBe('f54ecc70a97b2ba7bbf1af497081d71e57993b49')
  })

  it('traduit un jeton refusé en erreur de nature « jeton »', async () => {
    const { depot, faux } = await preparer()
    const client = creerClient('mauvais', faux.enFetch())
    await expect(lireInfosDepot(client, depot)).rejects.toMatchObject({ nature: 'jeton', statut: 401 })
  })

  it('traduit un dépôt inconnu et un dépôt vide', async () => {
    const { client, faux, depot } = await preparer()
    await expect(lireInfosDepot(client, { proprietaire: 'x', nom: 'y' })).rejects.toMatchObject({
      nature: 'introuvable',
    })
    faux.vide = true
    await expect(lireInstantane(client, depot, 'main')).rejects.toMatchObject({ nature: 'depot-vide' })
  })

  it('traduit une coupure réseau', async () => {
    const client = creerClient('x', () => Promise.reject(new TypeError('Failed to fetch')))
    await expect(lireInfosDepot(client, { proprietaire: 'a', nom: 'b' })).rejects.toMatchObject({
      nature: 'reseau',
    })
  })

  it('distingue la limite de requêtes d’un manque de permission', async () => {
    const limite = creerClient('x', () =>
      Promise.resolve(new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })),
    )
    await expect(lireInfosDepot(limite, { proprietaire: 'a', nom: 'b' })).rejects.toMatchObject({ nature: 'limite' })
    const interdit = creerClient('x', () => Promise.resolve(new Response('{}', { status: 403 })))
    await expect(lireInfosDepot(interdit, { proprietaire: 'a', nom: 'b' })).rejects.toMatchObject({
      nature: 'permission',
    })
  })
})
