import { expect, test, type Page } from '@playwright/test'
import { brancherFauxGitHub, etat, FauxGitHub, lireExemple, postit, seConnecter, surveillerErreurs } from './outils'

const exemple = lireExemple()

async function ouvrir(page: Page, faux?: FauxGitHub) {
  const erreurs = surveillerErreurs(page)
  const depot = faux ?? (await FauxGitHub.creer(exemple))
  const reseau = await brancherFauxGitHub(page, depot)
  await page.goto('./')
  await seConnecter(page)
  await expect(etat(page)).toHaveText('Synchronisé')
  return { faux: depot, reseau, erreurs }
}

async function ouvrirSection(page: Page, titre: string) {
  await postit(page, titre).locator('.postit-principal').click()
  await expect(page.getByLabel('Titre de la section')).toHaveValue(titre)
}

/** Tape à la fin du texte. */
async function taperALaFin(page: Page, texte: string) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(texte)
}

const editeur = (page: Page) => page.locator('.cm-content')

test('ouvrir une section depuis le plan, écrire, envoyer avec Cmd/Ctrl+S', async ({ page }) => {
  const { faux, erreurs } = await ouvrir(page)
  await ouvrirSection(page, 'Le heurt')
  await expect(page).toHaveURL(/#\/section\/k7f3qa$/)
  await expect(editeur(page)).toContainText('Quand y a-t-il heurt')
  await expect(page.locator('.compteur-mots')).toContainText('157 / 700 mots')

  await taperALaFin(page, '\n\nTrois mots de plus.')
  await expect(page.locator('.compteur-mots')).toContainText('161 / 700 mots')
  await expect(etat(page)).toHaveText('Enregistré sur l’appareil')

  await page.keyboard.press('ControlOrMeta+s')
  await expect(etat(page)).toHaveText('Synchronisé')
  expect(faux.fichiers()['sections/le-heurt.md']).toBe(`${exemple['sections/le-heurt.md'] ?? ''}\n\nTrois mots de plus.`)
  expect(faux.messages()[0]).toBe('Rédaction : Le heurt')

  await page.getByRole('button', { name: '← Plan' }).click()
  await expect(page.locator('.planches')).toBeVisible()
  // La jauge du post-it tient compte du nouveau texte.
  await expect(postit(page, 'Le heurt').locator('.jauge-chiffres')).toHaveText('161 / 700')
  expect(erreurs).toEqual([])
})

test('critère du jalon : réseau coupé, écrire, fermer, rétablir, rouvrir : intact puis envoyé', async ({ page, context }) => {
  const { faux, reseau } = await ouvrir(page)
  await ouvrirSection(page, 'Le heurt')
  reseau.couper(true)
  await taperALaFin(page, '\n\nÉcrit dans le métro.')
  await expect(etat(page)).toContainText(/Enregistré sur l’appareil|Hors ligne/)
  await page.waitForTimeout(500)
  await page.close()

  const nouvelle = await context.newPage()
  await brancherFauxGitHub(nouvelle, faux)
  await nouvelle.goto('./#/section/k7f3qa')
  // CodeMirror n'affiche que les lignes visibles : on va à la fin du texte.
  await editeur(nouvelle).click()
  await nouvelle.keyboard.press('ControlOrMeta+End')
  await expect(editeur(nouvelle)).toContainText('Écrit dans le métro.')
  await expect(etat(nouvelle)).toHaveText('Synchronisé')
  expect(faux.fichiers()['sections/le-heurt.md']).toContain('Écrit dans le métro.')
})

test('sections précédente et suivante, sans repasser par le plan', async ({ page }) => {
  await ouvrir(page)
  await ouvrirSection(page, 'Le heurt')
  await page.getByRole('button', { name: 'Section suivante' }).click()
  // L'illustration (hors-texte) est sautée.
  await expect(page.getByLabel('Titre de la section')).toHaveValue('Les serments')
  await page.getByRole('button', { name: 'Section précédente' }).click()
  await expect(page.getByLabel('Titre de la section')).toHaveValue('Le heurt')
})

test('liste des sections : colonne sur ordinateur, tiroir sur téléphone', async ({ page, isMobile }) => {
  await ouvrir(page)
  await ouvrirSection(page, 'Le heurt')
  if (isMobile) {
    await expect(page.locator('.colonne-sections')).toBeHidden()
    await page.getByRole('button', { name: 'Sections', exact: true }).click()
    await page.getByRole('dialog', { name: 'Sections' }).getByRole('button', { name: 'Lexique' }).click()
  } else {
    await page.locator('.colonne-sections').getByRole('button', { name: 'Lexique' }).click()
  }
  await expect(page.getByLabel('Titre de la section')).toHaveValue('Lexique')
})

test('recherche dans tout le manuscrit, puis ouverture à l’endroit trouvé', async ({ page }) => {
  await ouvrir(page)
  await ouvrirSection(page, 'Avant-propos')
  await page.getByRole('button', { name: 'Chercher' }).click()
  const dialogue = page.getByRole('dialog', { name: 'Chercher dans le manuscrit' })
  await dialogue.getByPlaceholder('Texte à chercher').fill('SERMENT')
  await expect(dialogue.locator('h3')).toHaveText(['Qu’est-ce que Katastrophê ?', 'Le heurt', 'Les serments', 'Lexique'])
  await dialogue.locator('section', { has: page.locator('h3', { hasText: 'Les serments' }) }).getByRole('button').first().click()
  await expect(page.getByLabel('Titre de la section')).toHaveValue('Les serments')
  await expect(page).toHaveURL(/#\/section\/h5d6yb\?d=\d+&f=\d+$/)
  const selection = await page.evaluate(() => document.getSelection()?.toString())
  expect(selection?.toLowerCase()).toBe('serment')
})

test('Cmd/Ctrl+B met en gras, Cmd/Ctrl+I en italique', async ({ page, isMobile }) => {
  test.skip(isMobile, 'raccourcis clavier : ordinateur')
  await ouvrir(page)
  await ouvrirSection(page, 'Les conséquences')
  await taperALaFin(page, 'un mot')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('ControlOrMeta+b')
  await expect(editeur(page)).toHaveText('un **mot**')
  await page.keyboard.press('ControlOrMeta+b')
  await expect(editeur(page)).toHaveText('un mot')
  await page.keyboard.press('ControlOrMeta+i')
  await expect(editeur(page)).toHaveText('un *mot*')
})

test('un titre # ou ## est signalé', async ({ page }) => {
  await ouvrir(page)
  await ouvrirSection(page, 'Les conséquences')
  await taperALaFin(page, '## Grand titre')
  await expect(page.getByText('sont réservés à la compilation')).toBeVisible()
  await expect(page.locator('.cm-titre-reserve')).toHaveCount(1)
})

test('modifier le titre renomme le fichier sur GitHub', async ({ page }) => {
  const { faux } = await ouvrir(page)
  await ouvrirSection(page, 'Le heurt')
  const titre = page.getByLabel('Titre de la section')
  await titre.fill('Le choc')
  await titre.press('Enter')
  await page.keyboard.press('ControlOrMeta+s')
  await expect(etat(page)).toHaveText('Synchronisé')
  expect(faux.fichiers()['sections/le-choc.md']).toBe(exemple['sections/le-heurt.md'])
  expect(faux.fichiers()['sections/le-heurt.md']).toBeUndefined()
})

test('conflit : rien n’est écrasé, la version locale est sauvegardée, on choisit', async ({ page }) => {
  const { faux } = await ouvrir(page)
  await ouvrirSection(page, 'Le heurt')
  await faux.publier({ ...exemple, 'sections/le-heurt.md': 'Version de l’iPad.\n' })
  await taperALaFin(page, '\n\nVersion du Mac.')
  await page.keyboard.press('ControlOrMeta+s')

  await expect(page.getByRole('alert')).toContainText('aussi été modifié sur un autre appareil')
  await expect(etat(page)).toHaveText('Conflit')
  expect(faux.fichiers()['sections/le-heurt.md']).toBe('Version de l’iPad.\n')
  const sauvegarde = Object.keys(faux.fichiers()).find((c) => c.startsWith('conflits/'))
  expect(sauvegarde).toBeDefined()

  await page.getByRole('button', { name: 'Garder la mienne' }).click()
  await expect(etat(page)).toHaveText('Synchronisé')
  expect(faux.fichiers()['sections/le-heurt.md']).toContain('Version du Mac.')
  expect(Object.keys(faux.fichiers()).some((c) => c.startsWith('conflits/'))).toBe(false)
})

test('mode concentration : ne reste que le texte', async ({ page }) => {
  await ouvrir(page)
  await ouvrirSection(page, 'Le heurt')
  await page.getByRole('button', { name: 'Concentration' }).click()
  await expect(page.locator('.barre-redaction')).toBeHidden()
  await expect(page.getByLabel('Titre de la section')).toBeHidden()
  await expect(editeur(page)).toBeVisible()
  await page.getByRole('button', { name: 'Quitter la concentration' }).click()
  await expect(page.locator('.barre-redaction')).toBeVisible()
})

test('le bouton Retour du navigateur ramène au plan', async ({ page }) => {
  await ouvrir(page)
  await ouvrirSection(page, 'Le heurt')
  await page.goBack()
  await expect(page.locator('.planches')).toBeVisible()
})
