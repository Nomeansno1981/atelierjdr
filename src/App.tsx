import { useSyncExternalStore } from 'react'
import type { Atelier } from './etat/atelier'
import { nomComplet } from './github/client'
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
          creerLivre={(jeton, cible, livre) => atelier.creerLivre(jeton, cible, livre)}
        />
      )
    case 'atelier':
      return (
        // Changer de livre remplace tout l'écran : rien ne reste de l'autre livre.
        <EcranAtelier key={nomComplet(etat.connexion.depot).toLowerCase()} atelier={atelier} etat={etat} />
      )
  }
}
