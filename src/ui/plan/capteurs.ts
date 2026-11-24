/**
 * Capteurs de glisser-déposer. Ceux de dnd-kit, sauf qu'un appui sur un
 * bouton secondaire du post-it (…, −, +) ne lance jamais de glissement.
 */

import { MouseSensor, TouchSensor } from '@dnd-kit/core'
import type { MouseEvent as EvenementSourisReact, TouchEvent as EvenementTactileReact } from 'react'

export const ATTRIBUT_SANS_GLISSER = 'data-sans-glisser'

function surBoutonSecondaire(cible: EventTarget | null): boolean {
  return cible instanceof Element && cible.closest(`[${ATTRIBUT_SANS_GLISSER}]`) !== null
}

export class CapteurSouris extends MouseSensor {
  static override activators = [
    {
      eventName: 'onMouseDown' as const,
      handler: ({ nativeEvent }: EvenementSourisReact) => nativeEvent.button === 0 && !surBoutonSecondaire(nativeEvent.target),
    },
  ]
}

export class CapteurTactile extends TouchSensor {
  static override activators = [
    {
      eventName: 'onTouchStart' as const,
      handler: ({ nativeEvent }: EvenementTactileReact) =>
        nativeEvent.touches.length === 1 && !surBoutonSecondaire(nativeEvent.target),
    },
  ]
}
