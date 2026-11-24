import { expect, test } from '@playwright/test'
import { brancherFauxGitHub, FauxGitHub, lireExemple, seConnecter, surveillerErreurs } from './outils'

const TITRES = [
  'Page de titre',
  'Avant-propos',
  'Qu’est-ce que Katastrophê ?',
  'Créer son personnage',
  'Le heurt',
  'Illustration : la chute',
  'Les serments',
  'La chute',
  'Les conséquences',
  'Lexique',
]

test('sans jeton, seul l’écran de connexion s’affiche', async ({ page }) => {
  const erreurs = surveillerErreurs(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Atelier' })).toBeVisible()
  await expect(page.getByLabel('Jeton d’accès personnel')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1)
  expect(erreurs).toEqual([])
})

test('la liste des sections du manuscrit d’exemple s’affiche dans l’ordre du plan', async ({ page }) => {
  const erreurs = surveillerErreurs(page)
  await brancherFauxGitHub(page, await FauxGitHub.creer(lireExemple()))
  await page.goto('./')
  await seConnecter(page)

  await expect(page.getByRole('heading', { name: 'Katastrophê' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('Synchronisé')
  await expect(page.locator('.ligne-titre')).toHaveText(TITRES)

  // Séparateurs de parties, avec numéro romain pour les parties numérotées.
  await expect(page.locator('.partie-titre')).toHaveText([
    'Partie IPrésentation',
    'Partie IILes règles',
    'Lexique',
  ])
  await expect(page.getByRole('img', { name: 'Hors-texte' })).toHaveCount(2)
  await expect(page.getByText('Commence à gauche')).toHaveCount(1)

  // Rien ne dépasse horizontalement, même sur téléphone.
  const debordement = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(debordement).toBeLessThanOrEqual(0)
  expect(erreurs).toEqual([])
})

test('un jeton refusé reste sur l’écran de connexion avec un message', async ({ page }) => {
  await brancherFauxGitHub(page, await FauxGitHub.creer(lireExemple()))
  await page.goto('./')
  await seConnecter(page, 'jeton-faux')
  await expect(page.getByRole('alert')).toContainText('GitHub refuse ce jeton')
  await expect(page.getByLabel('Jeton d’accès personnel')).toBeVisible()
})

test('rouvert hors ligne, le site affiche le manuscrit depuis le cache', async ({ page }) => {
  const erreurs = surveillerErreurs(page)
  const reseau = await brancherFauxGitHub(page, await FauxGitHub.creer(lireExemple()))
  await page.goto('./')
  await seConnecter(page)
  await expect(page.getByRole('status')).toHaveText('Synchronisé')

  reseau.couper(true)
  await page.reload()
  await expect(page.getByRole('status')).toContainText('Hors ligne')
  await expect(page.locator('.ligne-titre')).toHaveText(TITRES)

  reseau.couper(false)
  await page.getByRole('button', { name: 'Synchroniser' }).click()
  await expect(page.getByRole('status')).toHaveText('Synchronisé')
  expect(erreurs).toEqual([])
})

test('une modification faite ailleurs apparaît à la synchronisation suivante', async ({ page }) => {
  const exemple = lireExemple()
  const faux = await FauxGitHub.creer(exemple)
  await brancherFauxGitHub(page, faux)
  await page.goto('./')
  await seConnecter(page)
  await expect(page.locator('.ligne-titre')).toHaveText(TITRES)

  const plan = JSON.parse(exemple['plan.json'] ?? '') as { sections: { titre: string }[] }
  const premiere = plan.sections[1]
  if (premiere) premiere.titre = 'Préface'
  await faux.publier({ ...exemple, 'plan.json': JSON.stringify(plan, null, 2) + '\n' })
  faux.oublierRequetes()

  await page.getByRole('button', { name: 'Synchroniser' }).click()
  await expect(page.locator('.ligne-titre').nth(1)).toHaveText('Préface')
  expect(faux.blobsTelecharges).toBe(1)
})

test('un jeton révoqué ramène à la connexion sans perdre le dépôt', async ({ page }) => {
  const faux = await FauxGitHub.creer(lireExemple())
  await brancherFauxGitHub(page, faux)
  await page.goto('./')
  await seConnecter(page)
  await expect(page.getByRole('status')).toHaveText('Synchronisé')

  faux.jetonValide = 'nouveau'
  await page.getByRole('button', { name: 'Synchroniser' }).click()
  await expect(page.getByRole('alert')).toContainText('n’accepte plus votre jeton')
  await expect(page.getByLabel('Dépôt du manuscrit')).toHaveValue('autrice/katastrophe')

  await page.getByLabel('Jeton d’accès personnel').fill('nouveau')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.locator('.ligne-titre')).toHaveCount(10)
})

test('la déconnexion demande confirmation puis efface tout', async ({ page }) => {
  await brancherFauxGitHub(page, await FauxGitHub.creer(lireExemple()))
  await page.goto('./')
  await seConnecter(page)
  await expect(page.locator('.ligne-titre')).toHaveCount(10)

  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Se déconnecter' }).click()
  await expect(page.getByLabel('Dépôt du manuscrit')).toHaveValue('')
  await page.reload()
  await expect(page.getByLabel('Jeton d’accès personnel')).toBeVisible()
})
