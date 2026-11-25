import { ecrireZoom, type Zoom } from '../preferences'
import type { Route } from '../routes'

const ZOOMS: { valeur: Zoom; libelle: string }[] = [
  { valeur: 'compact', libelle: 'Compact' },
  { valeur: 'normal', libelle: 'Normal' },
  { valeur: 'detaille', libelle: 'Détaillé' },
]

interface Proprietes {
  vue: 'plan' | 'lecture'
  zoom: Zoom
  /** Dans le plan : change le zoom sur place. */
  choisirZoom?: (zoom: Zoom) => void
  naviguer: (route: Route) => void
}

/**
 * Choix de la vue. Sur ordinateur : Compact, Normal, Détaillé (le plan à
 * trois niveaux de zoom) et Lecture. Sur tablette et téléphone, où
 * le zoom n'existe pas : Plan et Lecture.
 */
export function SelecteurVue({ vue, zoom, choisirZoom, naviguer }: Proprietes) {
  function plan(z?: Zoom) {
    if (z) {
      ecrireZoom(z)
      choisirZoom?.(z)
    }
    if (vue !== 'plan') naviguer({ vue: 'plan' })
  }
  return (
    <div className="zoom" role="group" aria-label="Vue">
      {ZOOMS.map((z) => (
        <button
          key={z.valeur}
          type="button"
          className="vue-zoom"
          aria-pressed={vue === 'plan' && zoom === z.valeur}
          onClick={() => {
            plan(z.valeur)
          }}
        >
          {z.libelle}
        </button>
      ))}
      <button
        type="button"
        className="vue-plan"
        aria-pressed={vue === 'plan'}
        onClick={() => {
          plan()
        }}
      >
        Plan
      </button>
      <button
        type="button"
        aria-pressed={vue === 'lecture'}
        onClick={() => {
          if (vue !== 'lecture') naviguer({ vue: 'lecture' })
        }}
      >
        Lecture
      </button>
    </div>
  )
}
