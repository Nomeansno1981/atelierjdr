import { Annotation, EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react'
import type { ReglesTypo } from '../../domaine/typographie/regles'
import type { Selection } from '../routes'
import { extensionsAtelier } from './extensions'
import {
  compartimentInsecables,
  compartimentRegles,
  configurationInsecables,
  configurationRegles,
  extensionsTypographie,
  normaliserEditeur,
} from './typographie'

/** Commandes que l'écran de rédaction peut adresser à l'éditeur. */
export interface PoigneeEditeur {
  /** Normalise la typographie de la section ; renvoie le nombre de remplacements. */
  normaliser: () => number
  texte: () => string
  /**
   * Remplace tout le texte (fin d'un conflit). `deGitHub` : c'est le texte de
   * GitHub repris tel quel, pas une modification à envoyer.
   */
  remplacer: (texte: string, deGitHub: boolean) => void
}

/** Marque les remplacements venus de GitHub : ce ne sont pas des frappes. */
const venuDeGitHub = Annotation.define<boolean>()

interface Proprietes {
  id: string
  /** Texte à afficher à l'ouverture de la section (modifications locales comprises). */
  texte: string
  /** Texte de la section sur GitHub. */
  texteDistant: string
  /** La section a des modifications locales pas encore envoyées. */
  modifie: boolean
  selection: Selection | null
  changer: (id: string, contenu: string) => void
  envoyer: () => void
  rechercheGlobale: () => void
  regles: ReglesTypo
  afficherInsecables: boolean
  ref?: Ref<PoigneeEditeur>
}

/**
 * Éditeur CodeMirror. Il garde son propre document : React ne le réécrit
 * jamais pendant la frappe. Chaque section conserve son historique
 * d'annulation tant que la page reste ouverte.
 */
export function Editeur({
  id,
  texte,
  texteDistant,
  modifie,
  selection,
  changer,
  envoyer,
  rechercheGlobale,
  regles,
  afficherInsecables,
  ref,
}: Proprietes) {
  const hote = useRef<HTMLDivElement>(null)
  const vue = useRef<EditorView | null>(null)
  const etats = useRef(new Map<string, EditorState>())
  const idCourant = useRef(id)
  const distantPrecedent = useRef(texteDistant)

  const rappels = useRef({ changer, envoyer, rechercheGlobale })
  const configuration = useRef({ regles, afficherInsecables })
  useLayoutEffect(() => {
    rappels.current = { changer, envoyer, rechercheGlobale }
    configuration.current = { regles, afficherInsecables }
  })

  useImperativeHandle(ref, () => ({
    normaliser: () => (vue.current ? normaliserEditeur(vue.current, configuration.current.regles) : 0),
    texte: () => vue.current?.state.doc.toString() ?? '',
    remplacer: (texte, deGitHub) => {
      const v = vue.current
      if (!v || v.state.doc.toString() === texte) return
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: texte },
        selection: EditorSelection.cursor(Math.min(v.state.selection.main.head, texte.length)),
        userEvent: 'input.fusion',
        ...(deGitHub ? { annotations: venuDeGitHub.of(true) } : {}),
      })
    },
  }))

  function creerEtat(contenu: string): EditorState {
    return EditorState.create({
      doc: contenu,
      extensions: [
        extensionsAtelier({
          envoyer: () => {
            rappels.current.envoyer()
          },
          rechercheGlobale: () => {
            rappels.current.rechercheGlobale()
          },
          margeHaut: () => document.querySelector('.barre-redaction')?.getBoundingClientRect().bottom ?? 0,
        }),
        extensionsTypographie(configuration.current.regles, configuration.current.afficherInsecables),
        EditorView.updateListener.of((maj) => {
          if (!maj.docChanged) return
          if (maj.transactions.some((tr) => tr.annotation(venuDeGitHub))) return
          rappels.current.changer(idCourant.current, maj.state.doc.toString())
        }),
      ],
    })
  }

  // Création unique de la vue.
  useEffect(() => {
    if (!hote.current) return
    const v = new EditorView({ parent: hote.current, state: creerEtat(texte) })
    vue.current = v
    return () => {
      v.destroy()
      vue.current = null
    }
    // La vue est créée une fois ; les changements de section passent par setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Changement de section : on garde l'état (et l'historique) de la précédente.
  useEffect(() => {
    const v = vue.current
    if (!v || idCourant.current === id) return
    etats.current.set(idCourant.current, v.state)
    idCourant.current = id
    distantPrecedent.current = texteDistant
    const memorise = etats.current.get(id)
    v.setState(memorise?.doc.toString() === texte ? memorise : creerEtat(texte))
    // Un état mémorisé peut dater d'anciens réglages.
    v.dispatch({
      effects: [
        compartimentRegles.reconfigure(configurationRegles(configuration.current.regles)),
        compartimentInsecables.reconfigure(configurationInsecables(configuration.current.afficherInsecables)),
      ],
    })
    // Seul le changement d'identifiant déclenche ce remplacement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Texte modifié sur GitHub (synchronisation) : on l'affiche, mais seulement
  // si rien n'a été tapé ici depuis la version précédente de GitHub.
  useEffect(() => {
    const v = vue.current
    const precedent = distantPrecedent.current
    distantPrecedent.current = texteDistant
    if (!v || modifie || precedent === texteDistant) return
    const actuel = v.state.doc.toString()
    if (actuel !== precedent || actuel === texteDistant) return
    const tete = Math.min(v.state.selection.main.head, texteDistant.length)
    v.dispatch({
      changes: { from: 0, to: actuel.length, insert: texteDistant },
      selection: EditorSelection.cursor(tete),
      annotations: venuDeGitHub.of(true),
    })
    // Réagit seulement à un nouveau texte distant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texteDistant])

  // Réglages typographiques et affichage des insécables.
  useEffect(() => {
    vue.current?.dispatch({ effects: compartimentRegles.reconfigure(configurationRegles(regles)) })
  }, [regles])
  useEffect(() => {
    vue.current?.dispatch({ effects: compartimentInsecables.reconfigure(configurationInsecables(afficherInsecables)) })
  }, [afficherInsecables])

  // Ouverture à un endroit précis (résultat de recherche).
  useEffect(() => {
    const v = vue.current
    if (!v || !selection) return
    const longueur = v.state.doc.length
    const debut = Math.min(selection.debut, longueur)
    const fin = Math.min(selection.fin, longueur)
    v.dispatch({
      selection: EditorSelection.range(debut, fin),
      effects: EditorView.scrollIntoView(debut, { y: 'center' }),
    })
    v.focus()
  }, [id, selection])

  return <div ref={hote} className="editeur" />
}
