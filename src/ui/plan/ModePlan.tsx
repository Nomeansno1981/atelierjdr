import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  changerPages,
  creerSection,
  deplacer,
  modifierReglages,
  modifierSection,
  nouvelId,
  restaurerSection,
  supprimerSection,
} from '../../domaine/operations'
import { paginer, type Pagination } from '../../domaine/pagination'
import { LIBELLES_STATUT, reglesTypo, STATUTS, type Plan } from '../../domaine/plan'
import { normaliser } from '../../domaine/typographie/normaliser'
import type { ReglesTypo } from '../../domaine/typographie/regles'
import type { Atelier, EtatOuvert } from '../../etat/atelier'
import { RechercheGlobale } from '../redaction/RechercheGlobale'
import type { Route } from '../routes'
import { IconeAnnuler, IconeChevron, IconeCorbeille, IconeReglages, IconeRetablir, IconeSynchro } from '../commun/icones'
import { PanneauLivres } from '../livres/PanneauLivres'
import { BandeauFusion } from '../commun/BandeauFusion'
import { IndicateurSynchro } from '../commun/IndicateurSynchro'
import { SelecteurVue } from '../commun/SelecteurVue'
import { lireZoom, type Zoom } from '../preferences'
import { formaterNombre, motsParSection, type MotsSection } from './format'
import { Grille } from './Grille'
import { PanneauCorbeille } from './PanneauCorbeille'
import { PanneauCreation } from './PanneauCreation'
import { PanneauReglages } from './PanneauReglages'
import { PanneauSection } from './PanneauSection'

const PanneauCompilation = lazy(() => import('../sorties/PanneauCompilation'))

type Panneau =
  | { type: 'section'; id: string }
  | { type: 'recherche' }
  | { type: 'compilation' }
  | { type: 'creation'; index: number }
  | { type: 'corbeille' }
  | { type: 'reglages' }
  | { type: 'livres' }

const DUREE_BANDEAU_MS = 10_000

function champDeSaisie(cible: EventTarget | null): boolean {
  return (
    cible instanceof HTMLElement &&
    (cible.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(cible.tagName))
  )
}

interface Proprietes {
  atelier: Atelier
  etat: EtatOuvert
  plan: Plan
  naviguer: (route: Route) => void
}

export function ModePlan({ atelier, etat, plan, naviguer }: Proprietes) {
  const textes = etat.manuscrit?.textes
  const [panneau, setPanneau] = useState<Panneau | null>(null)
  const [supprimee, setSupprimee] = useState<{ id: string; titre: string } | null>(null)
  const [zoom, setZoom] = useState<Zoom>(lireZoom)
  const menu = useRef<HTMLDetailsElement>(null)

  const mots = useMemo(() => motsParSection(plan, textes ?? new Map<string, string>()), [plan, textes])
  const pagination = useMemo(() => paginer(plan.sections, plan.livre.premierePage), [plan.sections, plan.livre.premierePage])

  // Le bandeau « Section supprimée. Annuler » reste 10 secondes.
  useEffect(() => {
    if (!supprimee) return
    const minuterie = setTimeout(() => {
      setSupprimee(null)
    }, DUREE_BANDEAU_MS)
    return () => {
      clearTimeout(minuterie)
    }
  }, [supprimee])

  // Cmd/Ctrl+Z et Cmd/Ctrl+Maj+Z, hors des champs de saisie et des panneaux ;
  // Cmd/Ctrl+Maj+F pour chercher dans tout le manuscrit.
  useEffect(() => {
    function surTouche(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setPanneau({ type: 'recherche' })
        return
      }
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      if (champDeSaisie(e.target) || document.querySelector('dialog[open]')) return
      e.preventDefault()
      if (e.shiftKey) atelier.retablir()
      else atelier.annuler()
    }
    document.addEventListener('keydown', surTouche)
    return () => {
      document.removeEventListener('keydown', surTouche)
    }
  }, [atelier])

  const titre = (id: string) => plan.sections.find((s) => s.id === id)?.titre ?? ''
  const depot = etat.connexion.depot
  const cleDepot = `${depot.proprietaire}/${depot.nom}`.toLowerCase()

  function choisir(action: () => void) {
    if (menu.current) menu.current.open = false
    action()
  }

  /** Archive .zip du manuscrit, depuis l'appareil : utilisable même si GitHub ne répond pas. */
  async function exporter() {
    const { archiveManuscrit, nomArchive, telecharger } = await import('../sorties/fichiers')
    telecharger(nomArchive(plan, new Date()), archiveManuscrit(plan, textes ?? new Map<string, string>()), 'application/zip')
  }
  /** Titres et résumés suivent la convention typographique, une fois validés. */
  const typo = (texte: string) => normaliser(texte, reglesTypo(plan)).texte

  /** Annonce le nombre de remplacements dans tout le manuscrit, puis les applique. */
  function normaliserTout(regles: ReglesTypo) {
    const changements: [string, string][] = []
    let total = 0
    for (const s of plan.sections) {
      if (s.type !== 'texte') continue
      const r = normaliser(textes?.get(s.id) ?? '', regles)
      if (r.remplacements > 0) {
        changements.push([s.id, r.texte])
        total += r.remplacements
      }
    }
    if (total === 0) {
      window.alert('Rien à normaliser : tout le manuscrit suit déjà la convention typographique.')
      return
    }
    const ok = window.confirm(
      `${total} remplacement${total > 1 ? 's' : ''} typographique${total > 1 ? 's' : ''} dans ${changements.length} section${changements.length > 1 ? 's' : ''}. Les appliquer ? Les versions actuelles resteront dans l’historique GitHub.`,
    )
    if (!ok) return
    for (const [id, texte] of changements) atelier.modifierTexte(id, texte)
    void atelier.envoyerMaintenant()
  }

  const sectionOuverte = panneau?.type === 'section' ? plan.sections.find((s) => s.id === panneau.id) : undefined

  return (
    <div className="mode-plan" data-zoom={zoom}>
      <header className="barre barre-plan">
        <div className="barre-ligne">
          <h1 className="barre-titre barre-titre-livre">
            <button
              type="button"
              className="titre-livre"
              title="Changer de livre"
              aria-haspopup="dialog"
              aria-label={`${plan.livre.titre}, changer de livre`}
              onClick={() => {
                setPanneau({ type: 'livres' })
              }}
            >
              <span className="titre-livre-texte">{plan.livre.titre}</span>
              <IconeChevron />
            </button>
          </h1>
          <IndicateurSynchro synchro={etat.synchro} enAttente={etat.enAttente} conflit={etat.conflit !== null} />
        </div>
        <BarreEtat plan={plan} pagination={pagination} mots={mots} />
        <div className="barre-outils">
          <button
            type="button"
            className="bouton-icone"
            aria-label="Annuler la dernière opération"
            title={etat.annulable ? `Annuler : ${etat.annulable}` : 'Rien à annuler'}
            disabled={!etat.annulable}
            onClick={() => {
              atelier.annuler()
            }}
          >
            <IconeAnnuler />
          </button>
          <button
            type="button"
            className="bouton-icone"
            aria-label="Rétablir"
            title={etat.retablissable ? `Rétablir : ${etat.retablissable}` : 'Rien à rétablir'}
            disabled={!etat.retablissable}
            onClick={() => {
              atelier.retablir()
            }}
          >
            <IconeRetablir />
          </button>
          <SelecteurVue vue="plan" zoom={zoom} choisirZoom={setZoom} naviguer={naviguer} />
          <span className="espace" />
          <details className="menu-outils" ref={menu}>
            <summary>Outils</summary>
            <div className="menu-contenu">
              <button type="button" onClick={() => { choisir(() => { setPanneau({ type: 'recherche' }) }) }}>
                Chercher dans le manuscrit <kbd>⌘⇧F</kbd>
              </button>
              <button type="button" onClick={() => { choisir(() => { setPanneau({ type: 'compilation' }) }) }}>
                Compiler…
              </button>
              <button type="button" onClick={() => { choisir(() => void exporter()) }}>
                Exporter le manuscrit (.zip)
              </button>
            </div>
          </details>
          <button
            type="button"
            className="bouton-icone"
            aria-label="Synchroniser"
            title="Synchroniser"
            disabled={etat.synchro.etat === 'en-cours' || etat.synchro.etat === 'envoi'}
            onClick={() => {
              void atelier.synchroniser()
            }}
          >
            <IconeSynchro />
          </button>
          <button
            type="button"
            className="bouton-icone avec-compteur"
            aria-label={`Corbeille (${plan.corbeille.length})`}
            title="Corbeille"
            onClick={() => {
              setPanneau({ type: 'corbeille' })
            }}
          >
            <IconeCorbeille />
            {plan.corbeille.length > 0 && <span className="compteur">{plan.corbeille.length}</span>}
          </button>
          <button
            type="button"
            className="bouton-icone"
            aria-label="Réglages"
            title="Réglages"
            onClick={() => {
              setPanneau({ type: 'reglages' })
            }}
          >
            <IconeReglages />
          </button>
        </div>
      </header>

      {etat.conflit && (
        <div className="bandeau bandeau-attention bandeau-actions" role="alert">
          <p>
            Le plan a été modifié sur un autre appareil pendant vos modifications ici. Choisissez la version à
            garder ; l’autre reste consultable dans l’historique GitHub.
          </p>
          <div>
            <button
              type="button"
              onClick={() => {
                void atelier.resoudreConflit('local')
              }}
            >
              Garder la mienne
            </button>
            <button
              type="button"
              onClick={() => {
                const ok = window.confirm(
                  `Les ${etat.enAttente} modification(s) du plan faites sur cet appareil seront abandonnées. Continuer ?`,
                )
                if (ok) void atelier.resoudreConflit('distant')
              }}
            >
              Prendre celle de GitHub
            </button>
          </div>
        </div>
      )}
      {etat.synchro.etat === 'erreur' && (
        <p className="bandeau bandeau-erreur" role="alert">
          {etat.synchro.message}
        </p>
      )}
      <BandeauFusion
        fusion={etat.fusion}
        fermer={() => {
          atelier.oublierFusion()
        }}
      />

      <main className="contenu-plan">
        <Grille
          plan={plan}
          mots={mots}
          ouvrir={(id) => {
            // Une section de texte s'ouvre dans l'éditeur ; un hors-texte, dans son panneau.
            const s = plan.sections.find((x) => x.id === id)
            if (s?.type === 'texte') naviguer({ vue: 'section', id, selection: null })
            else setPanneau({ type: 'section', id })
          }}
          modifier={(id) => {
            setPanneau({ type: 'section', id })
          }}
          changerPages={(id, delta) => {
            const s = plan.sections.find((x) => x.id === id)
            if (!s) return
            const n = Math.max(1, s.pages + delta)
            atelier.modifierPlan((p) => changerPages(p, id, delta), `${s.titre} sur ${n} page${n > 1 ? 's' : ''}`)
          }}
          creer={(index) => {
            setPanneau({ type: 'creation', index })
          }}
          deplacer={(id, index) => {
            const avant = plan.sections.find((x) => x.id === id)?.partie
            const apres = deplacer(plan, id, index).sections.find((x) => x.id === id)?.partie
            const nouvelle = plan.parties.find((p) => p.id === apres)?.titre
            const description =
              apres !== avant && nouvelle
                ? `déplacement de ${titre(id)} dans la partie ${nouvelle}`
                : `déplacement de ${titre(id)}`
            atelier.modifierPlan((p) => deplacer(p, id, index), description)
          }}
        />
      </main>

      {supprimee && (
        <div className="bandeau-flottant" role="status">
          <span>Section supprimée.</span>
          <button
            type="button"
            onClick={() => {
              atelier.modifierPlan((p) => restaurerSection(p, supprimee.id), `restauration de ${supprimee.titre}`)
              setSupprimee(null)
            }}
          >
            Annuler
          </button>
        </div>
      )}

      {panneau?.type === 'section' && sectionOuverte && (
        <PanneauSection
          key={sectionOuverte.id}
          plan={plan}
          section={sectionOuverte}
          emplacement={pagination.emplacements.get(sectionOuverte.id)}
          mots={mots.get(sectionOuverte.id)}
          valider={(modif) => {
            const propre = {
              ...modif,
              ...(modif.titre !== undefined ? { titre: typo(modif.titre) } : {}),
              ...(modif.resume !== undefined ? { resume: typo(modif.resume) } : {}),
            }
            atelier.modifierPlan((p) => modifierSection(p, sectionOuverte.id, propre), `modification de ${sectionOuverte.titre}`)
            setPanneau(null)
          }}
          supprimer={() => {
            atelier.modifierPlan(
              (p) => supprimerSection(p, sectionOuverte.id, new Date()),
              `suppression de ${sectionOuverte.titre}`,
            )
            setSupprimee({ id: sectionOuverte.id, titre: sectionOuverte.titre })
            setPanneau(null)
          }}
          fermer={() => {
            setPanneau(null)
          }}
        />
      )}
      {panneau?.type === 'creation' && (
        <PanneauCreation
          plan={plan}
          index={panneau.index}
          creer={(nouvelle) => {
            const propre = { ...nouvelle, titre: typo(nouvelle.titre) }
            atelier.modifierPlan(
              (p) => creerSection(p, propre, panneau.index, nouvelId(p)),
              `création de ${propre.titre.trim()}`,
            )
            setPanneau(null)
          }}
          fermer={() => {
            setPanneau(null)
          }}
        />
      )}
      {panneau?.type === 'corbeille' && (
        <PanneauCorbeille
          plan={plan}
          restaurer={(id) => {
            const s = plan.corbeille.find((e) => e.section.id === id)?.section
            atelier.modifierPlan((p) => restaurerSection(p, id), `restauration de ${s?.titre ?? ''}`)
          }}
          vider={() => {
            atelier.viderCorbeille()
          }}
          fermer={() => {
            setPanneau(null)
          }}
        />
      )}
      {panneau?.type === 'recherche' && (
        <RechercheGlobale
          plan={plan}
          textes={etat.manuscrit?.textes ?? new Map<string, string>()}
          ouvrir={(id, debut, fin) => {
            setPanneau(null)
            naviguer({ vue: 'section', id, selection: { debut, fin } })
          }}
          fermer={() => {
            setPanneau(null)
          }}
        />
      )}
      {panneau?.type === 'compilation' && (
        <Suspense fallback={null}>
          <PanneauCompilation
            plan={plan}
            textes={textes ?? new Map<string, string>()}
            compilations={etat.manuscrit?.compilations ?? []}
            cleDepot={cleDepot}
            enregistrer={(fichiers, message) => atelier.enregistrerFichiers(fichiers, message)}
            fermer={() => {
              setPanneau(null)
            }}
          />
        </Suspense>
      )}
      {panneau?.type === 'livres' && (
        <PanneauLivres
          atelier={atelier}
          etat={etat}
          fermer={() => {
            setPanneau(null)
          }}
        />
      )}
      {panneau?.type === 'reglages' && (
        <PanneauReglages
          plan={plan}
          enAttente={etat.enAttente}
          valider={(reglages) => {
            atelier.modifierPlan((p) => modifierReglages(p, reglages), 'réglages du livre')
            setPanneau(null)
          }}
          normaliserTout={normaliserTout}
          seDeconnecter={() => {
            setPanneau(null)
            void atelier.seDeconnecter()
          }}
          fermer={() => {
            setPanneau(null)
          }}
        />
      )}
    </div>
  )
}

function BarreEtat({
  plan,
  pagination,
  mots,
}: {
  plan: Plan
  pagination: Pagination
  mots: ReadonlyMap<string, MotsSection>
}) {
  const { pagesTotal } = plan.livre
  const depasse = pagination.totalPages > pagesTotal
  let ecrits = 0
  let cible = 0
  for (const m of mots.values()) {
    ecrits += m.ecrits
    cible += m.cible
  }
  // Les pages blanches n'ont rien à écrire : elles ne comptent dans aucun statut.
  const parStatut = new Map(STATUTS.map((s) => [s, plan.sections.filter((x) => x.type !== 'blanche' && x.statut === s).length]))

  return (
    <div className="barre-etat">
      <p className={depasse ? 'etat-depasse' : undefined}>
        <span className="etiquette">Pages</span> {pagination.totalPages} / {pagesTotal}
      </p>
      <p>
        <span className="etiquette">Mots</span> {formaterNombre(ecrits)} / {formaterNombre(cible)}
      </p>
      <p className="statuts">
        {STATUTS.map((s) => (
          <span key={s} className={`compte-statut statut-${s}`} title={LIBELLES_STATUT[s]}>
            <span className="pastille" aria-hidden="true" />
            <span className="lecteur-ecran">{LIBELLES_STATUT[s]} : </span>
            {parStatut.get(s)}
          </span>
        ))}
      </p>
      {pagesTotal % 4 !== 0 && (
        <p className="alerte-pages" title="Un livre imprimé compte en général un multiple de 4 pages.">
          {pagesTotal} pages : pas un multiple de 4
        </p>
      )}
    </div>
  )
}
