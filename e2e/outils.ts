import type { Page } from '@playwright/test'
import { lireExemple } from '../src/test/exemple'
import { FauxGitHub } from '../src/test/fauxGitHub'

export { FauxGitHub, lireExemple }

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
    const r = faux.repondre(requete.method(), requete.url(), await requete.headerValue('authorization'))
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
