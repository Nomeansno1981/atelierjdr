import { useId, useState, type SubmitEvent } from 'react'
import type { NouvelleSection } from '../../domaine/operations'
import type { NouvellePartie } from '../../domaine/parties'
import type { Plan } from '../../domaine/plan'
import { Dialogue } from '../commun/Dialogue'

interface Proprietes {
  plan: Plan
  /** Partie où la section sera créée : celle de la place choisie. */
  partie: string
  /** Entre deux parties : celle de droite, au choix (la section irait à son début). */
  autrePartie?: string | undefined
  /**
   * Où une nouvelle partie commencerait : avant une section, ou en fin de
   * livre. null : on ne propose pas de partie (depuis une partie vide).
   */
  placePartie: 'ici' | 'fin' | null
  creer: (nouvelle: NouvelleSection) => void
  creerPartie: (nouvelle: NouvellePartie) => void
  fermer: () => void
}

type Type = NouvelleSection['type'] | 'partie'

export function PanneauCreation({ plan, partie, autrePartie, placePartie, creer, creerPartie, fermer }: Proprietes) {
  const [type, setType] = useState<Type>('texte')
  const [partieChoisie, setPartieChoisie] = useState(partie)
  const [titre, setTitre] = useState('')
  const [pages, setPages] = useState('1')
  const [numerotee, setNumerotee] = useState(true)
  const id = useId()
  const nom = (id: string) => plan.parties.find((p) => p.id === id)?.titre ?? id

  function envoyer(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (type === 'partie') {
      if (titre.trim() === '') return
      creerPartie({ titre, numerotee })
      return
    }
    if (titre.trim() === '' && type !== 'blanche') return
    creer({ type, titre, partie: partieChoisie, pages: Math.max(1, Number.parseInt(pages, 10) || 1) })
  }

  const choix = (valeur: Type, libelle: string, aide?: string) => (
    <label>
      <input type="radio" name="type" checked={type === valeur} onChange={() => { setType(valeur) }} />
      {libelle}
      {aide && <span className="aide"> ({aide})</span>}
    </label>
  )

  return (
    <Dialogue titre={type === 'partie' ? 'Nouvelle partie' : 'Nouvelle section'} onFermer={fermer}>
      <form className="formulaire" onSubmit={envoyer}>
        <fieldset className="choix-type">
          <legend>Type</legend>
          {choix('texte', 'Texte')}
          {choix('hors-texte', 'Hors-texte', 'illustration, page de titre, fiche…')}
          {choix('blanche', 'Page blanche', 'laissée blanche à dessein')}
          {placePartie &&
            choix(
              'partie',
              'Partie',
              placePartie === 'ici' ? 'elle commence ici et reprend la suite de la partie' : 'à la fin du livre',
            )}
        </fieldset>

        <label htmlFor={`${id}-titre`}>{type === 'partie' ? 'Titre de la partie' : 'Titre'}</label>
        <input
          id={`${id}-titre`}
          value={titre}
          onChange={(e) => { setTitre(e.target.value) }}
          required={type !== 'blanche'}
          placeholder={type === 'blanche' ? 'Page blanche' : undefined}
          autoFocus
        />

        {type === 'partie' ? (
          <label className="case">
            <input type="checkbox" checked={numerotee} onChange={(e) => { setNumerotee(e.target.checked) }} />
            Numérotée (Partie I, II…)
          </label>
        ) : (
          <>
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
            {autrePartie ? (
              <>
                <label htmlFor={`${id}-partie`}>Partie</label>
                <select
                  id={`${id}-partie`}
                  value={partieChoisie}
                  onChange={(e) => {
                    setPartieChoisie(e.target.value)
                  }}
                >
                  <option value={partie}>À la fin de « {nom(partie)} »</option>
                  <option value={autrePartie}>Au début de « {nom(autrePartie)} »</option>
                </select>
              </>
            ) : (
              <p className="aide">Dans la partie « {nom(partie)} ».</p>
            )}
          </>
        )}

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
