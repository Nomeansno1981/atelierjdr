import { useId, useState, type SubmitEvent } from 'react'
import type { ModificationSection } from '../../domaine/operations'
import type { Emplacement } from '../../domaine/pagination'
import { DEBUTS, LIBELLES_STATUT, STATUTS, type Debut, type Plan, type Section, type Statut } from '../../domaine/plan'
import { Dialogue } from '../commun/Dialogue'
import { formaterNombre, type MotsSection } from './format'

export const LIBELLES_DEBUT: Record<Debut, string> = {
  indifferent: 'Indifférent',
  gauche: 'Page de gauche (ouvre une double page)',
  droite: 'Page de droite',
}

interface Proprietes {
  plan: Plan
  section: Section
  emplacement: Emplacement | undefined
  mots: MotsSection | undefined
  valider: (modif: Partial<ModificationSection>) => void
  supprimer: () => void
  fermer: () => void
}

/** Panneau de modification d'une section : titre, résumé, partie, statut, pages, début, mots par page. */
export function PanneauSection({ plan, section, emplacement, mots, valider, supprimer, fermer }: Proprietes) {
  const [titre, setTitre] = useState(section.titre)
  const [resume, setResume] = useState(section.resume)
  const [partie, setPartie] = useState(section.partie)
  const [statut, setStatut] = useState<Statut>(section.statut)
  const [pages, setPages] = useState(String(section.pages))
  const [debut, setDebut] = useState<Debut>(section.debut)
  const [motsParPage, setMotsParPage] = useState(
    section.type === 'texte' && section.motsParPage !== null ? String(section.motsParPage) : '',
  )
  const id = useId()

  function envoyer(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const modif: Partial<ModificationSection> = {
      titre,
      resume: resume.trim(),
      partie,
      statut,
      pages: Math.max(1, Number.parseInt(pages, 10) || 1),
      debut,
    }
    if (section.type === 'texte') {
      const n = Number.parseInt(motsParPage, 10)
      modif.motsParPage = Number.isFinite(n) && n > 0 ? n : null
    }
    valider(modif)
  }

  const infos = [
    emplacement &&
      (emplacement.premiere === emplacement.derniere
        ? `Page ${emplacement.premiere}`
        : `Pages ${emplacement.premiere} à ${emplacement.derniere}`),
    mots && `${formaterNombre(mots.ecrits)} / ${formaterNombre(mots.cible)} mots`,
    section.type === 'texte' ? section.fichier : section.type === 'blanche' ? 'Page laissée blanche' : 'Hors-texte',
  ].filter(Boolean)

  return (
    <Dialogue
      titre={section.type === 'hors-texte' ? 'Hors-texte' : section.type === 'blanche' ? 'Page blanche' : 'Section'}
      onFermer={fermer}
    >
      <form className="formulaire" onSubmit={envoyer}>
        <p className="aide">{infos.join(' · ')}</p>

        <label htmlFor={`${id}-titre`}>Titre</label>
        <input id={`${id}-titre`} value={titre} onChange={(e) => { setTitre(e.target.value) }} required />

        <label htmlFor={`${id}-resume`}>Résumé</label>
        <textarea id={`${id}-resume`} value={resume} rows={2} onChange={(e) => { setResume(e.target.value) }} />

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
          {/* Une page blanche n'a pas de statut : il n'y a rien à y écrire. */}
          {section.type !== 'blanche' && (
            <div>
              <label htmlFor={`${id}-statut`}>Statut</label>
              <select id={`${id}-statut`} value={statut} onChange={(e) => { setStatut(e.target.value as Statut) }}>
                {STATUTS.map((s) => (
                  <option key={s} value={s}>
                    {LIBELLES_STATUT[s]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="champs-2">
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
          <div>
            <label htmlFor={`${id}-debut`}>Commence</label>
            <select id={`${id}-debut`} value={debut} onChange={(e) => { setDebut(e.target.value as Debut) }}>
              {DEBUTS.map((d) => (
                <option key={d} value={d}>
                  {LIBELLES_DEBUT[d]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {section.type === 'texte' && (
          <>
            <label htmlFor={`${id}-mpp`}>Mots par page</label>
            <input
              id={`${id}-mpp`}
              type="number"
              inputMode="numeric"
              min={1}
              value={motsParPage}
              placeholder={`${plan.livre.motsParPage} (valeur du livre)`}
              onChange={(e) => { setMotsParPage(e.target.value) }}
            />
          </>
        )}

        <div className="actions-formulaire">
          <button type="button" className="bouton-danger" onClick={supprimer}>
            Supprimer
          </button>
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
