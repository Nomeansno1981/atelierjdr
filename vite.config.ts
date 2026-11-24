import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * Politique de sécurité du contenu. GitHub Pages ne permet pas d'envoyer
 * d'en-têtes HTTP : elle passe donc par une balise <meta>, injectée
 * seulement à la construction (le serveur de développement de Vite a besoin
 * de scripts en ligne et d'une websocket).
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  'connect-src https://api.github.com',
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function politiqueDeSecurite(): Plugin {
  return {
    name: 'atelier-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!-- CSP -->',
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      )
    },
  }
}

export default defineConfig({
  // Chemins relatifs : le site fonctionne quel que soit le nom du dépôt
  // GitHub Pages (https://utilisateur.github.io/atelier/).
  base: './',
  plugins: [react(), politiqueDeSecurite()],
  build: {
    // Aucune ressource en data: dans le CSS ou le JS : tout reste en fichiers.
    assetsInlineLimit: 0,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
