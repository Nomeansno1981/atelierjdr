import type { Atelier, EtatOuvert } from '../etat/atelier'
import { nomComplet } from '../github/client'
import { IndicateurSynchro } from './commun/IndicateurSynchro'
import { ModePlan } from './plan/ModePlan'

interface Proprietes {
  atelier: Atelier
  etat: EtatOuvert
}

/** Le plan s'il est lisible ; sinon, un écran d'attente ou d'erreur. */
export function EcranAtelier({ atelier, etat }: Proprietes) {
  const { manuscrit, synchro, connexion } = etat
  if (manuscrit?.plan) return <ModePlan atelier={atelier} etat={etat} plan={manuscrit.plan} />

  function confirmerDeconnexion() {
    const ok = window.confirm(
      'Se déconnecter efface le jeton et la copie du manuscrit sur cet appareil. Le manuscrit sur GitHub n’est pas touché. Continuer ?',
    )
    if (ok) void atelier.seDeconnecter()
  }

  return (
    <div className="atelier">
      <header className="barre">
        <div className="barre-ligne">
          <h1 className="barre-titre">{nomComplet(connexion.depot)}</h1>
          <IndicateurSynchro synchro={synchro} enAttente={etat.enAttente} conflit={false} />
        </div>
        <div className="barre-outils">
          <span className="espace" />
          <button
            type="button"
            onClick={() => void atelier.synchroniser()}
            disabled={synchro.etat === 'en-cours'}
          >
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
        ) : (
          <p className="bandeau bandeau-erreur" role="alert">
            {manuscrit.erreurPlan}
          </p>
        )}
      </main>
    </div>
  )
}
