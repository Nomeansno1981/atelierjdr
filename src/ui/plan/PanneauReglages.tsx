import { useId, useState, type SubmitEvent } from 'react'
import { MODELE_PAR_DEFAUT, modeleValide } from '../../domaine/compilation'
import type { Reglages } from '../../domaine/operations'
import { reglesTypo, type Plan } from '../../domaine/plan'
import type { ReglesTypo } from '../../domaine/typographie/regles'
import { Dialogue } from '../commun/Dialogue'
import { afficherInsecables, useInsecablesVisibles } from '../preferences'

const REGLES: { cle: keyof ReglesTypo; libelle: string }[] = [
  { cle: 'apostrophe', libelle: 'Apostrophe typographique (’)' },
  { cle: 'guillemets', libelle: 'Guillemets français avec espaces insécables («\u00a0»)' },
  { cle: 'ponctuation', libelle: 'Espace insécable avant : ; ! ?' },
  { cle: 'suspension', libelle: 'Points de suspension (…)' },
  { cle: 'espaceFine', libelle: 'Espace fine insécable (U+202F) devant ; ! ? plutôt que l’insécable ordinaire' },
]

interface Proprietes {
  plan: Plan
  enAttente: number
  valider: (reglages: Reglages) => void
  /** Normaliser tout le manuscrit, avec les règles du formulaire. */
  normaliserTout: (regles: ReglesTypo) => void
  seDeconnecter: () => void
  fermer: () => void
}

export function PanneauReglages({ plan, enAttente, valider, normaliserTout, seDeconnecter, fermer }: Proprietes) {
  const [titre, setTitre] = useState(plan.livre.titre)
  const [pagesTotal, setPagesTotal] = useState(String(plan.livre.pagesTotal))
  const [motsParPage, setMotsParPage] = useState(String(plan.livre.motsParPage))
  const [typographie, setTypographie] = useState<ReglesTypo>(reglesTypo(plan))
  const [modele, setModele] = useState(plan.reglages?.compilation?.modele ?? MODELE_PAR_DEFAUT)
  const insecablesVisibles = useInsecablesVisibles()
  const id = useId()

  function envoyer(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    valider({
      titre,
      pagesTotal: Number.parseInt(pagesTotal, 10) || plan.livre.pagesTotal,
      motsParPage: Number.parseInt(motsParPage, 10) || plan.livre.motsParPage,
      typographie,
      // Le modèle n'est écrit dans plan.json que s'il diffère de celui par défaut.
      ...(modele !== (plan.reglages?.compilation?.modele ?? MODELE_PAR_DEFAUT) ? { modeleCompilation: modele } : {}),
    })
  }

  function confirmerDeconnexion() {
    const perte =
      enAttente > 0
        ? `\n\nAttention : ${enAttente} modification${enAttente > 1 ? 's n’ont' : ' n’a'} pas encore été envoyée${enAttente > 1 ? 's' : ''} à GitHub et ${enAttente > 1 ? 'seront perdues' : 'sera perdue'}.`
        : ''
    const ok = window.confirm(
      `Se déconnecter efface le jeton et la copie de tous vos livres sur cet appareil. Les manuscrits sur GitHub ne sont pas touchés.${perte}\n\nContinuer ?`,
    )
    if (ok) seDeconnecter()
  }

  return (
    <Dialogue titre="Réglages du livre" onFermer={fermer}>
      <form className="formulaire" onSubmit={envoyer}>
        <label htmlFor={`${id}-titre`}>Titre du livre</label>
        <input id={`${id}-titre`} value={titre} onChange={(e) => { setTitre(e.target.value) }} required />

        <div className="champs-2">
          <div>
            <label htmlFor={`${id}-pages`}>Nombre de pages</label>
            <input
              id={`${id}-pages`}
              type="number"
              inputMode="numeric"
              min={1}
              value={pagesTotal}
              onChange={(e) => { setPagesTotal(e.target.value) }}
              required
            />
          </div>
          <div>
            <label htmlFor={`${id}-mpp`}>Mots par page</label>
            <input
              id={`${id}-mpp`}
              type="number"
              inputMode="numeric"
              min={1}
              value={motsParPage}
              onChange={(e) => { setMotsParPage(e.target.value) }}
              required
            />
          </div>
        </div>

        <p className="aide">
          Les parties se créent, se renomment et se déplacent directement dans la grille : touchez ou glissez leur
          bandeau.
        </p>

        <label htmlFor={`${id}-modele`}>Nom des compilations</label>
        <input
          id={`${id}-modele`}
          value={modele}
          onChange={(e) => {
            setModele(e.target.value)
            e.target.setCustomValidity(
              modeleValide(e.target.value) ? '' : 'Un nom en .md contenant {n} (le numéro de version), sans dossier.',
            )
          }}
          spellCheck={false}
          autoCapitalize="none"
          required
        />
        <p className="aide">
          <code>{'{n}'}</code> est remplacé par le numéro de version.
        </p>

        <fieldset className="parties">
          <legend>Typographie pendant la frappe</legend>
          {REGLES.map((r) => (
            <label key={r.cle} className="case">
              <input
                type="checkbox"
                checked={typographie[r.cle]}
                onChange={(e) => {
                  setTypographie((t) => ({ ...t, [r.cle]: e.target.checked }))
                }}
              />
              {r.libelle}
            </label>
          ))}
          <button
            type="button"
            onClick={() => {
              normaliserTout(typographie)
            }}
          >
            Normaliser tout le manuscrit…
          </button>
        </fieldset>

        <fieldset className="parties">
          <legend>Sur cet appareil</legend>
          <label className="case">
            <input
              type="checkbox"
              checked={insecablesVisibles}
              onChange={(e) => {
                afficherInsecables(e.target.checked)
              }}
            />
            Montrer les espaces insécables dans l’éditeur
          </label>
        </fieldset>

        <div className="actions-formulaire">
          <span className="espace" />
          <button type="button" onClick={fermer}>
            Annuler
          </button>
          <button type="submit" className="bouton-principal">
            Enregistrer
          </button>
        </div>
      </form>

      <div className="zone-deconnexion">
        <button type="button" onClick={confirmerDeconnexion}>
          Se déconnecter de cet appareil
        </button>
      </div>
    </Dialogue>
  )
}
