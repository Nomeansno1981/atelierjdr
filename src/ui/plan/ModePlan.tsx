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
import {
  commencerPartieA,
  deplacerPartie,
  estRegroupe,
  finDePartie,
  fusionnerPartie,
  modifierPartie,
  nouvellePartie,
  regrouper,
  sectionsDeplaceesParRegroupement,
  supprimerPartie,
  voisineDeFusion,
} from '../../domaine/parties'
import { parEndroit, remplacerDans, remplacerDansLePlan, type OccurrenceChoisie } from '../../domaine/remplacement'
import { numerosDesParties } from '../../domaine/romains'
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
import { PanneauPartie } from './PanneauPartie'
import { PanneauReglages } from './PanneauReglages'
import { PanneauSection } from './PanneauSection'

const PanneauCompilation = lazy(() => import('../sorties/PanneauCompilation'))

type Panneau =
  | { type: 'section'; id: string }
  | { type: 'recherche' }
  | { type: 'compilation' }
  /** placePartie : où commencerait une nouvelle partie (null : on n'en propose pas). */
  | { type: 'creation'; index: number; partie: string; autrePartie?: string; placePartie: 'ici' | 'fin' | null }
  | { type: 'partie'; id: string }
  | { type: 'corbeille' }
  | { type: 'reglages' }
  | { type: 'livres' }

const DUREE_BANDEAU_MS = 10_000

/** Dernier remplacement dans tout le manuscrit, pour pouvoir l'annuler. */
interface DernierRemplacement {
  message: string
  restaurations: { id: string; avant: string; apres: string }[]
  /** Description de l'opération sur le plan (titres, résumés), s'il y en a eu une. */
  description: string | null
}

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
  const [remplacements, setRemplacements] = useState<DernierRemplacement | null>(null)
  const [zoom, setZoom] = useState<Zoom>(lireZoom)
  const menu = useRef<HTMLDetailsElement>(null)

  const mots = useMemo(() => motsParSection(plan, textes ?? new Map<string, string>()), [plan, textes])
  const regroupe = useMemo(() => estRegroupe(plan), [plan])
  const titrePartie = (id: string) => plan.parties.find((p) => p.id === id)?.titre ?? id
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

  /**
   * Remplace dans tout le manuscrit : les textes un par un, les titres et
   * résumés en une opération du plan. Un bandeau propose ensuite d'annuler.
   */
  function remplacerPartout(choix: OccurrenceChoisie[], requete: string, remplacement: string) {
    const restaurations: DernierRemplacement['restaurations'] = []
    for (const [cle, groupe] of parEndroit(choix)) {
      const [id, champ] = cle.split('|')
      if (champ !== 'texte' || id === undefined) continue
      const avant = textes?.get(id) ?? ''
      const apres = remplacerDans(avant, groupe, remplacement)
      if (apres === avant) continue
      atelier.modifierTexte(id, apres)
      restaurations.push({ id, avant, apres })
    }
    const description = `remplacement de « ${requete} » par « ${remplacement} »`
    const dansLePlan = choix.some((o) => o.champ !== 'texte')
    if (dansLePlan) atelier.modifierPlan((p) => remplacerDansLePlan(p, choix, remplacement), description)
    void atelier.envoyerMaintenant()
    const n = choix.length
    const sections = new Set(choix.map((o) => o.id)).size
    setRemplacements({
      message: `${n} remplacement${n > 1 ? 's' : ''} dans ${sections} section${sections > 1 ? 's' : ''}.`,
      restaurations,
      description: dansLePlan ? description : null,
    })
  }

  /** Rend les textes d'avant (s'ils n'ont pas changé depuis) et annule l'opération sur le plan. */
  function annulerRemplacements() {
    if (!remplacements) return
    let ignores = 0
    for (const r of remplacements.restaurations) {
      if ((textes?.get(r.id) ?? '') === r.apres) atelier.modifierTexte(r.id, r.avant)
      else ignores++
    }
    if (remplacements.description !== null && etat.annulable === remplacements.description) atelier.annuler()
    void atelier.envoyerMaintenant()
    setRemplacements(null)
    if (ignores > 0) {
      window.alert(
        `${ignores} section${ignores > 1 ? 's ont' : ' a'} été modifiée${ignores > 1 ? 's' : ''} depuis le remplacement : laissée${ignores > 1 ? 's' : ''} telle${ignores > 1 ? 's' : ''} quelle${ignores > 1 ? 's' : ''}. L’historique GitHub garde la version d’avant.`,
      )
    }
  }

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
  const partieOuverte = panneau?.type === 'partie' ? plan.parties.find((p) => p.id === panneau.id) : undefined

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
                Chercher et remplacer… <kbd>⌘⇧F</kbd>
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

      {!regroupe && <BandeauRegroupement plan={plan} regrouper={() => { atelier.modifierPlan(regrouper, 'regroupement des parties') }} />}

      <main className="contenu-plan">
        <Grille
          plan={plan}
          mots={mots}
          regroupe={regroupe}
          creerDansPartie={(partie) => {
            setPanneau({ type: 'creation', index: finDePartie(plan, partie), partie, placePartie: null })
          }}
          ouvrirPartie={(id) => {
            setPanneau({ type: 'partie', id })
          }}
          deplacerPartie={(id, index) => {
            atelier.modifierPlan((p) => deplacerPartie(p, id, index), `déplacement de la partie ${titrePartie(id)}`)
          }}
          commencerPartie={(id, section) => {
            atelier.modifierPlan(
              (p) => commencerPartieA(p, id, section),
              `la partie ${titrePartie(id)} commence à ${titre(section)}`,
            )
          }}
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
          creer={(index, partie, autrePartie) => {
            setPanneau({
              type: 'creation',
              index,
              partie,
              ...(autrePartie ? { autrePartie } : {}),
              placePartie: index < plan.sections.length ? 'ici' : 'fin',
            })
          }}
          deplacer={(id, index, partie) => {
            const avant = plan.sections.find((x) => x.id === id)?.partie
            const apres = deplacer(plan, id, index, partie).sections.find((x) => x.id === id)?.partie
            const nouvelle = plan.parties.find((p) => p.id === apres)?.titre
            const description =
              apres !== avant && nouvelle
                ? `déplacement de ${titre(id)} dans la partie ${nouvelle}`
                : `déplacement de ${titre(id)}`
            atelier.modifierPlan((p) => deplacer(p, id, index, partie), description)
          }}
        />
      </main>

      {remplacements && (
        <div className="bandeau-flottant" role="status">
          <span>{remplacements.message}</span>
          <button type="button" onClick={annulerRemplacements}>
            Annuler
          </button>
          <button
            type="button"
            className="bouton-icone"
            aria-label="Fermer"
            onClick={() => {
              setRemplacements(null)
            }}
          >
            ×
          </button>
        </div>
      )}
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
          partie={panneau.partie}
          autrePartie={panneau.autrePartie}
          placePartie={panneau.placePartie}
          creerPartie={(nouvelle) => {
            const propre = { ...nouvelle, titre: typo(nouvelle.titre) }
            const avant = plan.sections[panneau.index]?.id ?? null
            atelier.modifierPlan((p) => nouvellePartie(p, propre, avant), `création de la partie ${propre.titre.trim()}`)
            setPanneau(null)
          }}
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
      {panneau?.type === 'partie' && partieOuverte && (
        <PanneauPartie
          key={partieOuverte.id}
          plan={plan}
          partie={partieOuverte}
          numero={numerosDesParties(plan.parties).get(partieOuverte.id)}
          regroupe={regroupe}
          valider={(modif) => {
            const propre = { ...modif, titre: typo(modif.titre) }
            atelier.modifierPlan(
              (p) => modifierPartie(p, partieOuverte.id, propre),
              `modification de la partie ${propre.titre.trim() || partieOuverte.titre}`,
            )
            setPanneau(null)
          }}
          deplacer={(index) => {
            atelier.modifierPlan(
              (p) => deplacerPartie(p, partieOuverte.id, index),
              `déplacement de la partie ${partieOuverte.titre}`,
            )
            setPanneau(null)
          }}
          supprimer={() => {
            atelier.modifierPlan((p) => supprimerPartie(p, partieOuverte.id), `suppression de la partie ${partieOuverte.titre}`)
            setPanneau(null)
          }}
          fusionner={() => {
            const voisine = voisineDeFusion(plan, partieOuverte.id)
            atelier.modifierPlan(
              (p) => fusionnerPartie(p, partieOuverte.id),
              `fusion de la partie ${partieOuverte.titre} dans ${voisine?.titre ?? ''}`,
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
            const s = plan.sections.find((x) => x.id === id)
            if (s?.type === 'texte') naviguer({ vue: 'section', id, selection: debut === fin ? null : { debut, fin } })
            else setPanneau({ type: 'section', id })
          }}
          remplacement={{
            typographie: typo,
            appliquer: (choix, requete, remplacement) => {
              setPanneau(null)
              remplacerPartout(choix, requete, remplacement)
            },
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
  const pages = pagination.totalPages
  // Un livre imprimé compte un multiple de 4 pages : on dit combien en compterait l'impression.
  const imprime = Math.ceil(pages / 4) * 4
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
      <p>
        <span className="etiquette">Pages</span> {pages}
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
      {imprime !== pages && (
        <p
          className="alerte-pages"
          title={`Un livre imprimé compte un multiple de 4 pages : il en faudra ${imprime - pages} de plus (contenu ou pages blanches).`}
        >
          Impression : {imprime} pages
        </p>
      )}
    </div>
  )
}

/** Un plan dont les parties ne se suivent pas : on dit ce qui changerait, et on propose de regrouper. */
function BandeauRegroupement({ plan, regrouper }: { plan: Plan; regrouper: () => void }) {
  const deplacees = sectionsDeplaceesParRegroupement(plan)
  const n = deplacees.length
  return (
    <div className="bandeau bandeau-attention bandeau-regroupement" role="status">
      <p>
        Les parties ne se suivent pas dans la grille : une partie est en plusieurs morceaux, ou leur numérotation ne
        suit pas leur ordre. « Regrouper » rassemble chaque partie à la place de sa première section
        {n > 0 ? ` ; ${n} section${n > 1 ? 's changent' : ' change'} de place : ${deplacees.join(', ')}.` : '.'} Cela
        s’annule comme toute opération.
      </p>
      <button type="button" className="bouton-principal" onClick={regrouper}>
        Regrouper
      </button>
    </div>
  )
}
