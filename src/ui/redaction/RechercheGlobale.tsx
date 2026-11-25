import { useDeferredValue, useId, useMemo, useState, type SubmitEvent } from 'react'
import type { Plan } from '../../domaine/plan'
import { rechercher, type Occurrence } from '../../domaine/recherche'
import {
  adapterCasse,
  LIBELLES_CHAMP,
  rechercherPartout,
  type Champ,
  type OccurrenceChoisie,
  type ResultatRemplacement,
} from '../../domaine/remplacement'
import { Dialogue } from '../commun/Dialogue'

interface Remplacement {
  /** Applique les remplacements choisis (le texte de remplacement est déjà mis en forme). */
  appliquer: (choix: OccurrenceChoisie[], requete: string, remplacement: string) => void
  /** Convention typographique du livre, appliquée au texte de remplacement. */
  typographie: (texte: string) => string
}

interface Proprietes {
  plan: Plan
  textes: ReadonlyMap<string, string>
  ouvrir: (id: string, debut: number, fin: number) => void
  /** Depuis le plan seulement : on peut aussi remplacer. */
  remplacement?: Remplacement
  fermer: () => void
}

const cleOccurrence = (id: string, champ: Champ, o: Occurrence) => `${id}|${champ}|${o.debut}`

/**
 * Recherche dans tout le manuscrit (Cmd/Ctrl+Maj+F), résultats groupés par
 * section. Depuis le plan, elle remplace aussi : textes, titres et résumés,
 * avec un aperçu de chaque occurrence, que l'on peut décocher.
 */
export function RechercheGlobale({ plan, textes, ouvrir, remplacement, fermer }: Proprietes) {
  const [requete, setRequete] = useState('')
  const [remplacerPar, setRemplacerPar] = useState('')
  const [motEntier, setMotEntier] = useState(false)
  // Occurrences décochées, pour une recherche donnée (une autre recherche les oublie).
  const [exclues, setExclues] = useState<{ pour: string; cles: ReadonlySet<string> }>({ pour: '', cles: new Set() })
  const differee = useDeferredValue(requete)
  const id = useId()
  const avecRemplacement = remplacement !== undefined

  const resultats: ResultatRemplacement[] = useMemo(() => {
    if (avecRemplacement) return rechercherPartout(plan, textes, differee, motEntier)
    const sections = plan.sections.flatMap((s) =>
      s.type === 'texte' ? [{ id: s.id, titre: s.titre, texte: textes.get(s.id) ?? '' }] : [],
    )
    return rechercher(sections, differee).map((r) => ({ ...r, champ: 'texte' as const }))
  }, [avecRemplacement, plan, textes, differee, motEntier])

  const pour = `${differee}|${String(motEntier)}`
  const decochees = exclues.pour === pour ? exclues.cles : new Set<string>()
  const total = resultats.reduce((n, r) => n + r.occurrences.length, 0)
  const nbSections = new Set(resultats.map((r) => r.id)).size
  const choisies: OccurrenceChoisie[] = resultats.flatMap((r) =>
    r.occurrences
      .filter((o) => !decochees.has(cleOccurrence(r.id, r.champ, o)))
      .map((o) => ({ id: r.id, champ: r.champ, debut: o.debut, fin: o.fin, trouve: o.trouve })),
  )
  const remplace = remplacement ? remplacement.typographie(remplacerPar) : ''
  const enRemplacement = avecRemplacement && remplacerPar.trim() !== ''

  function basculer(cle: string) {
    const cles = new Set(decochees)
    if (cles.has(cle)) cles.delete(cle)
    else cles.add(cle)
    setExclues({ pour, cles })
  }

  function envoyer(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!remplacement || !enRemplacement || choisies.length === 0 || requete !== differee) return
    remplacement.appliquer(choisies, differee.trim(), remplace)
  }

  // Groupes par section, dans l'ordre du plan.
  const groupes = new Map<string, ResultatRemplacement[]>()
  for (const r of resultats) groupes.set(r.id, [...(groupes.get(r.id) ?? []), r])

  return (
    <Dialogue titre={avecRemplacement ? 'Chercher et remplacer' : 'Chercher dans le manuscrit'} onFermer={fermer}>
      <form className="recherche" onSubmit={envoyer}>
        <label htmlFor={id} className={avecRemplacement ? undefined : 'lecteur-ecran'}>
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
        {avecRemplacement && (
          <>
            <label htmlFor={`${id}-par`}>Remplacer par</label>
            <input
              id={`${id}-par`}
              value={remplacerPar}
              placeholder="Laisser vide pour seulement chercher"
              autoComplete="off"
              onChange={(e) => {
                setRemplacerPar(e.target.value)
              }}
            />
            <label className="case">
              <input
                type="checkbox"
                checked={motEntier}
                onChange={(e) => {
                  setMotEntier(e.target.checked)
                }}
              />
              Mot entier seulement
            </label>
          </>
        )}
        <p className="aide" role="status">
          {differee.trim().length < 2
            ? 'Au moins deux caractères. Ni la casse ni les accents ne comptent.'
            : total === 0
              ? 'Aucun résultat.'
              : `${total} résultat${total > 1 ? 's' : ''} dans ${nbSections} section${nbSections > 1 ? 's' : ''}.`}
          {enRemplacement &&
            total > 0 &&
            ' Décochez ce qu’il ne faut pas remplacer. La majuscule initiale ou les capitales sont conservées.'}
        </p>
        {enRemplacement && (
          <button type="submit" className="bouton-principal" disabled={choisies.length === 0 || requete !== differee}>
            Remplacer {choisies.length} occurrence{choisies.length > 1 ? 's' : ''}
          </button>
        )}
        <div className="resultats">
          {[...groupes.entries()].map(([idSection, liste]) => (
            <section key={idSection} aria-label={liste[0]?.titre}>
              <h3>{liste[0]?.titre}</h3>
              <ul>
                {liste.flatMap((r) =>
                  r.occurrences.map((o) => {
                    const cle = cleOccurrence(r.id, r.champ, o)
                    const champ = r.champ === 'texte' ? null : <span className="champ">{LIBELLES_CHAMP[r.champ]} : </span>
                    return (
                      <li key={cle}>
                        {enRemplacement ? (
                          <label className="occurrence">
                            <input
                              type="checkbox"
                              checked={!decochees.has(cle)}
                              onChange={() => {
                                basculer(cle)
                              }}
                            />
                            <span>
                              {champ}
                              {o.avant}
                              <del>{o.trouve}</del>
                              <ins>{adapterCasse(o.trouve, remplace)}</ins>
                              {o.apres}
                            </span>
                          </label>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (r.champ === 'texte') ouvrir(r.id, o.debut, o.fin)
                              else ouvrir(r.id, 0, 0)
                            }}
                          >
                            {champ}
                            {o.avant}
                            <mark>{o.trouve}</mark>
                            {o.apres}
                          </button>
                        )}
                      </li>
                    )
                  }),
                )}
              </ul>
            </section>
          ))}
        </div>
      </form>
    </Dialogue>
  )
}
