import type { Plan } from '../../domaine/plan'
import { Dialogue } from '../commun/Dialogue'
import { IconeHorsTexte } from '../commun/icones'

const DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

interface Proprietes {
  plan: Plan
  restaurer: (id: string) => void
  vider: () => void
  fermer: () => void
}

export function PanneauCorbeille({ plan, restaurer, vider, fermer }: Proprietes) {
  // Les plus récemment supprimées d'abord.
  const elements = [...plan.corbeille].reverse()

  function confirmerVidage() {
    const n = plan.corbeille.length
    const ok = window.confirm(
      `Vider la corbeille supprime définitivement ${n} section${n > 1 ? 's' : ''} du plan. Leurs fichiers restent consultables dans l’historique GitHub. Cette action ne s’annule pas. Continuer ?`,
    )
    if (ok) vider()
  }

  return (
    <Dialogue titre="Corbeille" onFermer={fermer}>
      {elements.length === 0 ? (
        <p className="aide">La corbeille est vide.</p>
      ) : (
        <>
          <ul className="liste-corbeille">
            {elements.map((e) => (
              <li key={e.section.id}>
                <div>
                  <p className="corbeille-titre">
                    {e.section.type === 'hors-texte' && <IconeHorsTexte />}
                    {e.section.titre}
                  </p>
                  <p className="aide">Supprimée le {DATE.format(new Date(e.supprimeLe))}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    restaurer(e.section.id)
                  }}
                >
                  Restaurer
                </button>
              </li>
            ))}
          </ul>
          <div className="actions-formulaire">
            <button type="button" className="bouton-danger" onClick={confirmerVidage}>
              Vider la corbeille
            </button>
          </div>
        </>
      )}
    </Dialogue>
  )
}
