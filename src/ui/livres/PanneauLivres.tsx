import { useEffect, useId, useState, type SubmitEvent } from 'react'
import type { Atelier, DepotACreer, EtatOuvert, ResumeLivre } from '../../etat/atelier'
import { memeDepot, nomComplet } from '../../github/client'
import { Dialogue } from '../commun/Dialogue'
import { FormulaireNouveauLivre } from './FormulaireNouveauLivre'

interface Proprietes {
  atelier: Atelier
  etat: EtatOuvert
  fermer: () => void
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`

/**
 * Les livres de cet appareil : passer de l'un à l'autre, en ajouter un
 * (dépôt existant, ou dépôt vide où créer le manuscrit), en retirer un.
 */
export function PanneauLivres({ atelier, etat, fermer }: Proprietes) {
  const [livres, setLivres] = useState<ResumeLivre[] | null>(null)
  const [saisie, setSaisie] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)
  const [aCreer, setACreer] = useState<DepotACreer | null>(null)
  const id = useId()

  useEffect(() => {
    let actif = true
    void atelier.resumerLivres().then((liste) => {
      if (actif) setLivres(liste)
    })
    return () => {
      actif = false
    }
  }, [atelier])

  async function changer(livre: ResumeLivre) {
    setEnCours(
      livre.enAttente > 0 || etat.enAttente > 0
        ? `Envoi des modifications, puis ouverture de ${livre.titre}…`
        : `Ouverture de ${livre.titre}…`,
    )
    await atelier.changerDeLivre(livre.depot)
    // Le livre ouvert change : tout l'écran est remplacé, ce panneau compris.
    fermer()
  }

  async function retirer(livre: ResumeLivre) {
    const perte =
      livre.enAttente > 0
        ? `\n\nAttention : ${pluriel(livre.enAttente, 'modification')} pas encore envoyée${livre.enAttente > 1 ? 's' : ''} à GitHub ${livre.enAttente > 1 ? 'seront perdues' : 'sera perdue'}.`
        : ''
    const ok = window.confirm(
      `Retirer « ${livre.titre} » de cet appareil ? Sa copie locale est effacée ; le dépôt ${nomComplet(livre.depot)} sur GitHub n’est pas touché, et vous pourrez l’ajouter de nouveau.${perte}`,
    )
    if (!ok) return
    await atelier.retirerLivre(livre.depot)
    setLivres((l) => l?.filter((x) => !memeDepot(x.depot, livre.depot)) ?? null)
  }

  async function ajouter(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setErreur(null)
    setEnCours('Vérification du dépôt…')
    const resultat = await atelier.ajouterLivre(saisie)
    if (resultat.etat === 'ouvert') {
      fermer()
      return
    }
    setEnCours(null)
    if (resultat.etat === 'erreur') setErreur(resultat.message)
    else setACreer(resultat)
  }

  const motsParPage = etat.manuscrit?.plan?.livre.motsParPage ?? 350

  return (
    <Dialogue titre="Livres" onFermer={fermer}>
      {aCreer ? (
        <FormulaireNouveauLivre
          cible={aCreer}
          motsParPage={motsParPage}
          creer={(livre) => atelier.creerLivre(null, aCreer, livre)}
          annuler={() => {
            setACreer(null)
          }}
        />
      ) : (
        <>
          {livres === null ? (
            <p className="aide">Lecture de la liste…</p>
          ) : (
            <ul className="liste-livres">
              {livres.map((livre) => (
                <li key={nomComplet(livre.depot).toLowerCase()}>
                  <LigneLivre
                    livre={livre}
                    desactive={enCours !== null}
                    changer={() => void changer(livre)}
                    retirer={() => void retirer(livre)}
                  />
                </li>
              ))}
            </ul>
          )}

          {enCours && (
            <p className="aide" role="status">
              {enCours}
            </p>
          )}

          <form className="formulaire ajout-livre" onSubmit={(e) => void ajouter(e)}>
            <h3>Ajouter un livre</h3>
            <label htmlFor={`${id}-depot`}>Dépôt GitHub du livre</label>
            <div className="ligne-ajout">
              <input
                id={`${id}-depot`}
                value={saisie}
                onChange={(e) => {
                  setSaisie(e.target.value)
                }}
                placeholder={`${etat.connexion.depot.proprietaire}/nouveau-livre`}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
              <button type="submit" className="bouton-principal" disabled={enCours !== null}>
                Ajouter
              </button>
            </div>
            {erreur && (
              <p className="erreur" role="alert">
                {erreur}
              </p>
            )}
            <details className="aide-details">
              <summary>Nouveau livre : préparer le dépôt sur GitHub</summary>
              <ol>
                <li>
                  Créez un dépôt <strong>privé</strong> sur{' '}
                  <a href="https://github.com/new" target="_blank" rel="noreferrer">
                    github.com/new
                  </a>{' '}
                  (inutile de cocher « Add a README file »).
                </li>
                <li>
                  Donnez-y accès au jeton de l’Atelier, sans en créer un autre : dans{' '}
                  <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer">
                    vos jetons
                  </a>
                  , ouvrez-le, modifiez son accès aux dépôts (« Repository access ») pour y ajouter le nouveau, puis
                  enregistrez avec le bouton « Update », tout en bas de la page.
                </li>
                <li>Saisissez son nom ci-dessus : l’Atelier y crée le manuscrit.</li>
              </ol>
            </details>
          </form>
        </>
      )}
    </Dialogue>
  )
}

function LigneLivre({
  livre,
  desactive,
  changer,
  retirer,
}: {
  livre: ResumeLivre
  desactive: boolean
  changer: () => void
  retirer: () => void
}) {
  const details = [
    nomComplet(livre.depot),
    livre.ouvert ? 'ouvert' : null,
    livre.enAttente > 0 ? `${pluriel(livre.enAttente, 'modification')} en attente` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  if (livre.ouvert) {
    return (
      <div className="livre livre-ouvert" aria-current="true">
        <span className="livre-titre">{livre.titre}</span>
        <span className="aide">{details}</span>
      </div>
    )
  }
  return (
    <div className="livre-ligne">
      <button type="button" className="livre" onClick={changer} disabled={desactive}>
        <span className="livre-titre">{livre.titre}</span>
        <span className="aide">{details}</span>
      </button>
      <button
        type="button"
        className="bouton-discret"
        aria-label={`Retirer ${livre.titre} de cet appareil`}
        onClick={retirer}
        disabled={desactive}
      >
        Retirer
      </button>
    </div>
  )
}
