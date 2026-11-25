import { useId, useState, type SubmitEvent } from 'react'
import type { NouvellePartie } from '../../domaine/parties'
import type { Partie, Plan } from '../../domaine/plan'
import { Dialogue } from '../commun/Dialogue'

interface Proprietes {
  plan: Plan
  partie: Partie
  /** Numéro affiché (« II »), s'il y en a un. */
  numero: string | undefined
  /** Les parties se suivent dans la grille : on peut déplacer celle-ci. */
  regroupe: boolean
  valider: (modif: NouvellePartie) => void
  /** Déplace la partie, avec ses sections, à cet index de la liste (comptée sans elle). */
  deplacer: (index: number) => void
  supprimer: () => void
  fusionner: () => void
  fermer: () => void
}

/** Réglages d'une partie : titre, numérotation, place dans le livre, suppression ou fusion. */
export function PanneauPartie({ plan, partie, numero, regroupe, valider, deplacer, supprimer, fusionner, fermer }: Proprietes) {
  const [titre, setTitre] = useState(partie.titre)
  const [numerotee, setNumerotee] = useState(partie.numerotee)
  const id = useId()
  const rang = plan.parties.findIndex((p) => p.id === partie.id)
  const precedente = plan.parties[rang - 1]
  const suivante = plan.parties[rang + 1]
  const sections = plan.sections.filter((s) => s.partie === partie.id)
  const voisine = precedente ?? suivante
  const pluriel = sections.length > 1 ? 's' : ''

  function envoyer(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    valider({ titre, numerotee })
  }

  return (
    <Dialogue titre={numero ? `Partie ${numero}` : 'Partie'} onFermer={fermer}>
      <form className="formulaire" onSubmit={envoyer}>
        <p className="aide">
          {sections.length === 0 ? 'Aucune section pour l’instant.' : `${sections.length} section${pluriel}.`}
        </p>

        <label htmlFor={`${id}-titre`}>Titre de la partie</label>
        <input id={`${id}-titre`} value={titre} onChange={(e) => { setTitre(e.target.value) }} required />

        <label className="case">
          <input type="checkbox" checked={numerotee} onChange={(e) => { setNumerotee(e.target.checked) }} />
          Numérotée (Partie I, II…)
        </label>

        <div className="deplacer-partie">
          <button
            type="button"
            disabled={!precedente || !regroupe}
            onClick={() => {
              deplacer(rang - 1)
            }}
          >
            {precedente ? `Placer avant « ${precedente.titre} »` : 'Déjà en tête du livre'}
          </button>
          <button
            type="button"
            disabled={!suivante || !regroupe}
            onClick={() => {
              deplacer(rang + 1)
            }}
          >
            {suivante ? `Placer après « ${suivante.titre} »` : 'Déjà en fin de livre'}
          </button>
        </div>
        {!regroupe && <p className="aide">Regroupez d’abord les parties (bandeau en haut du plan) pour pouvoir les déplacer.</p>}

        <div className="actions-formulaire">
          {sections.length === 0 ? (
            <button type="button" className="bouton-danger" onClick={supprimer} disabled={plan.parties.length <= 1}>
              Supprimer
            </button>
          ) : (
            voisine && (
              <button
                type="button"
                className="bouton-danger"
                title={`Ses sections passent dans « ${voisine.titre} »`}
                onClick={fusionner}
              >
                Fusionner avec « {voisine.titre} »
              </button>
            )
          )}
          <span className="espace" />
          <button type="button" onClick={fermer}>
            Annuler
          </button>
          <button type="submit" className="bouton-principal">
            Enregistrer
          </button>
        </div>
      </form>
    </Dialogue>
  )
}
