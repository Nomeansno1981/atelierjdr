import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import { lirePlan } from '../src/domaine/plan'
import { brancherFauxGitHub, etat, FauxGitHub, lireExemple, postit, seConnecter, surveillerErreurs } from './outils'

const exemple = lireExemple()

/** Un second appareil : un autre navigateur, avec son propre stockage. */
async function autreAppareil(browser: Browser, infos: TestInfo): Promise<Page> {
  const u = infos.project.use
  const contexte = await browser.newContext({
    baseURL: u.baseURL,
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    locale: u.locale,
  })
  return contexte.newPage()
}

async function connecter(page: Page, faux: FauxGitHub) {
  const reseau = await brancherFauxGitHub(page, faux)
  await page.goto('./')
  await seConnecter(page)
  await expect(etat(page)).toHaveText('Synchronisé')
  return reseau
}

async function ecrireALaFin(page: Page, texte: string) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(texte)
}

test('critère du jalon : même section modifiée hors ligne sur deux appareils, aucune perte, conflit affiché', async ({ page, browser }, infos) => {
  const faux = await FauxGitHub.creer(exemple)
  const b = await autreAppareil(browser, infos)
  const erreurs = [...surveillerErreurs(page)]
  const reseauA = await connecter(page, faux)
  const reseauB = await connecter(b, faux)
  for (const p of [page, b]) await postit(p, 'Le heurt').locator('.postit-principal').click()

  reseauA.couper(true)
  reseauB.couper(true)
  await ecrireALaFin(page, '\n\nParagraphe écrit sur le Mac.')
  await ecrireALaFin(b, '\n\nParagraphe écrit sur l’iPhone.')

  reseauA.couper(false)
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => faux.fichiers()['sections/le-heurt.md']).toContain('Paragraphe écrit sur le Mac.')

  reseauB.couper(false)
  await b.keyboard.press('ControlOrMeta+s')
  // Conflit affiché ; rien n'est écrasé ; la version de l'iPhone est sauvegardée.
  await expect(b.getByRole('alert')).toContainText('aussi été modifié sur un autre appareil')
  await expect(etat(b)).toHaveText('Conflit')
  const fichiers = faux.fichiers()
  expect(fichiers['sections/le-heurt.md']).toContain('Paragraphe écrit sur le Mac.')
  const sauvegarde = Object.entries(fichiers).find(([c]) => c.startsWith('conflits/'))
  expect(sauvegarde?.[1]).toContain('Paragraphe écrit sur l’iPhone.')

  // Comparer, fusionner à la main, garder le texte fusionné.
  await b.getByRole('button', { name: 'Comparer les deux versions' }).click()
  const comparaison = b.getByRole('dialog', { name: /Comparer les deux versions/ })
  await expect(comparaison).toBeVisible()
  const modifiable = infos.project.name === 'telephone' ? comparaison.locator('.cm-content') : comparaison.locator('.cm-merge-b .cm-content')
  await modifiable.click()
  await b.keyboard.press('ControlOrMeta+End')
  await b.keyboard.type('\n\nParagraphe écrit sur le Mac.')
  await comparaison.getByRole('button', { name: 'Garder le texte fusionné' }).click()

  await expect(etat(b)).toHaveText('Synchronisé')
  const final = faux.fichiers()['sections/le-heurt.md'] ?? ''
  expect(final).toContain('Paragraphe écrit sur le Mac.')
  expect(final).toContain('Paragraphe écrit sur l’iPhone.')
  expect(Object.keys(faux.fichiers()).some((c) => c.startsWith('conflits/'))).toBe(false)

  // L'autre appareil reçoit le texte fusionné.
  await page.getByRole('button', { name: '← Plan' }).click()
  await page.getByRole('button', { name: 'Synchroniser' }).click()
  await expect(etat(page)).toHaveText('Synchronisé')
  await postit(page, 'Le heurt').locator('.postit-principal').click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await expect(page.locator('.cm-content')).toContainText('Paragraphe écrit sur l’iPhone.')
  expect(erreurs).toEqual([])
  await b.context().close()
})

test('plan modifié hors ligne sur deux appareils : fusionné, rien de perdu', async ({ page, browser }, infos) => {
  const faux = await FauxGitHub.creer(exemple)
  const b = await autreAppareil(browser, infos)
  const reseauA = await connecter(page, faux)
  const reseauB = await connecter(b, faux)
  reseauA.couper(true)
  reseauB.couper(true)
  await page.getByRole('button', { name: 'Une page de plus pour Le heurt' }).click()
  await b.getByRole('button', { name: 'Modifier Lexique' }).click()
  await b.getByRole('dialog').getByLabel('Statut', { exact: true }).selectOption('definitif')
  await b.getByRole('button', { name: 'Enregistrer' }).click()

  reseauA.couper(false)
  await page.getByRole('button', { name: 'Synchroniser' }).click()
  await expect(etat(page)).toHaveText('Synchronisé')
  reseauB.couper(false)
  await b.getByRole('button', { name: 'Synchroniser' }).click()
  await expect(b.locator('.bandeau-fusion')).toContainText('Aucune modification n’a été perdue')

  const plan = lirePlan(faux.fichiers()['plan.json'] ?? '')
  expect(plan.sections.find((s) => s.id === 'k7f3qa')?.pages).toBe(3)
  expect(plan.sections.find((s) => s.id === 'l7k3pw')?.statut).toBe('definitif')
  await expect(postit(b, 'Le heurt').locator('.postit-pages')).toContainText('3 p.')
  await b.context().close()
})

test('politique de sécurité : stricte, et aucune requête hors du site et de l’API GitHub', async ({ page }) => {
  const origines = new Set<string>()
  page.on('request', (r) => origines.add(new URL(r.url()).origin))
  const erreurs = surveillerErreurs(page)
  const faux = await FauxGitHub.creer(exemple)
  await connecter(page, faux)

  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  const directives = Object.fromEntries((csp ?? '').split(';').map((d) => {
    const [nom = '', ...valeurs] = d.trim().split(/\s+/)
    return [nom, valeurs.join(' ')]
  }))
  expect(directives['default-src']).toBe("'none'")
  expect(directives['script-src']).toBe("'self'")
  expect(directives['connect-src']).toBe('https://api.github.com')
  expect(directives['img-src']).toBe("'self'")
  expect(directives['style-src']).toMatch(/^'self' 'nonce-[A-Za-z0-9+/=]+'$/)
  expect(directives['base-uri']).toBe("'none'")
  expect(directives['form-action']).toBe("'none'")

  // Un tour complet : plan, éditeur, lecture.
  await postit(page, 'Le heurt').locator('.postit-principal').click()
  await expect(page.locator('.cm-content')).toBeVisible()
  await page.goto('./#/lecture')
  await expect(page.locator('main.lecture')).toBeVisible()
  expect([...origines].sort()).toEqual(['http://localhost:4173', 'https://api.github.com'])
  expect(erreurs).toEqual([])
})

test('installable sur l’écran d’accueil : manifeste et icônes', async ({ page, request }) => {
  await page.goto('./')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', './manifest.webmanifest')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', './icone-180.png')
  const manifeste = (await (await request.get('./manifest.webmanifest')).json()) as {
    display: string
    lang: string
    start_url: string
    icons: { src: string; sizes: string; purpose?: string }[]
  }
  expect(manifeste).toMatchObject({ display: 'standalone', lang: 'fr', start_url: './' })
  for (const icone of [...manifeste.icons.map((i) => i.src), 'icone-180.png']) {
    const reponse = await request.get(`./${icone}`)
    expect(reponse.ok()).toBe(true)
    expect(reponse.headers()['content-type']).toContain('image/png')
  }
  expect(manifeste.icons.some((i) => i.purpose === 'maskable')).toBe(true)
})

test('comparaison : reprendre un passage de GitHub, puis garder le texte fusionné', async ({ page }, infos) => {
  const phrase = 'Elle ne se joue pas aux dés.'
  const deGitHub = 'Elle ne se joue jamais aux dés.'
  const faux = await FauxGitHub.creer(exemple)
  await connecter(page, faux)
  await postit(page, 'La chute').locator('.postit-principal').click()
  await faux.publier({ ...exemple, 'sections/la-chute.md': (exemple['sections/la-chute.md'] ?? '').replace(phrase, deGitHub) })
  await ecrireALaFin(page, '\n\nAjout de cet appareil.')
  await page.keyboard.press('ControlOrMeta+s')
  await page.getByRole('button', { name: 'Comparer les deux versions' }).click()
  const comparaison = page.getByRole('dialog', { name: /Comparer les deux versions/ })

  if (infos.project.name === 'telephone') {
    // Une colonne : « Prendre GitHub » sur la phrase modifiée des deux côtés.
    await comparaison.getByRole('button', { name: 'Prendre GitHub' }).first().click()
  } else {
    // Côte à côte : la flèche reprend le passage de gauche.
    await comparaison.getByRole('button', { name: 'Reprendre ce passage de GitHub' }).first().click()
  }
  await comparaison.getByRole('button', { name: 'Garder le texte fusionné' }).click()
  await expect(etat(page)).toHaveText('Synchronisé')
  const final = faux.fichiers()['sections/la-chute.md'] ?? ''
  expect(final).toContain(deGitHub)
  expect(final).not.toContain(phrase)
  expect(final).toContain('Ajout de cet appareil.')
})
