import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  type DragStartEvent,
} from '@dnd-kit/core'
import { getEventCoordinates } from '@dnd-kit/utilities'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cibleInsertion, type PositionPointeur, type Repere } from '../../domaine/glisser'
import { construireGrille, type PageGrille, type Planche } from '../../domaine/grille'
import { deplacer as deplacerSection, ordreAvecDeplacement } from '../../domaine/operations'
import { paginer, type Pagination } from '../../domaine/pagination'
import type { Plan, Section } from '../../domaine/plan'
import { numerosDesParties } from '../../domaine/romains'
import { IconePlus } from '../commun/icones'
import { CapteurSouris, CapteurTactile } from './capteurs'
import type { MotsSection } from './format'
import { FantomePostIt, PostIt, type ActionsPostIt } from './PostIt'

export interface ProprietesGrille {
  plan: Plan
  mots: ReadonlyMap<string, MotsSection>
  ouvrir: (id: string) => void
  modifier: (id: string) => void
  changerPages: (id: string, delta: number) => void
  /** Nouvelle section à cet index de l'ordre. */
  creer: (index: number) => void
  deplacer: (id: string, index: number) => void
}

interface Glissement {
  id: string
  /** Index d'insertion, compté dans l'ordre sans la section glissée. */
  index: number
  /**
   * Au pointeur, la grille ne bouge pas : une ligne rouge marque l'endroit
   * où le post-it s'insérera. Au clavier, il se déplace à sa place
   * provisoire, qui reçoit le focus.
   */
  mode: 'pointeur' | 'clavier'
  /** Bord du post-it où dessiner la ligne d'insertion (pointeur seulement). */
  repere: Repere | null
}

const COLONNE = { gauche: 1, droite: 2 } as const

export function Grille({ plan, mots, ouvrir, modifier, changerPages, creer, deplacer }: ProprietesGrille) {
  const [glisse, setGlisse] = useState<Glissement | null>(null)
  const [annonce, setAnnonce] = useState('')

  // Au clavier, aperçu : la section à sa place provisoire, avec la partie
  // qu'elle y prendrait. Au pointeur, la grille reste telle qu'elle est.
  const ordre = useMemo(
    () => (glisse?.mode === 'clavier' ? deplacerSection(plan, glisse.id, glisse.index).sections : plan.sections),
    [plan, glisse],
  )
  const pagination = useMemo(() => paginer(ordre, plan.livre.premierePage), [ordre, plan.livre.premierePage])
  const planches = useMemo(() => construireGrille(ordre, pagination, plan.livre), [ordre, pagination, plan.livre])
  const sections = useMemo(() => new Map(ordre.map((s) => [s.id, s])), [ordre])
  const etiquettes = useMemo(() => {
    const numeros = numerosDesParties(plan.parties)
    return new Map(
      plan.parties.map((p) => {
        const n = numeros.get(p.id)
        return [p.id, n ? `${n}. ${p.titre}` : p.titre]
      }),
    )
  }, [plan.parties])

  // Valeurs courantes, lues par les gestionnaires d'événements.
  const courant = useRef({ ordre, pagination, glisse })
  useLayoutEffect(() => {
    courant.current = { ordre, pagination, glisse }
  })
  const decalage = useRef<{ x: number; y: number } | null>(null)
  const fantome = useRef<HTMLDivElement>(null)
  const image = useRef<number | null>(null)

  const capteurs = useSensors(
    useSensor(CapteurSouris, { activationConstraint: { distance: 6 } }),
    // Au doigt : appui long, pour ne pas gêner le défilement.
    useSensor(CapteurTactile, { activationConstraint: { delay: 300, tolerance: 8 } }),
  )

  /** Où la section glissée arriverait : ses pages et sa partie à cette place. */
  const destination = useMemo(() => {
    if (!glisse) return null
    const depart = plan.sections.findIndex((s) => s.id === glisse.id)
    if (glisse.index === depart) return null
    const apres = deplacerSection(plan, glisse.id, glisse.index)
    const e = paginer(apres.sections, plan.livre.premierePage).emplacements.get(glisse.id)
    const partie = apres.sections.find((s) => s.id === glisse.id)?.partie
    return { emplacement: e ?? null, partie: partie === undefined ? '' : (etiquettes.get(partie) ?? partie) }
  }, [plan, glisse, etiquettes])

  function annoncer(id: string, index: number) {
    const s = sections.get(id)
    if (!s) return
    const nouvelOrdre = ordreAvecDeplacement(plan.sections, id, index)
    const e = paginer(nouvelOrdre, plan.livre.premierePage).emplacements.get(id)
    setAnnonce(`${s.titre} : position ${index + 1} sur ${plan.sections.length}, ${e ? pagesEnToutesLettres(e) : ''}.`)
  }

  function terminer(valider: boolean) {
    const g = courant.current.glisse
    setGlisse(null)
    decalage.current = null
    if (image.current !== null) cancelAnimationFrame(image.current)
    if (!g) return
    const titre = sections.get(g.id)?.titre ?? ''
    const depart = plan.sections.findIndex((s) => s.id === g.id)
    if (valider && g.index !== depart) {
      deplacer(g.id, g.index)
      setAnnonce(`${titre} déposé en position ${g.index + 1}.`)
    } else {
      setAnnonce(`Déplacement de ${titre} annulé.`)
    }
  }

  function auDebut(e: DragStartEvent) {
    const id = String(e.active.id)
    const coordonnees = getEventCoordinates(e.activatorEvent)
    const cible = e.activatorEvent.target
    const postit = cible instanceof Element ? cible.closest('.postit') : null
    if (coordonnees && postit) {
      const r = postit.getBoundingClientRect()
      decalage.current = { x: coordonnees.x - r.left, y: coordonnees.y - r.top }
    }
    setGlisse({ id, index: plan.sections.findIndex((s) => s.id === id), mode: 'pointeur', repere: null })
    setAnnonce(`${sections.get(id)?.titre ?? ''} saisi.`)
  }

  function auMouvement() {
    // La silhouette suit exactement le doigt, défilement automatique compris :
    // sa position, mesurée après le rendu, donne celle du pointeur.
    if (image.current !== null) cancelAnimationFrame(image.current)
    image.current = requestAnimationFrame(() => {
      image.current = null
      const g = courant.current.glisse
      const d = decalage.current
      const r = fantome.current?.getBoundingClientRect()
      if (!g || !d || !r) return
      const position = positionSousPointeur(r.left + d.x, r.top + d.y)
      if (!position) return
      const { index, repere } = cibleInsertion(courant.current.ordre, courant.current.pagination, g.id, position)
      if (index !== g.index || repere?.id !== g.repere?.id || repere?.cote !== g.repere?.cote) {
        setGlisse({ ...g, index, repere })
      }
    })
  }

  function touche(e: KeyboardEvent, id: string) {
    const g = courant.current.glisse
    if (e.key === ' ') {
      e.preventDefault()
      if (!g) {
        const index = plan.sections.findIndex((s) => s.id === id)
        setGlisse({ id, index, mode: 'clavier', repere: null })
        const titre = sections.get(id)?.titre ?? ''
        setAnnonce(
          `${titre} saisi, position ${index + 1} sur ${plan.sections.length}. Flèches pour déplacer, Espace ou Entrée pour déposer, Échap pour annuler.`,
        )
      } else if (g.id === id) {
        terminer(true)
      }
      return
    }
    if (g?.mode !== 'clavier' || g.id !== id) return
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault()
      terminer(e.key === 'Enter')
      return
    }
    const sens = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key]
    if (sens === undefined) return
    e.preventDefault()
    const index = Math.max(0, Math.min(plan.sections.length - 1, g.index + sens))
    if (index !== g.index) {
      setGlisse({ ...g, index })
      annoncer(id, index)
    }
  }

  // Au clavier, le post-it change de place dans la page : on lui rend le focus.
  useEffect(() => {
    if (glisse?.mode !== 'clavier') return
    document.querySelector<HTMLElement>(`[data-section="${glisse.id}"] .postit-principal`)?.focus()
  }, [glisse])

  const actions: ActionsPostIt = {
    ouvrir: (id) => {
      if (!courant.current.glisse) ouvrir(id)
    },
    modifier,
    changerPages,
    creerAvant: (id) => {
      creer(plan.sections.findIndex((s) => s.id === id))
    },
    touche,
  }
  const sectionGlissee = glisse ? sections.get(glisse.id) : undefined

  return (
    <DndContext
      sensors={capteurs}
      onDragStart={auDebut}
      onDragMove={auMouvement}
      onDragEnd={() => {
        terminer(true)
      }}
      onDragCancel={() => {
        terminer(false)
      }}
      accessibility={{
        announcements: {
          onDragStart: () => undefined,
          onDragOver: () => undefined,
          onDragMove: () => undefined,
          onDragEnd: () => undefined,
          onDragCancel: () => undefined,
        },
        screenReaderInstructions: {
          draggable:
            'Pour déplacer une section, appuyez sur Espace, puis utilisez les flèches. Espace ou Entrée pour déposer, Échap pour annuler.',
        },
      }}
    >
      <div className={`planches${glisse ? ' en-glissement' : ''}`}>
        {planches.map((planche) => (
          <VuePlanche
            key={planche.cle}
            planche={planche}
            pagination={pagination}
            sections={sections}
            etiquettes={etiquettes}
            mots={mots}
            glisse={glisse}
            actions={actions}
          />
        ))}
        <button
          type="button"
          className="ajout-fin"
          data-zone="fin"
          onClick={() => {
            creer(plan.sections.length)
          }}
        >
          <IconePlus /> Nouvelle section
        </button>
      </div>
      <p className="lecteur-ecran" aria-live="assertive">
        {annonce}
      </p>
      <DragOverlay dropAnimation={null}>
        {glisse?.mode === 'pointeur' && sectionGlissee ? (
          <div ref={fantome} className="cadre-fantome" data-fantome="">
            <FantomePostIt
              section={sectionGlissee}
              destination={
                destination &&
                [destination.emplacement && pagesAbregees(destination.emplacement), destination.partie]
                  .filter(Boolean)
                  .join(' · ')
              }
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

interface ProprietesPlanche {
  planche: Planche
  pagination: Pagination
  sections: ReadonlyMap<string, Section>
  etiquettes: ReadonlyMap<string, string>
  mots: ReadonlyMap<string, MotsSection>
  glisse: Glissement | null
  actions: ActionsPostIt
}

function VuePlanche({ planche, pagination, sections, etiquettes, mots, glisse, actions }: ProprietesPlanche) {
  const pages = [planche.gauche, planche.droite].filter((p): p is PageGrille => p !== null)
  const auPointeur = glisse?.mode === 'pointeur'
  const repere = auPointeur ? glisse.repere : null

  return (
    <div className="planche" data-planche={planche.cle}>
      {pages.map((page) => {
        const colonne = COLONNE[page.cote]
        const classes = ['page', `page-${page.contenu.type}`, page.depasse ? 'page-depasse' : '']
        return (
          <Fragment key={page.numero}>
            {page.debutPartie !== null && (
              <div className="separateur" style={{ gridColumn: colonne }}>
                {etiquettes.get(page.debutPartie) ?? page.debutPartie}
              </div>
            )}
            <div
              className={classes.join(' ')}
              style={{ gridColumn: colonne }}
              data-page={page.numero}
              data-zone={page.contenu.type === 'libre' ? 'fin' : undefined}
            >
              {page.contenu.type === 'blanche' && <span>blanche</span>}
            </div>
            <div className={`numero${page.depasse ? ' numero-depasse' : ''}`} style={{ gridColumn: colonne }}>
              {page.numero}
            </div>
          </Fragment>
        )
      })}
      {planche.segments.map((segment) => {
        const section = sections.get(segment.id)
        if (!section) return null
        const colonne = COLONNE[planche.gauche?.numero === segment.premiere ? 'gauche' : 'droite']
        // La ligne d'insertion : au bord gauche du premier morceau de la
        // section visée, ou au bord droit de son dernier.
        const insertion =
          repere?.id === section.id
            ? repere.cote === 'avant'
              ? segment.suite
                ? undefined
                : 'avant'
              : segment.continue
                ? undefined
                : 'apres'
            : undefined
        // Le post-it glissé reste monté à sa place, estompé : le navigateur
        // continue de lui adresser le doigt, et dnd-kit y cale la silhouette.
        return (
          <PostIt
            key={`${segment.id}@${segment.premiere}`}
            section={section}
            segment={segment}
            emplacement={pagination.emplacements.get(segment.id)}
            etiquettePartie={etiquettes.get(section.partie) ?? section.partie}
            mots={mots.get(section.id) ?? null}
            colonne={colonne}
            place={glisse?.mode === 'clavier' && glisse.id === section.id}
            source={auPointeur && glisse.id === section.id}
            insertion={insertion}
            actions={actions}
          />
        )
      })}
    </div>
  )
}

/** Page (et fraction de sa largeur) sous le pointeur, ou zone de fin de grille. */
function positionSousPointeur(x: number, y: number): PositionPointeur | null {
  // La silhouette elle-même ne compte pas ; la barre fixe du haut masque la
  // grille : au-dessus d'elle, on ne vise rien.
  const pile = document.elementsFromPoint(x, y).filter((e) => !e.closest('[data-fantome]'))
  if (pile[0]?.closest('.barre, .bandeau-flottant, dialog')) return null
  for (const element of pile) {
    if (!(element instanceof HTMLElement)) continue
    if (element.dataset.zone === 'fin') return { type: 'fin' }
    const page = element.dataset.page
    if (page !== undefined) {
      const r = element.getBoundingClientRect()
      const fraction = r.width > 0 ? Math.min(1, Math.max(0, (x - r.left) / r.width)) : 0
      return { type: 'page', page: Number(page), fraction }
    }
  }
  return null
}

function pagesEnToutesLettres(e: { premiere: number; derniere: number }): string {
  return e.premiere === e.derniere ? `page ${e.premiere}` : `pages ${e.premiere} à ${e.derniere}`
}

function pagesAbregees(e: { premiere: number; derniere: number }): string {
  return e.premiere === e.derniere ? `p. ${e.premiere}` : `p. ${e.premiere}-${e.derniere}`
}
