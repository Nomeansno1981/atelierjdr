import type { EtatSynchro } from '../../etat/atelier'

const FORMAT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function quand(le: string | null): string {
  return le ? ` (copie du ${FORMAT.format(new Date(le))})` : ''
}

export function IndicateurSynchro({ synchro }: { synchro: EtatSynchro }) {
  let libelle: string
  switch (synchro.etat) {
    case 'en-cours':
      libelle = 'Synchronisation…'
      break
    case 'a-jour':
      libelle = 'Synchronisé'
      break
    case 'hors-ligne':
      libelle = `Hors ligne${quand(synchro.le)}`
      break
    case 'erreur':
      libelle = `Échec de la synchronisation${quand(synchro.le)}`
      break
  }
  return (
    <p className={`indicateur indicateur-${synchro.etat}`} role="status" aria-live="polite">
      <span className="indicateur-point" aria-hidden="true" />
      {libelle}
    </p>
  )
}
