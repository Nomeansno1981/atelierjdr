import { expect, test, type Page } from '@playwright/test'
import { lirePlan } from '../src/domaine/plan'
import { brancherFauxGitHub, etat, FauxGitHub, lireExemple, postit, seConnecter, surveillerErreurs } from './outils'

const NB = String.fromCharCode(0xa0)
const exemple = lireExemple()

async function ouvrirSection(page: Page, titre: string, fichiers: Record<string, string> = exemple) {
  const erreurs = surveillerErreurs(page)
  const faux = await FauxGitHub.creer(fichiers)
  await brancherFauxGitHub(page, faux)
  await page.goto('./')
  await seConnecter(page)
  await expect(etat(page)).toHaveText('Synchronisé')
  await postit(page, titre).locator('.postit-principal').click()
  await expect(page.getByLabel('Titre de la section')).toHaveValue(titre)
  return { faux, erreurs }
}

const editeur = (page: Page) => page.locator('.cm-content')

async function taper(page: Page, texte: string) {
  await editeur(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(texte)
}

/** Texte du document, lignes séparées par des sauts de ligne. */
function documentTexte(page: Page) {
  return page.locator('.cm-line').allTextContents().then((lignes) => lignes.join('\n'))
}

test('les cas du cahier des charges, tapés dans l’éditeur', async ({ page }) => {
  const { erreurs } = await ouvrirSection(page, 'Les conséquences')
  await taper(page, `l'acte "Oui, mais" Non! Non ! Attends... 14:30 https://exemple.fr/?q=1 ![image](a.png)`)
  await expect.poll(() => documentTexte(page)).toBe(
    `l’acte «${NB}Oui, mais${NB}» Non${NB}! Non${NB}! Attends… 14:30 https://exemple.fr/?q=1 ![image](a.png)`,
  )
  await page.keyboard.press('Enter')
  await page.keyboard.type('```')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Pourquoi ?')
  await expect.poll(() => documentTexte(page)).toContain('```\nPourquoi ?')
  expect(erreurs).toEqual([])
})

test('Cmd/Ctrl+Z juste après annule la seule substitution et rend le caractère tapé', async ({ page }) => {
  await ouvrirSection(page, 'Les conséquences')
  await taper(page, 'Non!')
  await expect.poll(() => documentTexte(page)).toBe(`Non${NB}!`)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => documentTexte(page)).toBe('Non!')
  await taper(page, " l'a")
  await expect.poll(() => documentTexte(page)).toBe('Non! l’a')
})

test('les espaces insécables peuvent être rendues visibles', async ({ page }) => {
  await ouvrirSection(page, 'Le heurt')
  await expect(page.locator('.cm-insecable')).toHaveCount(0)
  await page.getByText('Outils').click()
  await page.getByLabel('Montrer les espaces insécables').check()
  await expect(page.locator('.cm-insecable').first()).toBeVisible()
  // Préférence de l'appareil : elle survit au rechargement.
  await page.reload()
  await expect(page.locator('.cm-insecable').first()).toBeVisible()
})

test('Normaliser une section : annonce, applique, s’annule, et deux fois ne change rien', async ({ page }) => {
  const brut = `l'acte... "oui" non!`
  const { faux } = await ouvrirSection(page, 'Les conséquences', { ...exemple, 'sections/les-consequences.md': brut })
  const messages: string[] = []
  page.on('dialog', (d) => {
    messages.push(d.message())
    void d.accept()
  })

  await page.getByText('Outils').click()
  await page.getByRole('button', { name: 'Normaliser la typographie' }).click()
  await expect.poll(() => documentTexte(page)).toBe(`l’acte… «${NB}oui${NB}» non${NB}!`)
  expect(messages[0]).toContain('5 remplacements typographiques dans cette section')

  await editeur(page).click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => documentTexte(page)).toBe(brut)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => documentTexte(page)).toBe(`l’acte… «${NB}oui${NB}» non${NB}!`)

  await page.getByText('Outils').click()
  await page.getByRole('button', { name: 'Normaliser la typographie' }).click()
  await expect.poll(() => messages.length).toBe(2)
  expect(messages[1]).toContain('Rien à normaliser')

  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => faux.fichiers()['sections/les-consequences.md']).toBe(`l’acte… «${NB}oui${NB}» non${NB}!`)
  await expect(etat(page)).toHaveText('Synchronisé')
})

test('une règle désactivée dans les réglages ne s’applique plus, sur tous les appareils', async ({ page }) => {
  const erreurs = surveillerErreurs(page)
  const faux = await FauxGitHub.creer(exemple)
  await brancherFauxGitHub(page, faux)
  await page.goto('./')
  await seConnecter(page)
  await page.getByRole('button', { name: 'Réglages' }).click()
  await page.getByLabel('Apostrophe typographique').uncheck()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
  expect(lirePlan(faux.fichiers()['plan.json'] ?? '').reglages?.typographie.apostrophe).toBe(false)

  await postit(page, 'Les conséquences').locator('.postit-principal').click()
  await taper(page, "l'acte !")
  await expect.poll(() => documentTexte(page)).toBe(`l'acte${NB}!`)
  expect(erreurs).toEqual([])
})

test('Normaliser tout le manuscrit', async ({ page }) => {
  const faux = await FauxGitHub.creer({
    ...exemple,
    'sections/les-consequences.md': `Fin...`,
    'sections/lexique.md': `"Chute" : fin d'un personnage.`,
  })
  await brancherFauxGitHub(page, faux)
  await page.goto('./')
  await seConnecter(page)
  await expect(etat(page)).toHaveText('Synchronisé')
  const messages: string[] = []
  page.on('dialog', (d) => {
    messages.push(d.message())
    void d.accept()
  })
  await page.getByRole('button', { name: 'Réglages' }).click()
  await page.getByRole('button', { name: 'Normaliser tout le manuscrit…' }).click()
  await expect.poll(() => messages[0]).toContain('5 remplacements typographiques dans 2 sections')
  await page.getByRole('dialog', { name: 'Réglages du livre' }).getByRole('button', { name: 'Annuler' }).click()
  await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
  expect(faux.fichiers()['sections/les-consequences.md']).toBe('Fin…')
  expect(faux.fichiers()['sections/lexique.md']).toBe(`«${NB}Chute${NB}»${NB}: fin d’un personnage.`)
})

test('un titre validé suit la convention typographique', async ({ page }) => {
  await ouvrirSection(page, 'Le heurt')
  const titre = page.getByLabel('Titre de la section')
  await titre.fill("Le heurt, l'essentiel !")
  await titre.press('Enter')
  await expect(titre).toHaveValue(`Le heurt, l’essentiel${NB}!`)
})
