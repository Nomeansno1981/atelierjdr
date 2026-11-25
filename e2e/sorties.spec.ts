import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Download, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { compiler } from '../src/domaine/compilation'
import { lirePlan, type Plan } from '../src/domaine/plan'
import { brancherFauxGitHub, etat, FauxGitHub, lireExemple, postit, seConnecter, surveillerErreurs } from './outils'

const exemple = lireExemple()
const NB = String.fromCharCode(0xa0)
const TIRET = String.fromCharCode(0x2014)
const SCRIPT = readFileSync(join(import.meta.dirname, '..', 'outils', 'compiler.py'), 'utf8')

async function ouvrir(page: Page, fichiers: Record<string, string> = exemple) {
  const erreurs = surveillerErreurs(page)
  const faux = await FauxGitHub.creer(fichiers)
  const reseau = await brancherFauxGitHub(page, faux)
  await page.goto('./')
  await seConnecter(page)
  await expect(etat(page)).toHaveText('Synchronisé')
  return { faux, reseau, erreurs }
}

async function outil(page: Page, nom: string | RegExp) {
  await page.locator('.mode-plan .menu-outils > summary').click()
  await page.getByRole('button', { name: nom }).click()
}

async function contenu(download: Download): Promise<Buffer> {
  const chemin = await download.path()
  return readFileSync(chemin)
}

function textesDe(plan: Plan, fichiers: Record<string, string>): Map<string, string> {
  const textes = new Map<string, string>()
  for (const s of plan.sections) if (s.type === 'texte') textes.set(s.id, fichiers[s.fichier] ?? '')
  return textes
}

test('lecture continue : titres comme à la compilation, hors-texte, repères, ouverture dans l’éditeur', async ({ page }) => {
  const { erreurs } = await ouvrir(page)
  await outil(page, 'Lecture continue')
  await expect(page).toHaveURL(/#\/lecture$/)
  const lecture = page.locator('main.lecture')
  await expect(lecture.locator('h1.lecture-partie')).toHaveText([
    `Partie I ${TIRET} Présentation`,
    `Partie II ${TIRET} Les règles`,
    'Lexique',
  ])
  await expect(lecture.locator('.encadre-hors-texte').nth(1)).toContainText(`Illustration${NB}: la chute, p. 9`)
  const heurt = lecture.locator('article', { has: page.getByRole('button', { name: 'Le heurt' }) })
  await expect(heurt.locator('.repere')).toHaveText('p. 7-8 · 157 / 700 mots')
  await expect(heurt.locator('h3').first()).toHaveText(`Quand y a-t-il heurt${NB}?`)
  await expect(heurt.locator('strong').first()).toHaveText('Céder')

  // Filtre : la section « à écrire » vide disparaît.
  await expect(lecture.getByRole('button', { name: 'Les conséquences' })).toBeVisible()
  await page.getByLabel('Masquer les sections « à écrire » vides').check()
  await expect(lecture.getByRole('button', { name: 'Les conséquences' })).toHaveCount(0)

  await heurt.getByRole('button', { name: 'Le heurt' }).click()
  await expect(page.getByLabel('Titre de la section')).toHaveValue('Le heurt')
  expect(erreurs).toEqual([])
})

test('lecture continue : la table des matières mène à la section', async ({ page, isMobile }) => {
  await ouvrir(page)
  await outil(page, 'Lecture continue')
  if (isMobile) {
    await page.getByRole('button', { name: 'Sommaire' }).click()
    await page.getByRole('dialog', { name: 'Sommaire' }).getByRole('button', { name: 'Lexique' }).last().click()
  } else {
    await page.locator('.colonne-sections').getByRole('button', { name: 'Lexique' }).last().click()
  }
  await expect(page.locator('#lecture-l7k3pw')).toBeInViewport()
})

test('le rendu est nettoyé : ni script, ni gestionnaire d’événement, ni lien javascript:', async ({ page }) => {
  const piege = [
    'Texte <script>window.__piege = 1</script> normal.',
    '',
    '<img src="x" onerror="window.__piege = 2">',
    '',
    '<p onclick="window.__piege = 3" style="color: red">Paragraphe</p>',
    '',
    '[lien](javascript:window.__piege=4)',
  ].join('\n')
  const { erreurs } = await ouvrir(page, { ...exemple, 'sections/les-consequences.md': piege })
  await outil(page, 'Lecture continue')
  const section = page.locator('#lecture-m6u4og')
  await expect(section).toContainText('Paragraphe')
  await expect(section.locator('script, img, [onclick], [onerror], [style]')).toHaveCount(0)
  // markdown-it refuse les adresses javascript: : aucun lien n'est créé.
  await expect(section.locator('a[href^="javascript"]')).toHaveCount(0)
  await section.getByText('Paragraphe').click()
  expect(await page.evaluate(() => (window as unknown as { __piege?: number }).__piege)).toBeUndefined()
  // Chromium signale les gestionnaires et styles en ligne dès l'analyse du HTML
  // piégé, même dans le document inerte où DOMPurify fait son tri (selon sa
  // version) : la politique de sécurité les bloque en seconde barrière. Le DOM
  // affiché n'en contient aucun (vérifié plus haut). Rien d'autre ne doit apparaître.
  expect(erreurs.filter((e) => !e.includes('inline event handler') && !e.includes('Applying inline style'))).toEqual([])
})

test('compiler et télécharger : le fichier attendu, au nom du modèle', async ({ page }) => {
  await ouvrir(page)
  await outil(page, 'Compiler…')
  const dialogue = page.getByRole('dialog', { name: 'Compiler le manuscrit' })
  await expect(dialogue.getByLabel('Version')).toHaveValue('1')
  await dialogue.getByLabel('Repères de pages').check()
  const [telechargement] = await Promise.all([
    page.waitForEvent('download'),
    dialogue.getByRole('button', { name: 'Compiler' }).click(),
  ])
  expect(telechargement.suggestedFilename()).toBe('Katastrophe__v1.md')
  const plan = lirePlan(exemple['plan.json'] ?? '')
  const attendu = compiler(plan, textesDe(plan, exemple), { sectionsVides: 'incluses', reperesPages: true })
  expect((await contenu(telechargement)).equals(Buffer.from(attendu, 'utf8'))).toBe(true)
  // La version suivante est proposée la fois d'après.
  await dialogue.getByRole('button', { name: 'Fermer' }).last().click()
  await outil(page, 'Compiler…')
  await expect(page.getByRole('dialog', { name: 'Compiler le manuscrit' }).getByLabel('Version')).toHaveValue('2')
})

test('compiler dans le dépôt : compilations/ et le script de la même version', async ({ page }) => {
  const { faux } = await ouvrir(page, { ...exemple, 'compilations/Katastrophe__v26.md': 'ancienne\n' })
  await outil(page, 'Compiler…')
  const dialogue = page.getByRole('dialog', { name: 'Compiler le manuscrit' })
  await expect(dialogue.getByLabel('Version')).toHaveValue('27')
  await dialogue.getByLabel('Exclues').check()
  await dialogue.getByLabel('Enregistrer dans le dépôt').check()
  await dialogue.getByRole('button', { name: 'Compiler' }).click()
  await expect(dialogue.getByRole('status')).toContainText('Katastrophe__v27.md est enregistré')

  const plan = lirePlan(exemple['plan.json'] ?? '')
  const fichiers = faux.fichiers()
  expect(fichiers['compilations/Katastrophe__v27.md']).toBe(
    compiler(plan, textesDe(plan, exemple), { sectionsVides: 'exclues', reperesPages: false }),
  )
  expect(fichiers['outils/compiler.py']).toBe(SCRIPT)
  expect(faux.messages()[0]).toBe('Compilation : Katastrophe__v27.md')
})

test('le modèle de nom se règle dans les réglages', async ({ page }) => {
  const { faux } = await ouvrir(page)
  await page.getByRole('button', { name: 'Réglages' }).click()
  await page.getByLabel('Nom des compilations').fill('Manuel_{n}.md')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
  expect(lirePlan(faux.fichiers()['plan.json'] ?? '').reglages?.compilation?.modele).toBe('Manuel_{n}.md')
  await outil(page, 'Compiler…')
  await expect(page.getByRole('dialog', { name: 'Compiler le manuscrit' })).toContainText('Manuel_1.md')
})

test('exporter le manuscrit en .zip, même sans GitHub, modifications en attente comprises', async ({ page }) => {
  const { reseau } = await ouvrir(page)
  reseau.couper(true)
  await postit(page, 'Les conséquences').locator('.postit-principal').click()
  await page.locator('.cm-content').click()
  await page.keyboard.type('Écrit hors ligne.')
  await page.getByRole('button', { name: '← Plan' }).click()

  const [telechargement] = await Promise.all([page.waitForEvent('download'), outil(page, 'Exporter le manuscrit (.zip)')])
  expect(telechargement.suggestedFilename()).toMatch(/^katastrophe-\d{4}-\d{2}-\d{2}\.zip$/)
  const archive = unzipSync(new Uint8Array(await contenu(telechargement)))
  const noms = Object.keys(archive).sort()
  expect(noms).toEqual(
    ['outils/compiler.py', 'plan.json', ...Object.keys(exemple).filter((c) => c.startsWith('sections/'))].sort(),
  )
  expect(strFromU8(archive['plan.json'] ?? new Uint8Array())).toBe(exemple['plan.json'])
  expect(strFromU8(archive['sections/le-heurt.md'] ?? new Uint8Array())).toBe(exemple['sections/le-heurt.md'])
  expect(strFromU8(archive['sections/les-consequences.md'] ?? new Uint8Array())).toBe('Écrit hors ligne.')
  expect(strFromU8(archive['outils/compiler.py'] ?? new Uint8Array())).toBe(SCRIPT)
})
