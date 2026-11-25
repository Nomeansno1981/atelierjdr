import { useId, useState, type SubmitEvent } from 'react'
import type { NouveauLivre } from '../../domaine/operations'
import type { DepotACreer, ResultatOuverture } from '../../etat/atelier'
import { nomComplet, type Depot } from '../../github/client'
import { FormulaireNouveauLivre } from '../livres/FormulaireNouveauLivre'

interface Proprietes {
  depotConnu: Depot | null
  /** Message affiché à l'arrivée, par exemple après un jeton révoqué. */
  message: string | null
  seConnecter: (jeton: string, depot: string) => Promise<ResultatOuverture>
  creerLivre: (jeton: string, cible: DepotACreer, livre: NouveauLivre) => Promise<string | null>
}

export function EcranConnexion({ depotConnu, message, seConnecter, creerLivre }: Proprietes) {
  const [jeton, setJeton] = useState('')
  const [depot, setDepot] = useState(depotConnu ? nomComplet(depotConnu) : '')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  // Dépôt accessible mais sans manuscrit : on propose de le créer.
  const [aCreer, setACreer] = useState<DepotACreer | null>(null)
  const idJeton = useId()
  const idDepot = useId()
  const idAide = useId()

  async function envoyer(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setEnCours(true)
    setErreur(null)
    const resultat = await seConnecter(jeton, depot)
    // En cas de succès, ce composant disparaît : inutile de le remettre à jour.
    if (resultat.etat === 'ouvert') return
    setEnCours(false)
    if (resultat.etat === 'erreur') setErreur(resultat.message)
    else setACreer(resultat)
  }

  if (aCreer) {
    return (
      <main className="ecran-centre connexion">
        <h1>Nouveau livre</h1>
        <FormulaireNouveauLivre
          cible={aCreer}
          motsParPage={350}
          creer={(livre) => creerLivre(jeton, aCreer, livre)}
          annuler={() => {
            setACreer(null)
          }}
        />
      </main>
    )
  }

  return (
    <main className="ecran-centre connexion">
      <h1>Atelier</h1>
      {message && (
        <p className="bandeau bandeau-attention" role="alert">
          {message}
        </p>
      )}
      <form onSubmit={(e) => void envoyer(e)} aria-describedby={idAide}>
        <p id={idAide} className="aide">
          L’Atelier lit et écrit votre manuscrit directement dans votre dépôt GitHub privé. Le
          jeton reste sur cet appareil.
        </p>

        <label htmlFor={idDepot}>Dépôt du manuscrit</label>
        <input
          id={idDepot}
          name="depot"
          value={depot}
          onChange={(e) => {
            setDepot(e.target.value)
          }}
          placeholder="utilisateur/katastrophe"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />

        <label htmlFor={idJeton}>Jeton d’accès personnel</label>
        <input
          id={idJeton}
          name="jeton"
          type="password"
          value={jeton}
          onChange={(e) => {
            setJeton(e.target.value)
          }}
          placeholder="github_pat_…"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
        />

        {erreur && (
          <p className="erreur" role="alert">
            {erreur}
          </p>
        )}

        <button type="submit" className="bouton-principal" disabled={enCours}>
          {enCours ? 'Vérification…' : 'Se connecter'}
        </button>
      </form>
    </main>
  )
}
