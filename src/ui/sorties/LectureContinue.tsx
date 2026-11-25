import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import { useMemo, useState } from 'react'
import { estVide } from '../../domaine/compilation'
import { paginer } from '../../domaine/pagination'
import type { Plan, Section } from '../../domaine/plan'
import { numerosDesParties } from '../../domaine/romains'
import type { EtatOuvert } from '../../etat/atelier'
import { Dialogue } from '../commun/Dialogue'
import { IconeHorsTexte } from '../commun/icones'
import { IndicateurSynchro } from '../commun/IndicateurSynchro'
import { SelecteurVue } from '../commun/SelecteurVue'
import { lireZoom } from '../preferences'
import { formaterNombre, motsParSection } from '../plan/format'
import type { Route } from '../routes'

const TIRET_CADRATIN = String.fromCharCode(0x2014)

/** CommonMark et tableaux GFM, comme l'éditeur ; le texte n'est pas retouché. */
const markdown = new MarkdownIt('commonmark', { html: true, typographer: false }).enable('table')

/** Rendu nettoyé : ni script, ni style, ni image (hors périmètre), ni gestionnaire d'événement. */
const memoire = new Map<string, string>()
function rendre(texte: string): string {
  let html = memoire.get(texte)
  if (html === undefined) {
    html = DOMPurify.sanitize(markdown.render(texte), {
      FORBID_TAGS: ['style', 'img', 'script', 'iframe', 'form', 'input'],
      FORBID_ATTR: ['style'],
    })
    if (memoire.size > 200) memoire.clear()
    memoire.set(texte, html)
  }
  return html
}

type Bloc =
  | { type: 'partie'; cle: string; titre: string }
  | { type: 'section'; section: Section; pages: string }

interface Proprietes {
  etat: EtatOuvert
  plan: Plan
  naviguer: (route: Route) => void
}

/** Toutes les sections à la suite, rendues en HTML, avec les titres insérés comme à la compilation. */
export default function LectureContinue({ etat, plan, naviguer }: Proprietes) {
  const textes = useMemo(() => etat.manuscrit?.textes ?? new Map<string, string>(), [etat.manuscrit])
  const [masquerVides, setMasquerVides] = useState(false)
  const [sommaire, setSommaire] = useState(false)
  const mots = useMemo(() => motsParSection(plan, textes), [plan, textes])

  const blocs = useMemo(() => {
    const pagination = paginer(plan.sections, plan.livre.premierePage)
    const numeros = numerosDesParties(plan.parties)
    const parties = new Map(plan.parties.map((p) => [p.id, p]))
    const liste: Bloc[] = []
    let partiePrecedente: string | null = null
    for (const s of plan.sections) {
      const vide = s.type === 'texte' && estVide(textes.get(s.id) ?? '')
      if (masquerVides && vide && s.statut === 'a-ecrire') continue
      if (s.partie !== partiePrecedente) {
        const titre = parties.get(s.partie)?.titre ?? s.partie
        const n = numeros.get(s.partie)
        liste.push({ type: 'partie', cle: `${s.partie}-${s.id}`, titre: n ? `Partie ${n} ${TIRET_CADRATIN} ${titre}` : titre })
        partiePrecedente = s.partie
      }
      const e = pagination.emplacements.get(s.id)
      const pages = e ? (e.premiere === e.derniere ? `p. ${e.premiere}` : `p. ${e.premiere}-${e.derniere}`) : ''
      liste.push({ type: 'section', section: s, pages })
    }
    return liste
  }, [plan, textes, masquerVides])

  function allerA(cle: string) {
    setSommaire(false)
    document.getElementById(cle)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const tableDesMatieres = (
    <nav aria-label="Table des matières">
      <ol className="sommaire">
        {blocs.map((b) =>
          b.type === 'partie' ? (
            <li key={b.cle} className="sommaire-partie">
              <button type="button" onClick={() => { allerA(`lecture-${b.cle}`) }}>
                {b.titre}
              </button>
            </li>
          ) : (
            <li key={b.section.id}>
              <button type="button" onClick={() => { allerA(`lecture-${b.section.id}`) }}>
                {b.section.type === 'hors-texte' && <IconeHorsTexte />}
                {b.section.titre}
              </button>
            </li>
          ),
        )}
      </ol>
    </nav>
  )

  return (
    <div className="mode-lecture">
      <aside className="colonne-sections">{tableDesMatieres}</aside>
      <div>
        <div className="barre barre-redaction">
          {/* Le sélecteur de vue ramène au plan : pas de bouton « ← Plan » en double. */}
          <div className="barre-ligne barre-lecture">
            <button type="button" className="bouton-tiroir" onClick={() => { setSommaire(true) }}>
              Sommaire
            </button>
            <SelecteurVue vue="lecture" zoom={lireZoom()} naviguer={naviguer} />
            <span className="espace" />
            <IndicateurSynchro synchro={etat.synchro} enAttente={etat.enAttente} conflit={etat.conflit !== null} />
          </div>
        </div>

        <main className="lecture">
          <header className="lecture-entete">
            <h1>{plan.livre.titre}</h1>
            <label className="case">
              <input type="checkbox" checked={masquerVides} onChange={(e) => { setMasquerVides(e.target.checked) }} />
              Masquer les sections « à écrire » vides
            </label>
          </header>

          {blocs.map((b) => {
            if (b.type === 'partie') {
              return (
                <h1 key={b.cle} id={`lecture-${b.cle}`} className="lecture-partie">
                  {b.titre}
                </h1>
              )
            }
            const s = b.section
            if (s.type === 'blanche') {
              return (
                <aside key={s.id} id={`lecture-${s.id}`} className="encadre-hors-texte encadre-blanche">
                  <p>
                    {s.titre}, {b.pages}
                  </p>
                </aside>
              )
            }
            if (s.type === 'hors-texte') {
              return (
                <aside key={s.id} id={`lecture-${s.id}`} className="encadre-hors-texte">
                  <p>
                    <IconeHorsTexte /> <strong>{s.titre}</strong>, {b.pages}
                  </p>
                  {s.resume && <p className="aide">{s.resume}</p>}
                </aside>
              )
            }
            const texte = textes.get(s.id) ?? ''
            const m = mots.get(s.id)
            return (
              <article key={s.id} id={`lecture-${s.id}`} className="lecture-section">
                <h2>
                  <button
                    type="button"
                    title="Ouvrir dans l’éditeur"
                    onClick={() => {
                      naviguer({ vue: 'section', id: s.id, selection: null })
                    }}
                  >
                    {s.titre}
                  </button>
                </h2>
                <p className="repere">
                  {b.pages}
                  {m && ` · ${formaterNombre(m.ecrits)} / ${formaterNombre(m.cible)} mots`}
                </p>
                {estVide(texte) ? (
                  <p className="aide section-vide">Section vide.</p>
                ) : (
                  // Rendu passé par DOMPurify (voir rendre()).
                  <div className="lecture-texte" dangerouslySetInnerHTML={{ __html: rendre(texte) }} />
                )}
              </article>
            )
          })}
        </main>
      </div>

      {sommaire && (
        <Dialogue titre="Sommaire" onFermer={() => { setSommaire(false) }}>
          {tableDesMatieres}
        </Dialogue>
      )}
    </div>
  )
}
