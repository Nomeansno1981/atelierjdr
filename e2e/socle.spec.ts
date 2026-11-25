import { expect, test } from '@playwright/test'
import { brancherFauxGitHub, etat, FauxGitHub, lireExemple, seConnecter, surveillerErreurs, titres, TITRES } from './outils'


test('sans jeton, seul l’écran de connexion s’affiche', async ({ page }) => {
  const erreurs = surveillerErreurs(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Atelier' })).toBeVisible()
  await expect(page.getByLabel('Jeton d’accès personnel')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1)
  expect(erreurs).toEqual([])
})

test('le chemin de fer du manuscrit d’exemple s’affiche, paginé', async ({ page }) => {
  const erreurs = surveillerErreurs(page)
  await brancherFauxGitHub(page, await FauxGitHub.creer(lireExemple()))
  await page.goto('./')
  await seConnecter(page)

  await expect(page.getByRole('heading', { name: 'Katastrophê' })).toBeVisible()
  await expect(etat(page)).toHaveText('Synchronisé')
  await expect(titres(page)).toHaveText(TITRES)

  // 19 pages, celles qu'occupent les sections, dont une page blanche en 13.
  await expect(page.locator('.numero')).toHaveText(Array.from({ length: 19 }, (_, i) => String(i + 1)))
  await expect(page.locator('.page-blanche')).toHaveAttribute('data-page', '13')
  await expect(page.locator('.barre-etat')).toContainText('Pages 19')
  await expect(page.locator('.separateur')).toHaveText(['I. Présentation', 'II. Les règles', 'Lexique'])
  await expect(page.getByRole('img', { name: 'Hors-texte' })).toHaveCount(2)
  // Les post-its de plusieurs pages coupés sur deux planches portent « suite ».
  await expect(page.locator('.postit-suite')).toHaveCount(4)

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

test('GitHub injoignable : le site affiche le manuscrit depuis le cache', async ({ page }) => {
  const erreurs = surveillerErreurs(page)
  const reseau = await brancherFauxGitHub(page, await FauxGitHub.creer(lireExemple()))
  await page.goto('./')
  await seConnecter(page)
  await expect(etat(page)).toHaveText('Synchronisé')

  reseau.couper(true)
  await page.reload()
  await expect(etat(page)).toContainText('Hors ligne')
  await expect(titres(page)).toHaveText(TITRES)

  reseau.couper(false)
  await page.getByRole('button', { name: 'Synchroniser' }).click()
  await expect(etat(page)).toHaveText('Synchronisé')
  expect(erreurs).toEqual([])
})

test('une modification faite ailleurs apparaît à la synchronisation suivante', async ({ page }) => {
  const exemple = lireExemple()
  const faux = await FauxGitHub.creer(exemple)
  await brancherFauxGitHub(page, faux)
  await page.goto('./')
  await seConnecter(page)
  await expect(titres(page)).toHaveText(TITRES)

  const plan = JSON.parse(exemple['plan.json'] ?? '') as { sections: { titre: string }[] }
  const deuxieme = plan.sections[1]
  if (deuxieme) deuxieme.titre = 'Préface'
  await faux.publier({ ...exemple, 'plan.json': JSON.stringify(plan, null, 2) + '\n' })
  faux.oublierRequetes()

  await page.getByRole('button', { name: 'Synchroniser' }).click()
  await expect(titres(page).nth(1)).toHaveText('Préface')
  expect(faux.blobsTelecharges).toBe(1)
})

test('un jeton révoqué ramène à la connexion sans perdre le dépôt', async ({ page }) => {
  const faux = await FauxGitHub.creer(lireExemple())
  await brancherFauxGitHub(page, faux)
  await page.goto('./')
  await seConnecter(page)
  await expect(etat(page)).toHaveText('Synchronisé')

  faux.jetonValide = 'nouveau'
  await page.getByRole('button', { name: 'Synchroniser' }).click()
  await expect(page.getByRole('alert')).toContainText('n’accepte plus votre jeton')
  await expect(page.getByLabel('Dépôt du manuscrit')).toHaveValue('autrice/katastrophe')

  await page.getByLabel('Jeton d’accès personnel').fill('nouveau')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(titres(page)).toHaveCount(10)
})

test('la déconnexion, dans les réglages, demande confirmation puis efface tout', async ({ page }) => {
  await brancherFauxGitHub(page, await FauxGitHub.creer(lireExemple()))
  await page.goto('./')
  await seConnecter(page)
  await expect(titres(page)).toHaveCount(10)

  await page.getByRole('button', { name: 'Réglages' }).click()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Se déconnecter de cet appareil' }).click()
  await expect(page.getByLabel('Dépôt du manuscrit')).toHaveValue('')
  await page.reload()
  await expect(page.getByLabel('Jeton d’accès personnel')).toBeVisible()
})
