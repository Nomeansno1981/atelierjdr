import { Component, type ReactNode } from 'react'

interface Etat {
  erreur: boolean
}

/**
 * Filet pour une partie de l'interface qui n'a pas pu se charger, par
 * exemple l'éditeur après une mise à jour du site. Les modifications sont
 * déjà sur l'appareil : recharger la page ne fait rien perdre.
 */
export class FiletErreur extends Component<{ children: ReactNode }, Etat> {
  override state: Etat = { erreur: false }

  static getDerivedStateFromError(): Etat {
    return { erreur: true }
  }

  override render() {
    if (!this.state.erreur) return this.props.children
    return (
      <main className="ecran-centre">
        <p role="alert">
          Cette partie de l’Atelier n’a pas pu se charger. Le site vient peut-être d’être mis à jour. Vos modifications
          sont enregistrées sur cet appareil : rechargez la page.
        </p>
        <button
          type="button"
          className="bouton-principal"
          onClick={() => {
            window.location.reload()
          }}
        >
          Recharger
        </button>
      </main>
    )
  }
}
