import { expect, test, type Page } from '@playwright/test'
import { lirePlan } from '../src/domaine/plan'
import { brancherFauxGitHub, etat, FauxGitHub, lireExemple, postit, seConnecter, surveillerErreurs, titres } from './outils'

async function ouvrir(page: Page) {
  const erreurs = surveillerErreurs(page)
  const faux = await FauxGitHub.creer(lireExemple())
  await brancherFauxGitHub(page, faux)
  await page.goto('./')
  await seConnecter(page)
  await expect(etat(page)).toHaveText('Synchronisé')
  return { faux, erreurs }
}

test('une section déplacée chez une autre partie en prend la partie : pas de I, II, I, II', async ({ page, isMobile }) => {
  test.skip(isMobile, 'clavier : ordinateur')
  const { faux, erreurs } = await ouvrir(page)
  // Avant-propos (Présentation) entre « Créer son personnage » et « Le heurt » (Les règles).
  await postit(page, 'Avant-propos').locator('.postit-principal').focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(titres(page).nth(3)).toHaveText('Avant-propos')
  await expect(page.locator('.separateur')).toHaveText(['I. Présentation', 'II. Les règles', 'Lexique'])
  await expect(postit(page, 'Avant-propos').locator('.postit-partie')).toHaveText('II. Les règles')

  await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
  const plan = lirePlan(faux.fichiers()['plan.json'] ?? '')
  expect(plan.sections.find((s) => s.id === 'v4n8hs')?.partie).toBe('regles')
  expect(faux.messages()[0]).toBe('Plan : déplacement de Avant-propos dans la partie Les règles')
  expect(erreurs).toEqual([])
})

test('poser une page blanche à la main', async ({ page }) => {
  const { faux, erreurs } = await ouvrir(page)
  await page.getByRole('button', { name: 'Nouvelle section entre Page de titre et Avant-propos' }).click()
  const dialogue = page.getByRole('dialog', { name: 'Nouvelle section' })
  await dialogue.getByLabel('Page blanche').check()
  await dialogue.getByRole('button', { name: 'Créer', exact: true }).click()

  const blanche = page.locator('.postit-blanche')
  await expect(blanche).toHaveCount(1)
  await expect(blanche.locator('.postit-titre')).toHaveText('Page blanche')
  await expect(page.locator('.page[data-page="2"]').locator('..').locator('.postit-blanche')).toHaveCount(1)
  // Tout se décale d'une page, blanches automatiques comprises : 21 pages au lieu de 19.
  await expect(page.locator('.barre-etat')).toContainText('Pages 21')
  // Les statuts ne comptent pas la page blanche : toujours 10 sections réparties.
  await expect(page.locator('.compte-statut')).toHaveText(['À écrire : 2', 'Premier jet : 4', 'Relu : 3', 'Définitif : 1'])

  await page.getByRole('button', { name: 'Modifier Page blanche' }).click()
  await expect(page.getByRole('dialog', { name: 'Page blanche' }).getByLabel('Statut', { exact: true })).toHaveCount(0)
  await page.getByRole('dialog', { name: 'Page blanche' }).getByRole('button', { name: 'Annuler' }).click()

  await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
  const plan = lirePlan(faux.fichiers()['plan.json'] ?? '')
  expect(plan.sections[1]).toMatchObject({ type: 'blanche', titre: 'Page blanche', pages: 1 })
  expect(erreurs).toEqual([])
})

test('sélecteur de vue : Compact, Normal, Détaillé, Lecture sur ordinateur ; Plan et Lecture ailleurs', async ({ page, isMobile }) => {
  await ouvrir(page)
  const vue = page.getByRole('group', { name: 'Vue' })
  if (isMobile) {
    await expect(vue.getByRole('button', { name: 'Compact' })).toBeHidden()
    await expect(vue.getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-pressed', 'true')
  } else {
    await expect(vue.getByRole('button', { name: 'Plan' })).toBeHidden()
    await expect(vue.getByRole('button')).toHaveText(['Compact', 'Normal', 'Détaillé', 'Lecture'])
  }
  await vue.getByRole('button', { name: 'Lecture', exact: true }).click()
  await expect(page).toHaveURL(/#\/lecture$/)
  const vueLecture = page.getByRole('group', { name: 'Vue' })
  await expect(vueLecture.getByRole('button', { name: 'Lecture', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // Rien ne déborde horizontalement, même sur téléphone.
  const debordement = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(debordement).toBeLessThanOrEqual(0)
  // Plus d'entrée de lecture dans le menu Outils.
  await vueLecture.getByRole('button', { name: isMobile ? 'Plan' : 'Détaillé' }).click()
  await expect(page.locator('.planches')).toBeVisible()
  if (!isMobile) await expect(page.getByRole('button', { name: 'Détaillé' })).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.mode-plan .menu-outils > summary').click()
  await expect(page.locator('.menu-contenu').getByRole('button', { name: 'Lecture', exact: true })).toHaveCount(0)
})
