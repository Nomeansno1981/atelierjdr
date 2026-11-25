/**
 * Routage par l'ancre de l'adresse (#/…) : GitHub Pages ne sait pas servir
 * index.html pour une adresse profonde. Le bouton Retour du navigateur
 * ramène ainsi de l'éditeur au plan.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react'

export interface Selection {
  debut: number
  fin: number
}

export type Route = { vue: 'plan' } | { vue: 'section'; id: string; selection: Selection | null }

export function lireRoute(ancre: string): Route {
  const m = /^#\/section\/([a-z0-9]{6})(?:\?d=(\d+)&f=(\d+))?$/.exec(ancre)
  if (!m?.[1]) return { vue: 'plan' }
  const selection = m[2] !== undefined && m[3] !== undefined ? { debut: Number(m[2]), fin: Number(m[3]) } : null
  return { vue: 'section', id: m[1], selection }
}

export function adresse(route: Route): string {
  if (route.vue === 'plan') return '#/'
  const s = route.selection ? `?d=${route.selection.debut}&f=${route.selection.fin}` : ''
  return `#/section/${route.id}${s}`
}

function abonner(rappel: () => void): () => void {
  window.addEventListener('hashchange', rappel)
  return () => {
    window.removeEventListener('hashchange', rappel)
  }
}

export function useRoute(): [Route, (route: Route) => void] {
  const ancre = useSyncExternalStore(abonner, () => window.location.hash)
  const naviguer = useCallback((route: Route) => {
    const cible = adresse(route)
    if (window.location.hash !== cible) window.location.hash = cible
  }, [])
  // Même objet tant que l'adresse ne change pas : une sélection n'est appliquée qu'une fois.
  const route = useMemo(() => lireRoute(ancre), [ancre])
  return [route, naviguer]
}
