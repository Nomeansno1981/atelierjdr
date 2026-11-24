import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { lireExemple } from '../test/exemple'
import { FauxGitHub } from '../test/fauxGitHub'
import { Atelier, type EtatAtelier } from './atelier'

let numero = 0

async function demarrer(faux: FauxGitHub, nomBase = `test-atelier-${++numero}`) {
  const atelier = new Atelier({ fetch: faux.enFetch(), nomBase })
  await atelier.demarrer()
  return atelier
}

function enAtelier(etat: EtatAtelier) {
  if (etat.phase !== 'atelier') throw new Error(`phase attendue : atelier, trouvée : ${etat.phase}`)
  return etat
}

describe('Atelier', () => {
  it('demande un jeton au premier lancement', async () => {
    const atelier = await demarrer(await FauxGitHub.creer(lireExemple()))
    expect(atelier.lire()).toEqual({ phase: 'connexion', depot: null, message: null })
  })

  it('refuse un jeton invalide sans quitter l’écran de connexion', async () => {
    const atelier = await demarrer(await FauxGitHub.creer(lireExemple()))
    const message = await atelier.seConnecter('mauvais', 'autrice/katastrophe')
    expect(message).toContain('GitHub refuse ce jeton')
    expect(atelier.lire().phase).toBe('connexion')
  })

  it('refuse un nom de dépôt mal formé', async () => {
    const atelier = await demarrer(await FauxGitHub.creer(lireExemple()))
    expect(await atelier.seConnecter('jeton-valide', 'katastrophe')).toContain('Nom de dépôt invalide')
  })

  it('signale un dépôt vide dès la connexion', async () => {
    const faux = await FauxGitHub.creer({})
    faux.vide = true
    const atelier = await demarrer(faux)
    expect(await atelier.seConnecter('jeton-valide', 'autrice/katastrophe')).toContain('Le dépôt est vide')
  })

  it('se connecte, synchronise et lit le plan', async () => {
    const faux = await FauxGitHub.creer(lireExemple())
    const atelier = await demarrer(faux)
    expect(await atelier.seConnecter(' jeton-valide ', 'autrice/katastrophe')).toBeNull()
    await atelier.synchroniser()
    const etat = enAtelier(atelier.lire())
    expect(etat.synchro.etat).toBe('a-jour')
    expect(etat.manuscrit?.plan?.sections).toHaveLength(10)
    expect(etat.manuscrit?.textes.get('sections/le-heurt.md')).toBe(lireExemple()['sections/le-heurt.md'])
  })

  it('rouvre sur le cache, hors ligne, sans redemander le jeton', async () => {
    const faux = await FauxGitHub.creer(lireExemple())
    const nomBase = `test-atelier-${++numero}`
    const premier = await demarrer(faux, nomBase)
    await premier.seConnecter('jeton-valide', 'autrice/katastrophe')
    await premier.synchroniser()

    const horsLigne = new Atelier({ fetch: () => Promise.reject(new TypeError('Failed to fetch')), nomBase })
    await horsLigne.demarrer()
    await horsLigne.synchroniser()
    const etat = enAtelier(horsLigne.lire())
    expect(etat.synchro.etat).toBe('hors-ligne')
    expect(etat.manuscrit?.plan?.sections).toHaveLength(10)
  })

  it('redemande un jeton après un 401 en gardant le dépôt et le cache', async () => {
    const faux = await FauxGitHub.creer(lireExemple())
    const nomBase = `test-atelier-${++numero}`
    const atelier = await demarrer(faux, nomBase)
    await atelier.seConnecter('jeton-valide', 'autrice/katastrophe')
    await atelier.synchroniser()

    faux.jetonValide = 'nouveau-jeton' // l'ancien est révoqué
    await atelier.synchroniser()
    const etat = atelier.lire()
    expect(etat).toMatchObject({ phase: 'connexion', depot: { proprietaire: 'autrice', nom: 'katastrophe' } })
    expect(etat.phase === 'connexion' && etat.message).toContain('n’accepte plus votre jeton')

    // Le cache est toujours là : il s'affiche dès la reconnexion.
    expect(await atelier.seConnecter('nouveau-jeton', 'autrice/katastrophe')).toBeNull()
    expect(enAtelier(atelier.lire()).manuscrit?.plan?.sections).toHaveLength(10)
  })

  it('affiche une erreur claire si plan.json est invalide', async () => {
    const atelier = await demarrer(await FauxGitHub.creer({ 'plan.json': '{"version": 2}' }))
    await atelier.seConnecter('jeton-valide', 'autrice/katastrophe')
    await atelier.synchroniser()
    const manuscrit = enAtelier(atelier.lire()).manuscrit
    expect(manuscrit?.plan).toBeNull()
    expect(manuscrit?.erreurPlan).toContain('plan.json est invalide')
  })

  it('signale l’absence de plan.json', async () => {
    const atelier = await demarrer(await FauxGitHub.creer({ 'README.md': 'x' }))
    await atelier.seConnecter('jeton-valide', 'autrice/katastrophe')
    await atelier.synchroniser()
    expect(enAtelier(atelier.lire()).manuscrit?.erreurPlan).toContain('ne contient pas de plan.json')
  })

  it('efface tout à la déconnexion', async () => {
    const faux = await FauxGitHub.creer(lireExemple())
    const nomBase = `test-atelier-${++numero}`
    const atelier = await demarrer(faux, nomBase)
    await atelier.seConnecter('jeton-valide', 'autrice/katastrophe')
    await atelier.synchroniser()
    await atelier.seDeconnecter()
    expect(atelier.lire()).toEqual({ phase: 'connexion', depot: null, message: null })

    const rouvert = await demarrer(faux, nomBase)
    expect(rouvert.lire()).toEqual({ phase: 'connexion', depot: null, message: null })
  })
})
