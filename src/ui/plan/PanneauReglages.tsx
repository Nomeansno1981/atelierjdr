import { useId, useState, type SubmitEvent } from 'react'
import { nouvelIdPartie, type Reglages } from '../../domaine/operations'
import { reglesTypo, type Partie, type Plan } from '../../domaine/plan'
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
  const [parties, setParties] = useState<Partie[]>(plan.parties)
  const [typographie, setTypographie] = useState<ReglesTypo>(reglesTypo(plan))
  const insecablesVisibles = useInsecablesVisibles()
  const id = useId()
  const utilisees = new Set(plan.sections.map((s) => s.partie))

  function changerPartie(index: number, modif: Partial<Partie>) {
    setParties((ps) => ps.map((p, i) => (i === index ? { ...p, ...modif } : p)))
  }

  function deplacerPartie(index: number, sens: -1 | 1) {
    setParties((ps) => {
      const cible = index + sens
      const a = ps[index]
      const b = ps[cible]
      if (!a || !b) return ps
      const copie = [...ps]
      copie[index] = b
      copie[cible] = a
      return copie
    })
  }

  function envoyer(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    valider({
      titre,
      pagesTotal: Number.parseInt(pagesTotal, 10) || plan.livre.pagesTotal,
      motsParPage: Number.parseInt(motsParPage, 10) || plan.livre.motsParPage,
      parties: parties.map((p) => ({ ...p, titre: p.titre.trim() || 'Sans titre' })),
      typographie,
    })
  }

  function confirmerDeconnexion() {
    const perte =
      enAttente > 0
        ? `\n\nAttention : ${enAttente} modification${enAttente > 1 ? 's n’ont' : ' n’a'} pas encore été envoyée${enAttente > 1 ? 's' : ''} à GitHub et ${enAttente > 1 ? 'seront perdues' : 'sera perdue'}.`
        : ''
    const ok = window.confirm(
      `Se déconnecter efface le jeton et la copie du manuscrit sur cet appareil. Le manuscrit sur GitHub n’est pas touché.${perte}\n\nContinuer ?`,
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

        <fieldset className="parties">
          <legend>Parties, dans l’ordre</legend>
          {parties.map((p, i) => (
            <div key={p.id} className="ligne-partie">
              <input
                aria-label={`Titre de la partie ${i + 1}`}
                value={p.titre}
                onChange={(e) => {
                  changerPartie(i, { titre: e.target.value })
                }}
              />
              <label className="case">
                <input
                  type="checkbox"
                  checked={p.numerotee}
                  onChange={(e) => {
                    changerPartie(i, { numerotee: e.target.checked })
                  }}
                />
                Numérotée
              </label>
              <button
                type="button"
                className="bouton-icone"
                aria-label={`Monter ${p.titre}`}
                disabled={i === 0}
                onClick={() => {
                  deplacerPartie(i, -1)
                }}
              >
                ↑
              </button>
              <button
                type="button"
                className="bouton-icone"
                aria-label={`Descendre ${p.titre}`}
                disabled={i === parties.length - 1}
                onClick={() => {
                  deplacerPartie(i, 1)
                }}
              >
                ↓
              </button>
              <button
                type="button"
                className="bouton-icone"
                aria-label={`Retirer ${p.titre}`}
                title={utilisees.has(p.id) ? 'Cette partie contient des sections' : 'Retirer'}
                disabled={utilisees.has(p.id) || parties.length === 1}
                onClick={() => {
                  setParties((ps) => ps.filter((_, j) => j !== i))
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setParties((ps) => [...ps, { id: nouvelIdPartie('Nouvelle partie', ps), titre: 'Nouvelle partie', numerotee: true }])
            }}
          >
            Ajouter une partie
          </button>
        </fieldset>

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
