import { memo, useDeferredValue, useEffect, useMemo, useState, type KeyboardEvent as EvenementClavier } from 'react'
import { depasseLaCible, cibleMots } from '../../domaine/mots'
import { changerPages, modifierSection } from '../../domaine/operations'
import { LIBELLES_STATUT, STATUTS, type Plan, type SectionTexte, type Statut } from '../../domaine/plan'
import { titresReserves } from '../../domaine/titres'
import type { Atelier, EtatOuvert } from '../../etat/atelier'
import { Dialogue } from '../commun/Dialogue'
import { IconeHorsTexte, IconeMoins, IconePlus } from '../commun/icones'
import { IndicateurSynchro } from '../commun/IndicateurSynchro'
import { formaterNombre, motsDe, motsParSection, type MotsSection } from '../plan/format'
import type { Route, Selection } from '../routes'
import { Editeur } from './Editeur'
import { RechercheGlobale } from './RechercheGlobale'

interface Proprietes {
  atelier: Atelier
  etat: EtatOuvert
  plan: Plan
  id: string
  selection: Selection | null
  naviguer: (route: Route) => void
}

export function ModeRedaction({ atelier, etat, plan, id, selection, naviguer }: Proprietes) {
  const manuscrit = etat.manuscrit
  const section = plan.sections.find((s): s is SectionTexte => s.id === id && s.type === 'texte')
  const textes = useMemo(() => manuscrit?.textes ?? new Map<string, string>(), [manuscrit])
  const [tiroir, setTiroir] = useState(false)
  const [recherche, setRecherche] = useState(false)
  const [concentration, setConcentration] = useState(false)
  // Texte tapé, pour le compteur en direct (le contrôleur publie avec un léger différé).
  const [frappe, setFrappe] = useState<{ id: string; texte: string } | null>(null)

  const texteCourant = frappe?.id === id ? frappe.texte : (textes.get(id) ?? '')
  // Compteur et signalements suivent la frappe sans la ralentir.
  const texteDiffere = useDeferredValue(texteCourant)
  const motsCourants = motsDe(texteDiffere)
  const reserves = useMemo(() => titresReserves(texteDiffere), [texteDiffere])
  const mots = useMemo(() => motsParSection(plan, textes), [plan, textes])
  const ordre = plan.sections.filter((s): s is SectionTexte => s.type === 'texte')
  const position = ordre.findIndex((s) => s.id === id)
  const precedente = ordre[position - 1]
  const suivante = ordre[position + 1]

  function aller(route: Route) {
    void atelier.envoyerMaintenant()
    setTiroir(false)
    naviguer(route)
  }

  // Cmd/Ctrl+S et Cmd/Ctrl+Maj+F, même hors de l'éditeur ; Échap quitte la concentration.
  useEffect(() => {
    function surTouche(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void atelier.envoyerMaintenant()
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setRecherche(true)
      } else if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
        setConcentration(false)
      }
    }
    document.addEventListener('keydown', surTouche)
    return () => {
      document.removeEventListener('keydown', surTouche)
    }
  }, [atelier])

  // Hauteur de la barre fixe, pour placer le panneau de recherche de l'éditeur dessous.
  useEffect(() => {
    const barre = document.querySelector<HTMLElement>('.barre-redaction')
    if (!barre) return
    const mesurer = () => {
      document.documentElement.style.setProperty('--haut-barre', `${barre.offsetHeight}px`)
    }
    mesurer()
    const observateur = new ResizeObserver(mesurer)
    observateur.observe(barre)
    return () => {
      observateur.disconnect()
    }
  }, [concentration])

  if (!section) {
    return (
      <main className="ecran-centre">
        <p role="alert">Cette section n’existe pas, ou n’est pas une section de texte.</p>
        <button type="button" onClick={() => { naviguer({ vue: 'plan' }) }}>
          Retour au plan
        </button>
      </main>
    )
  }

  const cible = cibleMots(section, plan.livre.motsParPage)
  const conflit = manuscrit?.conflitsTexte.get(id)
  const { proprietaire, nom } = etat.connexion.depot
  const historique = `https://github.com/${proprietaire}/${nom}/commits/${encodeURIComponent(etat.connexion.branche)}/${section.fichier}`

  const navigation = (
    <NavSections
      plan={plan}
      mots={mots}
      courante={id}
      ouvrir={(cibleId) => {
        aller({ vue: 'section', id: cibleId, selection: null })
      }}
    />
  )

  return (
    <div className={`mode-redaction${concentration ? ' concentration' : ''}`}>
      <aside className="colonne-sections" aria-label="Sections">
        {navigation}
      </aside>

      <div className="redaction">
        {/* Seule cette ligne reste fixe : sur téléphone, le clavier prend déjà la moitié de l'écran. */}
        <div className="barre barre-redaction">
          <div className="barre-ligne">
            <button type="button" className="bouton-retour" onClick={() => { aller({ vue: 'plan' }) }}>
              ← Plan
            </button>
            <button type="button" className="bouton-tiroir" onClick={() => { setTiroir(true) }}>
              Sections
            </button>
            <span className="espace" />
            <IndicateurSynchro
              synchro={etat.synchro}
              enAttente={etat.enAttente}
              conflit={etat.conflit !== null || conflit !== undefined}
            />
          </div>
        </div>

        <header className="entete-section">
          <ChampTitre
            key={section.id + section.titre}
            titre={section.titre}
            valider={(titre) => {
              atelier.modifierPlan((p) => modifierSection(p, id, { titre }), `modification de ${section.titre}`)
            }}
          />

          <div className="barre-outils outils-redaction">
            <label className="champ-compact">
              <span className="lecteur-ecran">Statut</span>
              <select
                value={section.statut}
                className={`statut-${section.statut}`}
                onChange={(e) => {
                  const statut = e.target.value as Statut
                  atelier.modifierPlan((p) => modifierSection(p, id, { statut }), `${section.titre} : ${LIBELLES_STATUT[statut].toLowerCase()}`)
                }}
              >
                {STATUTS.map((s) => (
                  <option key={s} value={s}>
                    {LIBELLES_STATUT[s]}
                  </option>
                ))}
              </select>
            </label>
            <div className="pages-redaction">
              <button
                type="button"
                className="bouton-icone"
                aria-label="Une page de moins"
                disabled={section.pages <= 1}
                onClick={() => {
                  atelier.modifierPlan((p) => changerPages(p, id, -1), `${section.titre} sur ${section.pages - 1} page${section.pages - 1 > 1 ? 's' : ''}`)
                }}
              >
                <IconeMoins />
              </button>
              <span>{section.pages} p.</span>
              <button
                type="button"
                className="bouton-icone"
                aria-label="Une page de plus"
                onClick={() => {
                  atelier.modifierPlan((p) => changerPages(p, id, 1), `${section.titre} sur ${section.pages + 1} pages`)
                }}
              >
                <IconePlus />
              </button>
            </div>
            <Compteur ecrits={motsCourants} cible={cible} />
            <span className="espace" />
            <button
              type="button"
              aria-label="Section précédente"
              title={precedente?.titre}
              disabled={!precedente}
              onClick={() => {
                if (precedente) aller({ vue: 'section', id: precedente.id, selection: null })
              }}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Section suivante"
              title={suivante?.titre}
              disabled={!suivante}
              onClick={() => {
                if (suivante) aller({ vue: 'section', id: suivante.id, selection: null })
              }}
            >
              ›
            </button>
            <button type="button" onClick={() => { setRecherche(true) }} title="Cmd/Ctrl+Maj+F">
              Chercher
            </button>
            <button
              type="button"
              aria-pressed={concentration}
              onClick={() => {
                setConcentration((c) => !c)
              }}
            >
              Concentration
            </button>
          </div>
        </header>

        {conflit && (
          <div className="bandeau bandeau-attention bandeau-actions" role="alert">
            <p>
              Ce texte a aussi été modifié sur un autre appareil. Rien n’a été écrasé : votre version est sauvegardée dans{' '}
              <code>{conflit}</code>, celle de GitHub est restée en place.
            </p>
            <div>
              <button type="button" onClick={() => void atelier.resoudreConflitTexte(id, 'local')}>
                Garder la mienne
              </button>
              <button
                type="button"
                onClick={() => {
                  const ok = window.confirm(
                    `Le texte de GitHub va remplacer celui de cet appareil. Votre version reste sauvegardée dans ${conflit}. Continuer ?`,
                  )
                  if (ok) void atelier.resoudreConflitTexte(id, 'distant')
                }}
              >
                Prendre celle de GitHub
              </button>
            </div>
          </div>
        )}
        {reserves.length > 0 && (
          <p className="bandeau bandeau-attention" role="status">
            {reserves.length === 1 ? 'Ligne' : 'Lignes'} {reserves.map((r) => r.ligne).join(', ')} : les titres <code>#</code> et{' '}
            <code>##</code> sont réservés à la compilation. Commencez vos intertitres à <code>###</code>.
          </p>
        )}
        {etat.synchro.etat === 'erreur' && (
          <p className="bandeau bandeau-erreur" role="alert">
            {etat.synchro.message}
          </p>
        )}

        <main className="zone-texte">
          <Editeur
            id={id}
            texte={textes.get(id) ?? ''}
            texteDistant={manuscrit?.textesDistants.get(id) ?? ''}
            modifie={manuscrit?.textesModifies.has(id) ?? false}
            selection={selection}
            changer={(idTexte, contenu) => {
              setFrappe({ id: idTexte, texte: contenu })
              atelier.modifierTexte(idTexte, contenu)
            }}
            envoyer={() => void atelier.envoyerMaintenant()}
            rechercheGlobale={() => {
              setRecherche(true)
            }}
          />
          <p className="pied-texte">
            <a href={historique} target="_blank" rel="noopener noreferrer">
              Voir l’historique sur GitHub
            </a>
          </p>
        </main>
      </div>

      {concentration && (
        <button type="button" className="sortie-concentration" onClick={() => { setConcentration(false) }}>
          Quitter la concentration
        </button>
      )}

      {tiroir && (
        <Dialogue titre="Sections" onFermer={() => { setTiroir(false) }}>
          {navigation}
        </Dialogue>
      )}
      {recherche && (
        <RechercheGlobale
          plan={plan}
          textes={textes}
          ouvrir={(cibleId, debut, fin) => {
            setRecherche(false)
            aller({ vue: 'section', id: cibleId, selection: { debut, fin } })
          }}
          fermer={() => {
            setRecherche(false)
          }}
        />
      )}
    </div>
  )
}

function Compteur({ ecrits, cible }: { ecrits: number; cible: number }) {
  const ratio = cible > 0 ? Math.min(1, ecrits / cible) : 0
  return (
    <span className={`compteur-mots jauge${depasseLaCible(ecrits, cible) ? ' jauge-depasse' : ''}`}>
      <span className="jauge-chiffres">
        {formaterNombre(ecrits)} / {formaterNombre(cible)} mots
      </span>
      <span className="jauge-barre" aria-hidden="true">
        <span className="jauge-remplie" style={{ width: `${ratio * 100}%` }} />
      </span>
    </span>
  )
}

/** Titre modifiable : validé à la sortie du champ ou sur Entrée ; Échap annule. */
function ChampTitre({ titre, valider }: { titre: string; valider: (titre: string) => void }) {
  const [valeur, setValeur] = useState(titre)
  function terminer() {
    const propre = valeur.trim()
    if (propre && propre !== titre) valider(propre)
    else setValeur(titre)
  }
  return (
    <input
      className="champ-titre"
      aria-label="Titre de la section"
      value={valeur}
      onChange={(e) => {
        setValeur(e.target.value)
      }}
      onBlur={terminer}
      onKeyDown={(e: EvenementClavier<HTMLInputElement>) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setValeur(titre)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

interface ProprietesNav {
  plan: Plan
  mots: ReadonlyMap<string, MotsSection>
  courante: string
  ouvrir: (id: string) => void
}

/** Toutes les sections dans l'ordre du plan, avec statut et jauge. */
const NavSections = memo(function NavSections({ plan, mots, courante, ouvrir }: ProprietesNav) {
  return (
    <ol className="nav-sections">
      {plan.sections.map((s) => {
        const m = mots.get(s.id)
        const contenu = (
          <>
            <span className={`pastille statut-${s.statut}`} title={LIBELLES_STATUT[s.statut]} aria-hidden="true" />
            <span className="nav-titre">
              {s.type === 'hors-texte' && <IconeHorsTexte />}
              {s.titre}
            </span>
            {m && (
              <span className={`nav-jauge jauge${depasseLaCible(m.ecrits, m.cible) ? ' jauge-depasse' : ''}`} aria-hidden="true">
                <span className="jauge-barre">
                  <span className="jauge-remplie" style={{ width: `${Math.min(1, m.cible ? m.ecrits / m.cible : 0) * 100}%` }} />
                </span>
              </span>
            )}
          </>
        )
        return (
          <li key={s.id} className={s.id === courante ? 'courante' : undefined}>
            {s.type === 'texte' ? (
              <button
                type="button"
                aria-current={s.id === courante ? 'page' : undefined}
                onClick={() => {
                  ouvrir(s.id)
                }}
              >
                {contenu}
              </button>
            ) : (
              <span className="nav-hors-texte">{contenu}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
})
