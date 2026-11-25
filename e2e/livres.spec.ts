import { expect, test, type Page } from '@playwright/test'
import { lirePlan, serialiserPlan } from '../src/domaine/plan'
import { brancherFauxGitHub, etat, FauxGitHub, lireExemple, postit, seConnecter, surveillerErreurs } from './outils'

const exemple = lireExemple()

function avecTitre(titre: string): Record<string, string> {
  const plan = lirePlan(exemple['plan.json'] ?? '')
  return { ...exemple, 'plan.json': serialiserPlan({ ...plan, livre: { ...plan.livre, titre } }) }
}

async function ouvrirLivres(page: Page) {
  await page.getByRole('button', { name: /changer de livre/ }).click()
  return page.getByRole('dialog', { name: 'Livres' })
}

test('ajouter un livre existant, passer de l’un à l’autre, chacun garde ses modifications', async ({ page }) => {
  const erreurs = surveillerErreurs(page)
  const katastrophe = await FauxGitHub.creer(exemple)
  const roman = await FauxGitHub.creer(avecTitre('Le Roman'), 'roman')
  await brancherFauxGitHub(page, [katastrophe, roman])
  await page.goto('./')
  await seConnecter(page)
  await expect(etat(page)).toHaveText('Synchronisé')

  let livres = await ouvrirLivres(page)
  await expect(livres.locator('.livre-ouvert')).toContainText('Katastrophê')
  await livres.getByLabel('Dépôt GitHub du livre').fill('autrice/roman')
  await livres.getByRole('button', { name: 'Ajouter' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Le Roman')
  await expect(etat(page)).toHaveText('Synchronisé')

  // Une modification dans le roman part dans son dépôt avant de changer de livre.
  await postit(page, 'Lexique').getByRole('button', { name: 'Une page de plus pour Lexique' }).click()
  livres = await ouvrirLivres(page)
  await expect(livres.locator('.livre-ouvert')).toContainText('Le Roman')
  await livres.getByRole('button', { name: /^Katastrophê/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Katastrophê')
  expect(roman.messages()[0]).toBe('Plan : Lexique sur 3 pages')
  expect(katastrophe.messages()).toEqual(['Création'])

  // Au rechargement, le dernier livre ouvert revient.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Katastrophê')
  livres = await ouvrirLivres(page)
  await expect(livres.getByRole('listitem')).toHaveCount(2)
  expect(erreurs).toEqual([])
})

test('créer un livre dans un dépôt vide depuis l’Atelier', async ({ page }) => {
  const erreurs = surveillerErreurs(page)
  const katastrophe = await FauxGitHub.creer(exemple)
  const nouveau = FauxGitHub.creerVide('ombres')
  await brancherFauxGitHub(page, [katastrophe, nouveau])
  await page.goto('./')
  await seConnecter(page)
  await expect(etat(page)).toHaveText('Synchronisé')

  const livres = await ouvrirLivres(page)
  await livres.getByLabel('Dépôt GitHub du livre').fill('autrice/ombres')
  await livres.getByRole('button', { name: 'Ajouter' }).click()
  await expect(livres).toContainText('autrice/ombres est vide')
  await livres.getByLabel('Titre du livre').fill('Les Ombres')
  await livres.getByLabel('Parties, une par ligne').fill('Prologue\nLe monde\nAnnexes')
  await livres.getByRole('button', { name: 'Créer le manuscrit' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Les Ombres')
  await expect(page.locator('.barre-etat')).toContainText('Pages 0')
  const plan = lirePlan(nouveau.fichiers()['plan.json'] ?? '')
  expect(plan.parties.map((p) => p.titre)).toEqual(['Prologue', 'Le monde', 'Annexes'])
  expect(plan.reglages?.compilation?.modele).toBe('Les_Ombres__v{n}.md')

  // Les trois parties, vides, sont là ; on crée la première section dans la première.
  await expect(page.locator('.separateur-vide')).toHaveText(['I. Prologue · vide', 'II. Le monde · vide', 'III. Annexes · vide'])
  await page.getByRole('button', { name: 'Nouvelle section dans Prologue' }).click()
  const creation = page.getByRole('dialog', { name: 'Nouvelle section' })
  await creation.getByRole('textbox', { name: 'Titre' }).fill('Ouverture')
  await creation.getByRole('button', { name: 'Créer' }).click()
  await expect(postit(page, 'Ouverture')).toBeVisible()
  await expect(page.locator('.separateur').first()).toHaveText('I. Prologue')
  await expect(page.locator('.separateur-vide')).toHaveText(['II. Le monde · vide', 'III. Annexes · vide'])
  // GitHub signale un dépôt sans commit par une réponse 409, que le
  // navigateur note dans la console : c'est attendu.
  expect(erreurs.filter((e) => !e.includes('status of 409'))).toEqual([])
})

test('première connexion sur un dépôt vide : l’écran d’accueil propose de créer le livre', async ({ page }) => {
  const vide = FauxGitHub.creerVide('katastrophe')
  await brancherFauxGitHub(page, vide)
  await page.goto('./')
  await seConnecter(page)
  await expect(page.getByRole('heading', { name: 'Nouveau livre' })).toBeVisible()
  await page.getByLabel('Titre du livre').fill('Katastrophê')
  await page.getByLabel('Parties, une par ligne').fill('Présentation')
  await page.getByRole('button', { name: 'Créer le manuscrit' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Katastrophê')
  expect(lirePlan(vide.fichiers()['plan.json'] ?? '').reglages?.compilation?.modele).toBe('Katastrophe__v{n}.md')
})

test('retirer un livre de l’appareil', async ({ page }) => {
  const katastrophe = await FauxGitHub.creer(exemple)
  const roman = await FauxGitHub.creer(avecTitre('Le Roman'), 'roman')
  await brancherFauxGitHub(page, [katastrophe, roman])
  await page.goto('./')
  await seConnecter(page)
  let livres = await ouvrirLivres(page)
  await livres.getByLabel('Dépôt GitHub du livre').fill('autrice/roman')
  await livres.getByRole('button', { name: 'Ajouter' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Le Roman')

  livres = await ouvrirLivres(page)
  // Le livre ouvert n'a pas de bouton « Retirer ».
  await expect(livres.getByRole('button', { name: /^Retirer/ })).toHaveCount(1)
  page.once('dialog', (d) => void d.accept())
  await livres.getByRole('button', { name: 'Retirer Katastrophê de cet appareil' }).click()
  await expect(livres.getByRole('listitem')).toHaveCount(1)
  await expect(livres.getByRole('listitem')).toContainText('Le Roman')
})
