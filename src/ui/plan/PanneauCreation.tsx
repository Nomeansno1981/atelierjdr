import { useId, useState, type SubmitEvent } from 'react'
import type { NouvelleSection } from '../../domaine/operations'
import type { Plan } from '../../domaine/plan'
import { Dialogue } from '../commun/Dialogue'

interface Proprietes {
  plan: Plan
  /** Position de la nouvelle section dans l'ordre du plan. */
  index: number
  creer: (nouvelle: NouvelleSection) => void
  fermer: () => void
}

export function PanneauCreation({ plan, index, creer, fermer }: Proprietes) {
  // Par défaut, la partie de la section précédente (ou suivante, en tête de grille).
  const voisine = plan.sections[index - 1] ?? plan.sections[index]
  const [type, setType] = useState<NouvelleSection['type']>('texte')
  const [titre, setTitre] = useState('')
  const [partie, setPartie] = useState(voisine?.partie ?? plan.parties[0]?.id ?? '')
  const [pages, setPages] = useState('1')
  const id = useId()

  function envoyer(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (titre.trim() === '') return
    creer({ type, titre, partie, pages: Math.max(1, Number.parseInt(pages, 10) || 1) })
  }

  return (
    <Dialogue titre="Nouvelle section" onFermer={fermer}>
      <form className="formulaire" onSubmit={envoyer}>
        <fieldset className="choix-type">
          <legend>Type</legend>
          <label>
            <input type="radio" name="type" checked={type === 'texte'} onChange={() => { setType('texte') }} />
            Texte
          </label>
          <label>
            <input
              type="radio"
              name="type"
              checked={type === 'hors-texte'}
              onChange={() => { setType('hors-texte') }}
            />
            Hors-texte <span className="aide">(illustration, page de titre, fiche…)</span>
          </label>
        </fieldset>

        <label htmlFor={`${id}-titre`}>Titre</label>
        <input id={`${id}-titre`} value={titre} onChange={(e) => { setTitre(e.target.value) }} required autoFocus />

        <div className="champs-2">
          <div>
            <label htmlFor={`${id}-partie`}>Partie</label>
            <select id={`${id}-partie`} value={partie} onChange={(e) => { setPartie(e.target.value) }}>
              {plan.parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.titre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-pages`}>Pages</label>
            <input
              id={`${id}-pages`}
              type="number"
              inputMode="numeric"
              min={1}
              value={pages}
              onChange={(e) => { setPages(e.target.value) }}
              required
            />
          </div>
        </div>

        <div className="actions-formulaire">
          <span className="espace" />
          <button type="button" onClick={fermer}>
            Annuler
          </button>
          <button type="submit" className="bouton-principal">
            Créer
          </button>
        </div>
      </form>
    </Dialogue>
  )
}
