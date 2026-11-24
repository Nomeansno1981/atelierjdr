import type { EtatAtelier } from '../etat/atelier'
import { nomComplet } from '../github/client'
import { IndicateurSynchro } from './commun/IndicateurSynchro'
import { ListeSections } from './commun/ListeSections'

type EtatOuvert = Extract<EtatAtelier, { phase: 'atelier' }>

interface Proprietes {
  etat: EtatOuvert
  synchroniser: () => void
  seDeconnecter: () => void
}

/**
 * Écran principal du jalon 1 : la liste des sections. Il sera remplacé par
 * le chemin de fer au jalon 2.
 */
export function EcranAtelier({ etat, synchroniser, seDeconnecter }: Proprietes) {
  const { manuscrit, synchro, connexion } = etat
  const titre = manuscrit?.plan?.livre.titre ?? nomComplet(connexion.depot)

  function confirmerDeconnexion() {
    const ok = window.confirm(
      'Se déconnecter efface le jeton et la copie du manuscrit sur cet appareil. Le manuscrit sur GitHub n’est pas touché. Continuer ?',
    )
    if (ok) seDeconnecter()
  }

  return (
    <div className="atelier">
      <header className="barre">
        <h1 className="barre-titre">{titre}</h1>
        <IndicateurSynchro synchro={synchro} />
        <div className="barre-actions">
          <button type="button" onClick={synchroniser} disabled={synchro.etat === 'en-cours'}>
            Synchroniser
          </button>
          <button type="button" onClick={confirmerDeconnexion}>
            Se déconnecter
          </button>
        </div>
      </header>

      {synchro.etat === 'erreur' && (
        <p className="bandeau bandeau-erreur" role="alert">
          {synchro.message}
        </p>
      )}

      <main className="contenu">
        {manuscrit === null ? (
          <p className="ecran-attente">
            {synchro.etat === 'en-cours'
              ? 'Premier chargement du manuscrit…'
              : 'Le manuscrit n’a encore jamais été chargé sur cet appareil.'}
          </p>
        ) : manuscrit.plan === null ? (
          <p className="bandeau bandeau-erreur" role="alert">
            {manuscrit.erreurPlan}
          </p>
        ) : (
          <ListeSections plan={manuscrit.plan} textes={manuscrit.textes} />
        )}
      </main>
    </div>
  )
}
