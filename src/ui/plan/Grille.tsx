import {
  DndContext,
  DragOverlay,
  useDraggable,
  useSensor,
  useSensors,
  type DragStartEvent,
} from '@dnd-kit/core'
import { getEventCoordinates } from '@dnd-kit/utilities'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cibleInsertion, ciblePartie, type ActionPartie, type PositionPointeur, type Repere } from '../../domaine/glisser'
import { construireGrille, type PageGrille, type Planche } from '../../domaine/grille'
import { deplacer as deplacerSection, ordreAvecDeplacement } from '../../domaine/operations'
import { paginer, type Pagination } from '../../domaine/pagination'
import { partiesVidesAvant } from '../../domaine/parties'
import type { Partie, Plan, Section } from '../../domaine/plan'
import { numerosDesParties } from '../../domaine/romains'
import { IconePlus } from '../commun/icones'
import { ATTRIBUT_SANS_GLISSER, CapteurSouris, CapteurTactile } from './capteurs'
import type { MotsSection } from './format'
import { FantomePostIt, PostIt, type ActionsPostIt } from './PostIt'

export interface ProprietesGrille {
  plan: Plan
  mots: ReadonlyMap<string, MotsSection>
  /** Les parties se suivent dans l'ordre : on peut les glisser. */
  regroupe: boolean
  ouvrir: (id: string) => void
  modifier: (id: string) => void
  changerPages: (id: string, delta: number) => void
  /**
   * Nouvelle section à cet index de l'ordre, dans cette partie. Entre deux
   * parties, `autrePartie` est celle de droite : on choisira.
   */
  creer: (index: number, partie: string, autrePartie?: string) => void
  /** Nouvelle section dans une partie vide. */
  creerDansPartie: (partie: string) => void
  /** Déplace une section ; `partie` : partie d'arrivée, si on la connaît. */
  deplacer: (id: string, index: number, partie?: string) => void
  ouvrirPartie: (id: string) => void
  deplacerPartie: (id: string, index: number) => void
  /** La partie commence à cette section (son bandeau y a été posé). */
  commencerPartie: (id: string, section: string) => void
}

/** Ce que l'on glisse : un post-it, ou une partie entière (au pointeur seulement). */
interface Glissement {
  type: 'section' | 'partie'
  id: string
  /** Section : index d'insertion, compté dans l'ordre sans elle. */
  index: number
  /** Section : partie d'arrivée. */
  partie: string
  /**
   * Au pointeur, la grille ne bouge pas : une ligne rouge marque l'endroit
   * où l'élément s'insérera. Au clavier, le post-it se déplace à sa place
   * provisoire, qui reçoit le focus.
   */
  mode: 'pointeur' | 'clavier'
  repere: Repere | null
  /** Partie : ce que fera le dépôt ; null si rien ne change. */
  action: ActionPartie | null
}

const COLONNE = { gauche: 1, droite: 2 } as const
const PREFIXE_PARTIE = 'partie:'

interface ActionsBandeau {
  ouvrir: (id: string) => void
  creerDans: (id: string) => void
}

export function Grille(props: ProprietesGrille) {
  const { plan, mots, regroupe, ouvrir, modifier, changerPages, creer, deplacer } = props
  const [glisse, setGlisse] = useState<Glissement | null>(null)
  const [annonce, setAnnonce] = useState('')

  // Au clavier, aperçu : la section à sa place provisoire, avec la partie
  // qu'elle y prendrait. Au pointeur, la grille reste telle qu'elle est.
  const ordre = useMemo(
    () =>
      glisse?.mode === 'clavier' ? deplacerSection(plan, glisse.id, glisse.index).sections : plan.sections,
    [plan, glisse],
  )
  const pagination = useMemo(() => paginer(ordre, plan.livre.premierePage), [ordre, plan.livre.premierePage])
  const planches = useMemo(() => construireGrille(ordre, pagination, plan.livre), [ordre, pagination, plan.livre])
  const sections = useMemo(() => new Map(ordre.map((s) => [s.id, s])), [ordre])
  const vides = useMemo(() => partiesVidesAvant({ parties: plan.parties, sections: ordre }), [plan.parties, ordre])
  const parties = useMemo(() => new Map(plan.parties.map((p) => [p.id, p])), [plan.parties])
  const etiquettes = useMemo(() => {
    const numeros = numerosDesParties(plan.parties)
    return new Map(
      plan.parties.map((p) => {
        const n = numeros.get(p.id)
        return [p.id, n ? `${n}. ${p.titre}` : p.titre]
      }),
    )
  }, [plan.parties])
  const titrePartie = (id: string) => titreDe(parties, id)

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
    if (glisse.type === 'partie') {
      const action = glisse.action
      if (!action) return null
      if (action.type === 'debut') return `commence à « ${plan.sections.find((s) => s.id === action.section)?.titre ?? ''} »`
      const suivante = plan.parties.filter((p) => p.id !== glisse.id)[action.index]
      return suivante ? `avant « ${suivante.titre} »` : 'en fin de livre'
    }
    if (!glisse.repere && glisse.mode === 'pointeur') return null
    const apres = deplacerSection(plan, glisse.id, glisse.index, glisse.mode === 'pointeur' ? glisse.partie : undefined)
    const e = paginer(apres.sections, plan.livre.premierePage).emplacements.get(glisse.id)
    const partie = apres.sections.find((s) => s.id === glisse.id)?.partie
    return [e && pagesAbregees(e), partie === undefined ? '' : (etiquettes.get(partie) ?? partie)]
      .filter(Boolean)
      .join(' · ')
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
    if (g.type === 'partie') {
      if (valider && g.action) {
        if (g.action.type === 'bloc') props.deplacerPartie(g.id, g.action.index)
        else props.commencerPartie(g.id, g.action.section)
        setAnnonce(`Partie ${titrePartie(g.id)} déplacée.`)
      } else {
        setAnnonce(`Déplacement de la partie ${titrePartie(g.id)} annulé.`)
      }
      return
    }
    const titre = sections.get(g.id)?.titre ?? ''
    const depart = plan.sections.findIndex((s) => s.id === g.id)
    if (g.mode === 'pointeur' && valider && g.repere) {
      deplacer(g.id, g.index, g.partie)
      setAnnonce(`${titre} déposé en position ${g.index + 1}, partie ${titrePartie(g.partie)}.`)
    } else if (g.mode === 'clavier' && valider && g.index !== depart) {
      deplacer(g.id, g.index)
      setAnnonce(`${titre} déposé en position ${g.index + 1}.`)
    } else {
      setAnnonce(`Déplacement de ${titre} annulé.`)
    }
  }

  function auDebut(e: DragStartEvent) {
    const actif = String(e.active.id)
    const coordonnees = getEventCoordinates(e.activatorEvent)
    const cible = e.activatorEvent.target
    const element = cible instanceof Element ? cible.closest('.postit, .separateur') : null
    if (coordonnees && element) {
      const r = element.getBoundingClientRect()
      decalage.current = { x: coordonnees.x - r.left, y: coordonnees.y - r.top }
    }
    if (actif.startsWith(PREFIXE_PARTIE)) {
      const id = actif.slice(PREFIXE_PARTIE.length)
      setGlisse({ type: 'partie', id, index: -1, partie: '', mode: 'pointeur', repere: null, action: null })
      setAnnonce(`Partie ${titrePartie(id)} saisie.`)
      return
    }
    const section = plan.sections.find((s) => s.id === actif)
    setGlisse({
      type: 'section',
      id: actif,
      index: plan.sections.findIndex((s) => s.id === actif),
      partie: section?.partie ?? '',
      mode: 'pointeur',
      repere: null,
      action: null,
    })
    setAnnonce(`${section?.titre ?? ''} saisi.`)
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
      const { ordre: o, pagination: p } = courant.current
      if (g.type === 'partie') {
        const c = ciblePartie(o, plan.parties, p, g.id, position)
        if (!memeAction(c.action, g.action) || !memeRepere(c.repere, g.repere)) setGlisse({ ...g, ...c })
        return
      }
      const c = cibleInsertion(o, plan.parties, p, g.id, position)
      if (c.index !== g.index || c.partie !== g.partie || !memeRepere(c.repere, g.repere)) setGlisse({ ...g, ...c })
    })
  }

  function touche(e: KeyboardEvent, id: string) {
    const g = courant.current.glisse
    if (e.key === ' ') {
      e.preventDefault()
      if (!g) {
        const index = plan.sections.findIndex((s) => s.id === id)
        setGlisse({ type: 'section', id, index, partie: '', mode: 'clavier', repere: null, action: null })
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
      const index = plan.sections.findIndex((s) => s.id === id)
      creer(index, plan.sections[index]?.partie ?? '')
    },
    creerApres: (id) => {
      const index = plan.sections.findIndex((s) => s.id === id)
      const partie = plan.sections[index]?.partie ?? ''
      const suivante = plan.sections[index + 1]?.partie
      creer(index + 1, partie, suivante !== undefined && suivante !== partie ? suivante : undefined)
    },
    touche,
  }
  const actionsBandeau: ActionsBandeau = {
    ouvrir: (id) => {
      if (!courant.current.glisse) props.ouvrirPartie(id)
    },
    creerDans: props.creerDansPartie,
  }
  const contexte: ContexteGrille = {
    premiere: ordre[0]?.id,
    pagination,
    sections,
    etiquettes,
    mots,
    glisse,
    actions,
    actionsBandeau,
    vides,
    parties,
    regroupe,
  }
  const sectionGlissee = glisse?.type === 'section' ? sections.get(glisse.id) : undefined
  const partieGlissee = glisse?.type === 'partie' ? parties.get(glisse.id) : undefined
  const videsEnFin = vides.get(null) ?? []

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
          <VuePlanche key={planche.cle} planche={planche} contexte={contexte} />
        ))}
        {videsEnFin.length > 0 && (
          <div className="separateurs separateurs-fin">
            {videsEnFin.map((p) => (
              <BandeauPartie key={p.id} partie={p} vide contexte={contexte} />
            ))}
          </div>
        )}
        <button
          type="button"
          className="ajout-fin"
          data-zone="fin"
          onClick={() => {
            creer(plan.sections.length, plan.parties.at(-1)?.id ?? '')
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
            <FantomePostIt section={sectionGlissee} destination={destination} />
          </div>
        ) : glisse?.mode === 'pointeur' && partieGlissee ? (
          <div ref={fantome} className="cadre-fantome-partie" data-fantome="">
            <div className="fantome-partie">
              <span>{etiquettes.get(partieGlissee.id) ?? partieGlissee.titre}</span>
              {destination && <span className="fantome-destination">{destination}</span>}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

interface ContexteGrille {
  /** Première section de la grille : la seule à avoir un « + » à sa gauche. */
  premiere: string | undefined
  pagination: Pagination
  sections: ReadonlyMap<string, Section>
  etiquettes: ReadonlyMap<string, string>
  mots: ReadonlyMap<string, MotsSection>
  glisse: Glissement | null
  actions: ActionsPostIt
  actionsBandeau: ActionsBandeau
  /** Parties vides, par partie non vide qu'elles précèdent (null : en fin de livre). */
  vides: ReadonlyMap<string | null, Partie[]>
  parties: ReadonlyMap<string, Partie>
  regroupe: boolean
}

function VuePlanche({ planche, contexte }: { planche: Planche; contexte: ContexteGrille }) {
  const { pagination, sections, etiquettes, mots, glisse, actions, vides, parties, premiere } = contexte

  /**
   * Un seul « + » entre deux post-its : au bord droit de chacun (après lui),
   * plus un au bord gauche du tout premier de la grille.
   */
  const boutonsInserer = (section: Section, debut: boolean, fin: boolean) => ({
    avant: debut && section.id === premiere,
    apres: fin,
  })
  const pages = [planche.gauche, planche.droite].filter((p): p is PageGrille => p !== null)
  const auPointeur = glisse?.mode === 'pointeur'
  const repere = auPointeur ? glisse.repere : null

  return (
    <div className="planche" data-planche={planche.cle}>
      {pages.map((page) => {
        const colonne = COLONNE[page.cote]
        const classes = ['page', `page-${page.contenu.type}`]
        const debut = page.debutPartie === null ? undefined : parties.get(page.debutPartie)
        return (
          <Fragment key={page.numero}>
            {page.debutPartie !== null && (
              <div className="separateurs" style={{ gridColumn: colonne }}>
                {(vides.get(page.debutPartie) ?? []).map((p) => (
                  <BandeauPartie key={p.id} partie={p} vide contexte={contexte} />
                ))}
                {debut ? (
                  <BandeauPartie partie={debut} vide={false} contexte={contexte} />
                ) : (
                  <div className="separateur">{page.debutPartie}</div>
                )}
              </div>
            )}
            <div
              className={classes.join(' ')}
              style={{ gridColumn: colonne }}
              data-page={page.numero}
            >
              {page.contenu.type === 'blanche' && <span>blanche</span>}
            </div>
            <div className="numero" style={{ gridColumn: colonne }}>
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
          repere?.type === 'postit' && repere.id === section.id
            ? repere.cote === 'avant'
              ? segment.suite
                ? undefined
                : 'avant'
              : segment.continue
                ? undefined
                : 'apres'
            : undefined
        // Ce qui est glissé reste monté à sa place, estompé : le navigateur
        // continue de lui adresser le doigt, et dnd-kit y cale la silhouette.
        const source =
          auPointeur && (glisse.type === 'section' ? glisse.id === section.id : glisse.id === section.partie)
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
            source={source}
            insertion={insertion}
            inserer={boutonsInserer(section, !segment.suite, !segment.continue)}
            actions={actions}
          />
        )
      })}
    </div>
  )
}

const sansGlisser = { [ATTRIBUT_SANS_GLISSER]: '' }

/**
 * Bandeau d'une partie, au-dessus de la page où elle commence (ou en fin
 * de grille pour une partie vide). Le toucher ouvre ses réglages ; le
 * glisser déplace la partie entière, avec ses sections.
 */
function BandeauPartie({ partie, vide, contexte }: { partie: Partie; vide: boolean; contexte: ContexteGrille }) {
  const { etiquettes, glisse, actionsBandeau, regroupe } = contexte
  const { listeners, setNodeRef } = useDraggable({ id: `${PREFIXE_PARTIE}${partie.id}`, disabled: !regroupe })
  const etiquette = etiquettes.get(partie.id) ?? partie.titre
  const auPointeur = glisse?.mode === 'pointeur'
  const cible = auPointeur && glisse.repere?.type === 'partie' && glisse.repere.id === partie.id
  const source = auPointeur && glisse.type === 'partie' && glisse.id === partie.id
  const classes = ['separateur', vide ? 'separateur-vide' : '', cible ? 'separateur-cible' : '', source ? 'separateur-source' : '']
  return (
    <div ref={setNodeRef} className={classes.join(' ')} data-partie-cible={partie.id} {...listeners}>
      <button
        type="button"
        className="separateur-titre"
        aria-label={`Partie ${etiquette}${vide ? ', vide' : ''}`}
        title="Toucher pour modifier, glisser pour déplacer la partie"
        aria-haspopup="dialog"
        onClick={() => {
          actionsBandeau.ouvrir(partie.id)
        }}
      >
        {etiquette}
        {vide && <span className="mention-vide"> · vide</span>}
      </button>
      {vide && (
        <button
          type="button"
          className="separateur-ajout bouton-icone"
          aria-label={`Nouvelle section dans ${partie.titre}`}
          title="Nouvelle section dans cette partie"
          {...sansGlisser}
          onClick={() => {
            actionsBandeau.creerDans(partie.id)
          }}
        >
          <IconePlus />
        </button>
      )}
    </div>
  )
}

/** Page (et fraction de sa largeur) sous le pointeur, bandeau de partie, ou zone de fin de grille. */
function positionSousPointeur(x: number, y: number): PositionPointeur | null {
  // La silhouette elle-même ne compte pas ; la barre fixe du haut masque la
  // grille : au-dessus d'elle, on ne vise rien.
  const pile = document.elementsFromPoint(x, y).filter((e) => !e.closest('[data-fantome]'))
  if (pile[0]?.closest('.barre, .bandeau-flottant, dialog')) return null
  for (const element of pile) {
    if (!(element instanceof HTMLElement)) continue
    if (element.dataset.zone === 'fin') return { type: 'fin' }
    const partie = element.closest<HTMLElement>('[data-partie-cible]')?.dataset.partieCible
    if (partie !== undefined) return { type: 'partie', partie }
    const page = element.dataset.page
    if (page !== undefined) {
      const r = element.getBoundingClientRect()
      const fraction = r.width > 0 ? Math.min(1, Math.max(0, (x - r.left) / r.width)) : 0
      return { type: 'page', page: Number(page), fraction }
    }
  }
  return null
}

function titreDe(parties: ReadonlyMap<string, Partie>, id: string): string {
  return parties.get(id)?.titre ?? id
}

function memeAction(a: ActionPartie | null, b: ActionPartie | null): boolean {
  if (a === null || b === null) return a === b
  if (a.type === 'bloc') return b.type === 'bloc' && a.index === b.index
  return b.type === 'debut' && a.section === b.section
}

function memeRepere(a: Repere | null, b: Repere | null): boolean {
  if (a === null || b === null) return a === b
  return a.type === b.type && a.id === b.id && (a.type !== 'postit' || b.type !== 'postit' || a.cote === b.cote)
}

function pagesEnToutesLettres(e: { premiere: number; derniere: number }): string {
  return e.premiere === e.derniere ? `page ${e.premiere}` : `pages ${e.premiere} à ${e.derniere}`
}

function pagesAbregees(e: { premiere: number; derniere: number }): string {
  return e.premiere === e.derniere ? `p. ${e.premiere}` : `p. ${e.premiere}-${e.derniere}`
}
