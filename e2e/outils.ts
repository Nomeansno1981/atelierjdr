import type { Locator, Page } from '@playwright/test'
import { lireExemple } from '../src/test/exemple'
import { FauxGitHub } from '../src/test/fauxGitHub'

export { FauxGitHub, lireExemple }

/** Titres du manuscrit d'exemple, dans l'ordre du plan. */
export const TITRES = [
  'Page de titre',
  'Avant-propos',
  'Qu’est-ce que Katastrophê ?',
  'Créer son personnage',
  'Le heurt',
  'Illustration : la chute',
  'Les serments',
  'La chute',
  'Les conséquences',
  'Lexique',
]


const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Accept, X-GitHub-Api-Version, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE',
}

/**
 * Branche la page sur un faux GitHub. `couper` simule une panne de GitHub : les
 * requêtes vers api.github.com échouent comme sans réseau.
 */
export async function brancherFauxGitHub(page: Page, faux: FauxGitHub): Promise<{ couper: (oui: boolean) => void }> {
  let coupe = false
  await page.route('https://api.github.com/**', async (route) => {
    const requete = route.request()
    if (coupe) return route.abort('internetdisconnected')
    if (requete.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const corps: unknown = requete.postData() ? requete.postDataJSON() : null
    const r = await faux.repondre(requete.method(), requete.url(), await requete.headerValue('authorization'), corps)
    return route.fulfill({
      status: r.statut,
      headers: { ...CORS, 'Content-Type': 'application/json', ...r.entetes },
      body: JSON.stringify(r.corps),
    })
  })
  return {
    couper(oui) {
      coupe = oui
    },
  }
}

/** Collecte les erreurs de la console et les violations de la CSP. */
export function surveillerErreurs(page: Page): string[] {
  const erreurs: string[] = []
  page.on('console', (m) => {
    // Une requête volontairement coupée produit une erreur réseau attendue.
    if (m.type() === 'error' && !m.text().includes('net::ERR_INTERNET_DISCONNECTED')) erreurs.push(m.text())
  })
  page.on('pageerror', (e) => erreurs.push(e.message))
  return erreurs
}

export async function seConnecter(page: Page, jeton = 'jeton-valide'): Promise<void> {
  await page.getByLabel('Dépôt du manuscrit').fill('autrice/katastrophe')
  await page.getByLabel('Jeton d’accès personnel').fill(jeton)
  await page.getByRole('button', { name: 'Se connecter' }).click()
}

/** Titres des post-its (premiers segments), dans l'ordre de la grille. */
export function titres(page: Page) {
  return page.locator('.postit[data-section]:not(.postit-suite) .postit-titre')
}

/** Le post-it (premier segment) d'une section, repéré par son titre exact. */
export function postit(page: Page, titre: string) {
  return page.locator('.postit[data-section]:not(.postit-suite)').filter({
    // Les espaces du titre peuvent être insécables : \s les couvre toutes.
    has: page.locator('.postit-titre', {
      hasText: new RegExp(`^${titre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s')}$`),
    }),
  })
}

export function etat(page: Page) {
  return page.getByRole('status').filter({ hasText: /Synchronis|Enregistré|Envoi|Hors ligne|Échec|Conflit/ })
}

/** Glisser à la souris, du centre de la source vers un point de la cible. */
export async function glisserSouris(
  page: Page,
  source: Locator,
  cible: Locator,
  position: { x: number; y: number } = { x: 0.2, y: 0.5 },
): Promise<void> {
  const a = await source.boundingBox()
  const b = await cible.boundingBox()
  if (!a || !b) throw new Error('élément invisible')
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 3)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 3 + 10, { steps: 3 })
  const x = b.x + b.width * position.x
  const y = b.y + b.height * position.y
  await page.mouse.move(x, y, { steps: 12 })
  await page.waitForTimeout(100)
  await page.mouse.move(x + 1, y, { steps: 2 })
  await page.waitForTimeout(100)
  await page.mouse.up()
}

/**
 * Glisser au doigt : appui long, puis déplacement. Si la cible n'est pas à
 * l'écran, le doigt va vers le bord pour faire défiler, comme à la main.
 * Événements tactiles envoyés par le protocole de Chromium.
 */
export async function glisserDoigt(page: Page, source: Locator, cible: Locator, appuiMs = 400): Promise<void> {
  await source.scrollIntoViewIfNeeded()
  const a = await source.boundingBox()
  if (!a) throw new Error('source invisible')
  const hauteur = page.viewportSize()?.height ?? 800
  const cdp = await page.context().newCDPSession(page)
  const point = (x: number, y: number) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }]
  let doigt = { x: a.x + a.width / 2, y: a.y + Math.min(a.height / 3, 60) }
  async function aller(x: number, y: number, etapes = 10) {
    const depart = doigt
    for (let i = 1; i <= etapes; i++) {
      doigt = { x: depart.x + ((x - depart.x) * i) / etapes, y: depart.y + ((y - depart.y) * i) / etapes }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(doigt.x, doigt.y) })
      await page.waitForTimeout(16)
    }
  }

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(doigt.x, doigt.y) })
  await page.waitForTimeout(appuiMs)
  await aller(doigt.x, doigt.y - 12, 3)

  for (let essai = 0; essai < 60; essai++) {
    const b = await cible.boundingBox()
    if (!b) break
    const centre = b.y + b.height / 2
    if (centre > 140 && centre < hauteur - 100) break
    // Près du bord, dans la colonne de la cible : défilement automatique.
    await aller(b.x + b.width * 0.2, centre <= 140 ? 30 : hauteur - 20, 3)
    await page.waitForTimeout(80)
  }
  const b = await cible.boundingBox()
  if (!b) throw new Error('cible invisible')
  await aller(b.x + b.width * 0.2, b.y + b.height / 2, 12)
  await page.waitForTimeout(150)
  await aller(doigt.x + 1, doigt.y, 1)
  await page.waitForTimeout(100)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}
