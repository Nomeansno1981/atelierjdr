import { LIBELLES_STATUT, type Plan, type Section } from '../../domaine/plan'
import { numerosDesParties } from '../../domaine/romains'
import { IconeHorsTexte } from './icones'

interface Proprietes {
  plan: Plan
  textes: ReadonlyMap<string, string>
}

interface Groupe {
  /** Plusieurs groupes peuvent partager une partie si l'ordre les sépare. */
  cle: string
  partie: string
  sections: Section[]
}

/** Regroupe les sections consécutives de même partie, dans l'ordre du plan. */
function grouper(sections: readonly Section[]): Groupe[] {
  const groupes: Groupe[] = []
  for (const s of sections) {
    const dernier = groupes.at(-1)
    if (dernier?.partie === s.partie) dernier.sections.push(s)
    else groupes.push({ cle: `${s.partie}-${s.id}`, partie: s.partie, sections: [s] })
  }
  return groupes
}

export function ListeSections({ plan, textes }: Proprietes) {
  const parties = new Map(plan.parties.map((p) => [p.id, p]))
  const numeros = numerosDesParties(plan.parties)
  const nbHorsTexte = plan.sections.filter((s) => s.type === 'hors-texte').length

  return (
    <div className="liste">
      <p className="liste-resume">
        {plan.sections.length} sections, dont {nbHorsTexte} hors-texte · {plan.parties.length}{' '}
        parties · {plan.livre.pagesTotal} pages prévues
      </p>
      {grouper(plan.sections).map((groupe) => {
        const partie = parties.get(groupe.partie)
        const numero = numeros.get(groupe.partie)
        return (
          <section key={groupe.cle} className="partie" aria-label={partie?.titre ?? groupe.partie}>
            <h2 className="partie-titre">
              {numero && <span className="partie-numero">Partie {numero}</span>}
              {partie?.titre ?? groupe.partie}
            </h2>
            <ol className="sections">
              {groupe.sections.map((s) => (
                <LigneSection key={s.id} section={s} fichierPresent={s.type !== 'texte' || textes.has(s.fichier)} />
              ))}
            </ol>
          </section>
        )
      })}
    </div>
  )
}

function LigneSection({ section, fichierPresent }: { section: Section; fichierPresent: boolean }) {
  return (
    <li className={`ligne statut-${section.statut}`} data-id={section.id}>
      <span className="pastille" title={LIBELLES_STATUT[section.statut]} aria-hidden="true" />
      <div className="ligne-corps">
        <p className="ligne-titre">
          {section.type === 'hors-texte' && <IconeHorsTexte />}
          {section.titre}
        </p>
        {section.resume && <p className="ligne-resume">{section.resume}</p>}
        <p className="ligne-meta">
          <span>{LIBELLES_STATUT[section.statut]}</span>
          <span>{section.pages} p.</span>
          {section.type === 'hors-texte' && <span>Hors-texte</span>}
          {section.debut !== 'indifferent' && <span>Commence à {section.debut}</span>}
          {!fichierPresent && <span className="alerte">Fichier absent du dépôt</span>}
        </p>
      </div>
    </li>
  )
}
