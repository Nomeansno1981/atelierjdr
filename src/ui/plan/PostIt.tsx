import { useDraggable } from '@dnd-kit/core'
import type { CSSProperties, KeyboardEvent } from 'react'
import { depasseLaCible } from '../../domaine/mots'
import type { Emplacement } from '../../domaine/pagination'
import { LIBELLES_STATUT, type Section } from '../../domaine/plan'
import type { Segment } from '../../domaine/grille'
import { IconeHorsTexte, IconeMoins, IconePlus, IconePoints } from '../commun/icones'
import { ATTRIBUT_SANS_GLISSER } from './capteurs'
import { formaterNombre } from './format'

export interface ActionsPostIt {
  ouvrir: (id: string) => void
  modifier: (id: string) => void
  changerPages: (id: string, delta: number) => void
  creerAvant: (id: string) => void
  creerApres: (id: string) => void
  touche: (e: KeyboardEvent, id: string) => void
}

interface Proprietes {
  section: Section
  segment: Segment
  emplacement: Emplacement | undefined
  etiquettePartie: string
  /** Mots écrits et cible ; null pour un hors-texte. */
  mots: { ecrits: number; cible: number } | null
  colonne: number
  /** Déplacé au clavier : il est affiché à sa place provisoire. */
  place: boolean
  /** Glissé au doigt ou à la souris : il reste à sa place, estompé. */
  source?: boolean
  /** Ligne d'insertion du post-it glissé, à ce bord-ci. */
  insertion?: 'avant' | 'apres' | undefined
  /** « + » au bord gauche (nouvelle section avant) et au bord droit (après). */
  inserer?: { avant: boolean; apres: boolean }
  actions: ActionsPostIt
}

const sansGlisser = { [ATTRIBUT_SANS_GLISSER]: '' }

export function PostIt({
  section,
  segment,
  emplacement,
  etiquettePartie,
  mots,
  colonne,
  place,
  source = false,
  insertion,
  inserer = { avant: false, apres: false },
  actions,
}: Proprietes) {
  // Seul le premier segment se saisit : il porte l'identifiant de la section.
  const { listeners, setNodeRef } = useDraggable({
    id: segment.suite ? `${section.id}@${segment.premiere}` : section.id,
    disabled: segment.suite,
  })
  const largeur = segment.derniere - segment.premiere + 1
  const style: CSSProperties = { gridColumn: `${colonne} / span ${largeur}` }
  const pages = emplacement
    ? emplacement.premiere === emplacement.derniere
      ? `page ${emplacement.premiere}`
      : `pages ${emplacement.premiere} à ${emplacement.derniere}`
    : ''
  const libelle = [
    section.titre,
    section.type === 'hors-texte' ? 'hors-texte' : section.type === 'blanche' ? 'page blanche' : null,
    LIBELLES_STATUT[section.statut],
    pages,
    mots ? `${formaterNombre(mots.ecrits)} mots sur ${formaterNombre(mots.cible)}` : null,
  ]
    .filter(Boolean)
    .join(', ')

  const classes = [
    'postit',
    `statut-${section.statut}`,
    section.type === 'blanche' ? 'postit-blanche' : '',
    segment.suite ? 'postit-suite' : '',
    segment.continue ? 'postit-continue' : '',
    place ? 'postit-place' : '',
    source ? 'postit-source' : '',
  ]

  return (
    <div
      ref={setNodeRef}
      className={classes.join(' ')}
      style={style}
      data-section={section.id}
      data-insertion={insertion}
      {...listeners}
    >
      <button
        type="button"
        className="postit-principal"
        aria-label={segment.suite ? `${section.titre} (suite)` : libelle}
        aria-roledescription="post-it déplaçable"
        tabIndex={segment.suite ? -1 : 0}
        onClick={() => {
          actions.ouvrir(section.id)
        }}
        onKeyDown={(e) => {
          actions.touche(e, section.id)
        }}
      >
        {segment.suite ? (
          <span className="postit-titre">
            <span className="mention-suite">suite</span>
            {section.titre}
          </span>
        ) : (
          <>
            <span className="postit-partie">{etiquettePartie}</span>
            <span className="postit-titre">
              {section.type === 'hors-texte' && <IconeHorsTexte />}
              {section.titre}
            </span>
            {section.resume && (
              <span className="postit-resume" title={section.resume}>
                {section.resume}
              </span>
            )}
            {mots && <Jauge ecrits={mots.ecrits} cible={mots.cible} />}
          </>
        )}
      </button>

      {!segment.suite && (
        <>
          <button
            type="button"
            className="postit-menu bouton-icone"
            aria-label={`Modifier ${section.titre}`}
            title="Modifier"
            {...sansGlisser}
            onClick={() => {
              actions.modifier(section.id)
            }}
          >
            <IconePoints />
          </button>
          <div className="postit-pages" {...sansGlisser}>
            <button
              type="button"
              className="bouton-icone"
              aria-label={`Une page de moins pour ${section.titre}`}
              disabled={section.pages <= 1}
              onClick={() => {
                actions.changerPages(section.id, -1)
              }}
            >
              <IconeMoins />
            </button>
            <span aria-hidden="true">{section.pages} p.</span>
            <button
              type="button"
              className="bouton-icone"
              aria-label={`Une page de plus pour ${section.titre}`}
              onClick={() => {
                actions.changerPages(section.id, 1)
              }}
            >
              <IconePlus />
            </button>
          </div>
        </>
      )}
      {inserer.avant && (
        <button
          type="button"
          className="postit-inserer"
          aria-label={`Nouvelle section avant ${section.titre}`}
          title="Nouvelle section ici"
          {...sansGlisser}
          onClick={() => {
            actions.creerAvant(section.id)
          }}
        >
          <IconePlus />
        </button>
      )}
      {inserer.apres && (
        <button
          type="button"
          className="postit-inserer postit-inserer-apres"
          aria-label={`Nouvelle section après ${section.titre}`}
          title="Nouvelle section ici"
          {...sansGlisser}
          onClick={() => {
            actions.creerApres(section.id)
          }}
        >
          <IconePlus />
        </button>
      )}
    </div>
  )
}

function Jauge({ ecrits, cible }: { ecrits: number; cible: number }) {
  const ratio = cible > 0 ? Math.min(1, ecrits / cible) : 0
  return (
    <span className={`jauge${depasseLaCible(ecrits, cible) ? ' jauge-depasse' : ''}`}>
      <span className="jauge-barre">
        <span className="jauge-remplie" style={{ width: `${ratio * 100}%` }} />
      </span>
      <span className="jauge-chiffres">
        {formaterNombre(ecrits)} / {formaterNombre(cible)}
      </span>
    </span>
  )
}

/**
 * Silhouette qui suit le pointeur pendant un glissement, avec les pages et
 * la partie que la section prendrait là où elle serait déposée.
 */
export function FantomePostIt({ section, destination }: { section: Section; destination: string | null }) {
  return (
    <div className={`postit-fantome statut-${section.statut}${section.type === 'blanche' ? ' postit-blanche' : ''}`}>
      <span className="fantome-titre">
        {section.type === 'hors-texte' && <IconeHorsTexte />}
        {section.titre}
      </span>
      {destination && <span className="fantome-destination">{destination}</span>}
    </div>
  )
}
