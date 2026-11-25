import { useDeferredValue, useId, useMemo, useState } from 'react'
import type { Plan } from '../../domaine/plan'
import { rechercher } from '../../domaine/recherche'
import { Dialogue } from '../commun/Dialogue'

interface Proprietes {
  plan: Plan
  textes: ReadonlyMap<string, string>
  ouvrir: (id: string, debut: number, fin: number) => void
  fermer: () => void
}

/** Recherche dans tout le manuscrit (Cmd/Ctrl+Maj+F), résultats groupés par section. */
export function RechercheGlobale({ plan, textes, ouvrir, fermer }: Proprietes) {
  const [requete, setRequete] = useState('')
  const differee = useDeferredValue(requete)
  const id = useId()
  const resultats = useMemo(() => {
    const sections = plan.sections.flatMap((s) =>
      s.type === 'texte' ? [{ id: s.id, titre: s.titre, texte: textes.get(s.id) ?? '' }] : [],
    )
    return rechercher(sections, differee)
  }, [plan.sections, textes, differee])
  const total = resultats.reduce((n, r) => n + r.occurrences.length, 0)

  return (
    <Dialogue titre="Chercher dans le manuscrit" onFermer={fermer}>
      <div className="recherche">
        <label htmlFor={id} className="lecteur-ecran">
          Texte à chercher
        </label>
        <input
          id={id}
          type="search"
          value={requete}
          placeholder="Texte à chercher"
          autoFocus
          autoComplete="off"
          onChange={(e) => {
            setRequete(e.target.value)
          }}
        />
        <p className="aide" role="status">
          {differee.trim().length < 2
            ? 'Au moins deux caractères. Ni la casse ni les accents ne comptent.'
            : total === 0
              ? 'Aucun résultat.'
              : `${total} résultat${total > 1 ? 's' : ''} dans ${resultats.length} section${resultats.length > 1 ? 's' : ''}.`}
        </p>
        <div className="resultats">
          {resultats.map((r) => (
            <section key={r.id} aria-label={r.titre}>
              <h3>{r.titre}</h3>
              <ul>
                {r.occurrences.map((o) => (
                  <li key={o.debut}>
                    <button
                      type="button"
                      onClick={() => {
                        ouvrir(r.id, o.debut, o.fin)
                      }}
                    >
                      {o.avant}
                      <mark>{o.trouve}</mark>
                      {o.apres}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Dialogue>
  )
}
