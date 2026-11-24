import { useSyncExternalStore } from 'react'
import type { Atelier } from './etat/atelier'
import { EcranAtelier } from './ui/EcranAtelier'
import { EcranConnexion } from './ui/connexion/EcranConnexion'

export function App({ atelier }: { atelier: Atelier }) {
  const etat = useSyncExternalStore(atelier.abonner, atelier.lire)

  switch (etat.phase) {
    case 'demarrage':
      return <p className="ecran-attente">Ouverture de l’Atelier…</p>
    case 'panne':
      return (
        <main className="ecran-centre">
          <h1>L’Atelier ne peut pas démarrer</h1>
          <p role="alert">{etat.message}</p>
        </main>
      )
    case 'connexion':
      return (
        <EcranConnexion
          depotConnu={etat.depot}
          message={etat.message}
          seConnecter={(jeton, depot) => atelier.seConnecter(jeton, depot)}
        />
      )
    case 'atelier':
      return (
        <EcranAtelier atelier={atelier} etat={etat} />
      )
  }
}
