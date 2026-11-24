import type { EtatSynchro } from '../../etat/atelier'

const FORMAT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function enAttenteTexte(n: number): string {
  return `${n} modification${n > 1 ? 's' : ''} en attente`
}

interface Proprietes {
  synchro: EtatSynchro
  enAttente: number
  conflit: boolean
}

/** Indicateur discret et toujours visible de l'état de l'enregistrement. */
export function IndicateurSynchro({ synchro, enAttente, conflit }: Proprietes) {
  let libelle: string
  let classe: string = synchro.etat
  if (conflit) {
    libelle = 'Conflit'
    classe = 'conflit'
  } else {
    switch (synchro.etat) {
      case 'en-cours':
        libelle = 'Synchronisation…'
        break
      case 'envoi':
        libelle = 'Envoi…'
        break
      case 'a-jour':
        libelle = 'Synchronisé'
        break
      case 'local':
        libelle = 'Enregistré sur l’appareil'
        break
      case 'hors-ligne':
        libelle = enAttente > 0 ? `Hors ligne, ${enAttenteTexte(enAttente)}` : 'Hors ligne'
        break
      case 'erreur':
        libelle = enAttente > 0 ? `Échec de l’envoi, ${enAttenteTexte(enAttente)}` : 'Échec de la synchronisation'
        break
    }
  }
  const le = 'le' in synchro && synchro.le ? `Dernière synchronisation : ${FORMAT.format(new Date(synchro.le))}` : undefined
  return (
    <p className={`indicateur indicateur-${classe}`} role="status" aria-live="polite" title={le}>
      <span className="indicateur-point" aria-hidden="true" />
      {libelle}
    </p>
  )
}
