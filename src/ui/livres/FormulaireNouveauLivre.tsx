import { useId, useState, type SubmitEvent } from 'react'
import type { NouveauLivre } from '../../domaine/operations'
import { nomComplet } from '../../github/client'
import type { DepotACreer } from '../../etat/atelier'

interface Proprietes {
  cible: DepotACreer
  /** Mots par page proposés (ceux du livre ouvert, s'il y en a un). */
  motsParPage: number
  /** Renvoie un message d'erreur, ou null si le manuscrit est créé. */
  creer: (livre: NouveauLivre) => Promise<string | null>
  annuler: () => void
}

/**
 * Premier plan d'un livre : titre, budget de pages, mots par page et
 * parties. Le reste (parties non numérotées, typographie, nom des
 * compilations) se règle ensuite dans les Réglages.
 */
export function FormulaireNouveauLivre({ cible, motsParPage, creer, annuler }: Proprietes) {
  const [titre, setTitre] = useState('')
  const [pages, setPages] = useState('100')
  const [mots, setMots] = useState(String(motsParPage))
  const [parties, setParties] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const id = useId()

  async function envoyer(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setEnCours(true)
    setErreur(null)
    const probleme = await creer({
      titre,
      pagesTotal: Number.parseInt(pages, 10) || 1,
      motsParPage: Number.parseInt(mots, 10) || 1,
      parties: parties.split('\n'),
    })
    // En cas de succès, le livre s'ouvre et ce formulaire disparaît.
    if (probleme !== null) {
      setErreur(probleme)
      setEnCours(false)
    }
  }

  return (
    <form className="formulaire nouveau-livre" onSubmit={(e) => void envoyer(e)}>
      <p className="aide">
        Le dépôt <strong>{nomComplet(cible.depot)}</strong>
        {cible.vide
          ? ' est vide. L’Atelier va y créer le manuscrit d’un nouveau livre.'
          : ' ne contient pas encore de manuscrit (pas de plan.json). L’Atelier va l’y créer, sans toucher aux autres fichiers.'}
      </p>

      <label htmlFor={`${id}-titre`}>Titre du livre</label>
      <input id={`${id}-titre`} value={titre} onChange={(e) => { setTitre(e.target.value) }} required autoFocus />

      <div className="champs-2">
        <div>
          <label htmlFor={`${id}-pages`}>Nombre de pages</label>
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
        <div>
          <label htmlFor={`${id}-mots`}>Mots par page</label>
          <input
            id={`${id}-mots`}
            type="number"
            inputMode="numeric"
            min={1}
            value={mots}
            onChange={(e) => { setMots(e.target.value) }}
            required
          />
        </div>
      </div>

      <label htmlFor={`${id}-parties`}>Parties, une par ligne</label>
      <textarea
        id={`${id}-parties`}
        rows={4}
        value={parties}
        placeholder={'Présentation\nLes règles\nLexique'}
        onChange={(e) => { setParties(e.target.value) }}
      />
      <p className="aide">Elles se modifient ensuite dans les Réglages du livre.</p>

      {erreur && (
        <p className="erreur" role="alert">
          {erreur}
        </p>
      )}

      <div className="actions-formulaire">
        <span className="espace" />
        <button type="button" onClick={annuler} disabled={enCours}>
          Annuler
        </button>
        <button type="submit" className="bouton-principal" disabled={enCours}>
          {enCours ? 'Création…' : 'Créer le manuscrit'}
        </button>
      </div>
    </form>
  )
}
