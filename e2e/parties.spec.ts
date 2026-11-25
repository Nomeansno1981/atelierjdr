import { expect, test, type Page } from '@playwright/test'
import { lirePlan, serialiserPlan } from '../src/domaine/plan'
import {
  brancherFauxGitHub,
  etat,
  FauxGitHub,
  glisserDoigt,
  glisserSouris,
  lireExemple,
  postit,
  seConnecter,
  surveillerErreurs,
  titres,
  TITRES,
} from './outils'

const exemple = lireExemple()

async function ouvrir(page: Page, fichiers: Record<string, string> = exemple) {
  const erreurs = surveillerErreurs(page)
  const faux = await FauxGitHub.creer(fichiers)
  await brancherFauxGitHub(page, faux)
  await page.goto('./')
  await seConnecter(page)
  await expect(etat(page)).toHaveText('Synchronisé')
  return { faux, erreurs }
}

const bandeau = (page: Page, titre: string) => page.locator('.separateur').filter({ hasText: titre })
const separateurs = (page: Page) => page.locator('.separateur')

test('glisser le bandeau d’une partie la déplace entière, et la numérotation suit', async ({ page, isMobile }) => {
  const { faux, erreurs } = await ouvrir(page)
  const source = bandeau(page, 'Les règles')
  const cible = page.locator('.page[data-page="1"]')
  if (isMobile) await glisserDoigt(page, source, cible)
  else await glisserSouris(page, source, cible)

  await expect(separateurs(page)).toHaveText(['I. Les règles', 'II. Présentation', 'Lexique'])
  await expect(titres(page)).toHaveText([...TITRES.slice(3, 9), ...TITRES.slice(0, 3), 'Lexique'])
  await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
  expect(faux.messages()[0]).toBe('Plan : déplacement de la partie Les règles')
  expect(lirePlan(faux.fichiers()['plan.json'] ?? '').parties.map((p) => p.id)).toEqual(['regles', 'presentation', 'lexique'])
  expect(erreurs).toEqual([])
})

test('pendant le glissement d’une partie, rien ne bouge et la silhouette annonce l’arrivée', async ({ page, isMobile }) => {
  test.skip(isMobile, 'souris : ordinateur')
  await ouvrir(page)
  const a = await bandeau(page, 'Les règles').boundingBox()
  const b = await page.locator('.page[data-page="1"]').boundingBox()
  if (!a || !b) throw new Error('invisible')
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 })
  await page.mouse.move(b.x + 10, b.y + b.height / 2, { steps: 12 })
  await page.waitForTimeout(150)
  await page.mouse.move(b.x + 12, b.y + b.height / 2, { steps: 2 })
  await expect(page.locator('.fantome-destination')).toHaveText('avant « Présentation »')
  await expect(page.locator('.postit[data-insertion="avant"] .postit-titre')).toHaveText('Page de titre')
  // Les six sections des règles sont estompées à leur place.
  await expect(page.locator('.postit-source:not(.postit-suite)')).toHaveCount(6)
  await expect(titres(page)).toHaveText(TITRES)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(separateurs(page)).toHaveText(['I. Présentation', 'II. Les règles', 'Lexique'])
})

test('« Nouvelle partie ici » coupe la partie : la suite passe dans la nouvelle', async ({ page }) => {
  const { faux } = await ouvrir(page)
  await page.getByRole('button', { name: 'Nouvelle section avant Les serments' }).click()
  const dialogue = page.getByRole('dialog', { name: 'Nouvelle section' })
  await dialogue.getByRole('radio', { name: /^Partie/ }).check()
  await page.getByRole('dialog', { name: 'Nouvelle partie' }).getByLabel('Titre de la partie').fill('Le combat')
  await page.getByRole('dialog', { name: 'Nouvelle partie' }).getByRole('button', { name: 'Créer' }).click()

  await expect(separateurs(page)).toHaveText(['I. Présentation', 'II. Les règles', 'III. Le combat', 'Lexique'])
  await expect(postit(page, 'Les serments').locator('.postit-partie')).toHaveText('III. Le combat')
  await expect(postit(page, 'Le heurt').locator('.postit-partie')).toHaveText('II. Les règles')
  await expect(titres(page)).toHaveText(TITRES)
  await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
  expect(faux.messages()[0]).toBe('Plan : création de la partie Le combat')
})

test('une partie vide s’affiche, reçoit une section par son « + », et se supprime', async ({ page }) => {
  await ouvrir(page)
  await page.getByRole('button', { name: 'Nouvelle section', exact: true }).click()
  await page.getByRole('dialog', { name: 'Nouvelle section' }).getByRole('radio', { name: /^Partie/ }).check()
  const nouvelle = page.getByRole('dialog', { name: 'Nouvelle partie' })
  await nouvelle.getByLabel('Titre de la partie').fill('Annexes')
  await nouvelle.getByRole('button', { name: 'Créer' }).click()
  await expect(page.locator('.separateur-vide')).toHaveText(['III. Annexes · vide'])

  // Supprimable tant qu'elle est vide.
  await page.getByRole('button', { name: 'Partie III. Annexes, vide' }).click()
  await expect(page.getByRole('dialog', { name: 'Partie III' }).getByRole('button', { name: 'Supprimer' })).toBeEnabled()
  await page.getByRole('dialog', { name: 'Partie III' }).getByRole('button', { name: 'Annuler' }).click()

  await page.getByRole('button', { name: 'Nouvelle section dans Annexes' }).click()
  const creation = page.getByRole('dialog', { name: 'Nouvelle section' })
  await expect(creation).toContainText('Dans la partie « Annexes ».')
  await creation.getByRole('textbox', { name: 'Titre' }).fill('Fiche de personnage')
  await creation.getByRole('button', { name: 'Créer' }).click()
  await expect(page.locator('.separateur-vide')).toHaveCount(0)
  await expect(separateurs(page)).toHaveText(['I. Présentation', 'II. Les règles', 'Lexique', 'III. Annexes'])
  await expect(titres(page).last()).toHaveText('Fiche de personnage')
})

test('le panneau d’une partie : renommer, numéroter, déplacer, fusionner', async ({ page }) => {
  const { faux } = await ouvrir(page)
  await page.getByRole('button', { name: 'Partie Lexique' }).click()
  let panneau = page.getByRole('dialog', { name: 'Partie' })
  await panneau.getByLabel('Titre de la partie').fill('Glossaire')
  await panneau.getByLabel('Numérotée (Partie I, II…)').check()
  await panneau.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(separateurs(page)).toHaveText(['I. Présentation', 'II. Les règles', 'III. Glossaire'])

  await page.getByRole('button', { name: 'Partie III. Glossaire' }).click()
  await page.getByRole('dialog', { name: 'Partie III' }).getByRole('button', { name: 'Placer avant « Les règles »' }).click()
  await expect(separateurs(page)).toHaveText(['I. Présentation', 'II. Glossaire', 'III. Les règles'])
  await expect(titres(page)).toHaveText([...TITRES.slice(0, 3), 'Lexique', ...TITRES.slice(3, 9)])

  await page.getByRole('button', { name: 'Partie II. Glossaire' }).click()
  panneau = page.getByRole('dialog', { name: 'Partie II' })
  await expect(panneau.getByRole('button', { name: 'Supprimer' })).toHaveCount(0)
  await panneau.getByRole('button', { name: 'Fusionner avec « Présentation »' }).click()
  await expect(separateurs(page)).toHaveText(['I. Présentation', 'II. Les règles'])
  await expect(postit(page, 'Lexique').locator('.postit-partie')).toHaveText('I. Présentation')
  await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
  expect(faux.messages()[0]).toBe(
    'Plan : modification de la partie Glossaire, déplacement de la partie Glossaire, fusion de la partie Glossaire dans Présentation',
  )
})

test('à la frontière, le côté de la ligne rouge dit la partie d’arrivée', async ({ page, isMobile }) => {
  test.skip(isMobile, 'souris : ordinateur')
  await ouvrir(page)
  // Première section des règles, posée sur la fin de la dernière de la Présentation : elle ne bouge pas,
  // mais change de partie.
  const cible = postit(page, 'Qu’est-ce que Katastrophê ?')
  await glisserSouris(page, postit(page, 'Créer son personnage'), page.locator('.page[data-page="4"]'), { x: 0.8, y: 0.5 })
  await expect(cible).toBeVisible()
  await expect(postit(page, 'Créer son personnage').locator('.postit-partie')).toHaveText('I. Présentation')
  await expect(titres(page)).toHaveText(TITRES)
})

test('poser un post-it sur le bandeau d’une partie le met en tête de cette partie', async ({ page, isMobile }) => {
  test.skip(isMobile, 'souris : ordinateur')
  await ouvrir(page)
  await glisserSouris(page, postit(page, 'Avant-propos'), bandeau(page, 'Les règles'), { x: 0.3, y: 0.5 })
  await expect(postit(page, 'Avant-propos').locator('.postit-partie')).toHaveText('II. Les règles')
  await expect(titres(page)).toHaveText([TITRES[0], TITRES[2], TITRES[1], ...TITRES.slice(3)].map(String))
})

test('un plan aux parties mélangées : bandeau d’avertissement, puis « Regrouper »', async ({ page }) => {
  const plan = lirePlan(exemple['plan.json'] ?? '')
  // « Page de titre » (Présentation) envoyée en fin de grille.
  const melange = { ...plan, sections: [...plan.sections.slice(1), ...plan.sections.slice(0, 1)] }
  const { faux } = await ouvrir(page, { ...exemple, 'plan.json': serialiserPlan(melange) })
  const avertissement = page.locator('.bandeau-regroupement')
  await expect(avertissement).toContainText('1 section change de place : Page de titre.')
  // Tant que ce n'est pas regroupé, les parties ne se glissent pas.
  await page.getByRole('button', { name: 'Partie Lexique' }).click()
  await expect(page.getByRole('dialog', { name: 'Partie' }).getByRole('button', { name: /Placer avant/ })).toBeDisabled()
  await page.getByRole('dialog', { name: 'Partie' }).getByRole('button', { name: 'Annuler' }).click()

  await avertissement.getByRole('button', { name: 'Regrouper' }).click()
  await expect(avertissement).toHaveCount(0)
  await expect(separateurs(page)).toHaveText(['I. Présentation', 'II. Les règles', 'Lexique'])
  await expect(titres(page)).toHaveText([TITRES[1], TITRES[2], TITRES[0], ...TITRES.slice(3)].map(String))
  await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
  expect(faux.messages()[0]).toBe('Plan : regroupement des parties')
})

test('les réglages ne listent plus les parties', async ({ page }) => {
  await ouvrir(page)
  await page.getByRole('button', { name: 'Réglages', exact: true }).click()
  const reglages = page.getByRole('dialog', { name: 'Réglages du livre' })
  await expect(reglages).toContainText('Les parties se créent, se renomment et se déplacent directement dans la grille')
  await expect(reglages.getByRole('button', { name: 'Ajouter une partie' })).toHaveCount(0)
})
