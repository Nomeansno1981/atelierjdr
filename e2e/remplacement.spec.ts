import { expect, test, type Page } from '@playwright/test'
import { lirePlan } from '../src/domaine/plan'
import { rechercherPartout, remplacerDans } from '../src/domaine/remplacement'
import { brancherFauxGitHub, etat, FauxGitHub, lireExemple, postit, seConnecter, surveillerErreurs } from './outils'

const exemple = lireExemple()
const LE_HEURT = 'k7f3qa'

async function ouvrir(page: Page) {
  const erreurs = surveillerErreurs(page)
  const faux = await FauxGitHub.creer(exemple)
  await brancherFauxGitHub(page, faux)
  await page.goto('./')
  await seConnecter(page)
  await expect(etat(page)).toHaveText('Synchronisé')
  return { faux, erreurs }
}

async function ouvrirRemplacement(page: Page) {
  await page.locator('.mode-plan .menu-outils > summary').click()
  await page.getByRole('button', { name: /Chercher et remplacer/ }).click()
  return page.getByRole('dialog', { name: 'Chercher et remplacer' })
}

test('remplacer partout, sauf une occurrence décochée, puis annuler', async ({ page }) => {
  const { faux, erreurs } = await ouvrir(page)
  const plan = lirePlan(exemple['plan.json'] ?? '')
  const textes = new Map(plan.sections.flatMap((s) => (s.type === 'texte' ? [[s.id, exemple[s.fichier] ?? '']] : [])))
  const resultats = rechercherPartout(plan, textes, 'heurt')
  const total = resultats.reduce((n, r) => n + r.occurrences.length, 0)
  const sections = new Set(resultats.map((r) => r.id)).size
  expect(total).toBeGreaterThan(3)

  const dialogue = await ouvrirRemplacement(page)
  await dialogue.getByLabel('Texte à chercher').fill('heurt')
  await dialogue.getByLabel('Remplacer par').fill('choc')
  await expect(dialogue.getByRole('status')).toContainText(`${total} résultats dans ${sections} section`)
  // L'aperçu : le titre « Le heurt » deviendra « Le choc ».
  const titre = dialogue.locator('.occurrence', { hasText: 'Titre :' }).first()
  await expect(titre.locator('del')).toHaveText('heurt')
  await expect(titre.locator('ins')).toHaveText('choc')

  // On décoche la première occurrence du texte du Heurt.
  const texteHeurt = resultats.find((r) => r.id === LE_HEURT && r.champ === 'texte')
  const premiere = texteHeurt?.occurrences[0]
  if (!texteHeurt || !premiere) throw new Error('exemple inattendu')
  await dialogue.locator('section', { has: page.getByRole('heading', { name: 'Le heurt' }) }).locator('.occurrence').filter({ hasNotText: 'Titre :' }).first().locator('input').uncheck()
  await dialogue.getByRole('button', { name: `Remplacer ${total - 1} occurrences` }).click()

  await expect(page.locator('.bandeau-flottant')).toContainText(`${total - 1} remplacements dans ${sections} sections.`)
  await expect(postit(page, 'Le choc')).toBeVisible()
  await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
  const attendu = remplacerDans(textes.get(LE_HEURT) ?? '', texteHeurt.occurrences.slice(1), 'choc')
  expect(faux.fichiers()['sections/le-choc.md']).toBe(attendu)
  expect(faux.fichiers()['sections/le-heurt.md']).toBeUndefined()
  expect(attendu.slice(premiere.debut, premiere.fin)).toBe(premiere.trouve)

  // Annuler : tout revient, titre et fichier compris.
  await page.locator('.bandeau-flottant').getByRole('button', { name: 'Annuler' }).click()
  await expect(postit(page, 'Le heurt')).toBeVisible()
  await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
  expect(faux.fichiers()['sections/le-heurt.md']).toBe(exemple['sections/le-heurt.md'])
  expect(erreurs).toEqual([])
})

test('sans texte de remplacement, on cherche ; un résultat ouvre la section', async ({ page }) => {
  await ouvrir(page)
  const dialogue = await ouvrirRemplacement(page)
  await dialogue.getByLabel('Texte à chercher').fill('serment')
  await expect(dialogue.getByRole('button', { name: /Remplacer/ })).toHaveCount(0)
  await dialogue.locator('.resultats button').filter({ hasNotText: 'Titre :' }).first().click()
  await expect(page.getByLabel('Titre de la section')).toBeVisible()
})
