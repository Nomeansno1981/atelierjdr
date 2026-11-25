import { MergeView, unifiedMergeView } from '@codemirror/merge'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useRef } from 'react'

interface Proprietes {
  titre: string
  /** Texte sur GitHub (écrit sur un autre appareil). */
  distant: string
  /** Texte de cet appareil. */
  local: string
  /** Chemin de la sauvegarde de la version locale dans le dépôt. */
  sauvegarde: string
  /** Garde ce texte (fusionné à la main, ou l'une des deux versions). */
  garder: (texte: string) => void
  prendreDistant: () => void
  fermer: () => void
}

const LARGE = '(min-width: 768px)'

const communes = [
  EditorView.lineWrapping,
  // « Accept » garde le passage de l'appareil, « Reject » reprend celui de GitHub.
  EditorState.phrases.of({
    Accept: 'Garder le mien',
    Reject: 'Prendre GitHub',
    'Revert this chunk': 'Reprendre ce passage de GitHub',
    '$ unchanged lines': '$ lignes identiques',
  }),
  EditorView.cspNonce.of(__NONCE_STYLES__),
]

/**
 * Comparaison des deux versions d'un texte en conflit. Sur grand écran,
 * côte à côte : GitHub à gauche (lecture seule), cet appareil à droite
 * (modifiable, une flèche reprend un passage de gauche). Sur téléphone, une
 * seule colonne où les passages de GitHub s'intercalent, à accepter ou
 * refuser un par un. Le texte de droite (ou de la colonne unique) est
 * celui qui sera gardé.
 */
export default function ComparaisonTexte({ titre, distant, local, sauvegarde, garder, prendreDistant, fermer }: Proprietes) {
  const hote = useRef<HTMLDivElement>(null)
  const resultat = useRef<() => string>(() => local)

  useEffect(() => {
    if (!hote.current) return
    const modifiable = [
      ...communes,
      EditorView.contentAttributes.of({ spellcheck: 'true', lang: 'fr', 'aria-label': 'Texte gardé' }),
    ]
    if (window.matchMedia(LARGE).matches) {
      const vue = new MergeView({
        a: { doc: distant, extensions: [...communes, EditorState.readOnly.of(true), EditorView.editable.of(false)] },
        b: { doc: local, extensions: modifiable },
        parent: hote.current,
        revertControls: 'a-to-b',
        highlightChanges: true,
        gutter: true,
      })
      resultat.current = () => vue.b.state.doc.toString()
      return () => {
        vue.destroy()
      }
    }
    const vue = new EditorView({
      parent: hote.current,
      state: EditorState.create({ doc: local, extensions: [...modifiable, unifiedMergeView({ original: distant, mergeControls: true })] }),
    })
    resultat.current = () => vue.state.doc.toString()
    return () => {
      vue.destroy()
    }
  }, [distant, local])

  return (
    <div className="comparaison" role="dialog" aria-modal="true" aria-label={`Comparer les deux versions : ${titre}`}>
      <header className="comparaison-entete">
        <h2>Comparer les deux versions : {titre}</h2>
        <p className="aide">
          Rien n’est perdu : votre version est aussi sauvegardée dans <code>{sauvegarde}</code>.
        </p>
        <p className="aide comparaison-aide-large">
          La flèche entre les colonnes reprend un passage de GitHub dans votre texte. Vous pouvez aussi corriger
          librement à droite.
        </p>
        <div className="comparaison-colonnes" aria-hidden="true">
          <span>Sur GitHub (autre appareil)</span>
          <span>Sur cet appareil : le texte gardé, modifiable</span>
        </div>
        <p className="aide comparaison-aide-etroite">
          À chaque différence, en rouge le passage de GitHub, en vert le vôtre : gardez le vôtre ou prenez celui de
          GitHub, puis corrigez librement.
        </p>
      </header>
      <div ref={hote} className="comparaison-editeurs" />
      <footer className="actions-formulaire comparaison-actions">
        <button type="button" onClick={fermer}>
          Annuler
        </button>
        <span className="espace" />
        <button type="button" onClick={prendreDistant}>
          Garder celle de GitHub
        </button>
        <button
          type="button"
          onClick={() => {
            garder(local)
          }}
        >
          Garder celle de l’appareil
        </button>
        <button
          type="button"
          className="bouton-principal"
          onClick={() => {
            garder(resultat.current())
          }}
        >
          Garder le texte fusionné
        </button>
      </footer>
    </div>
  )
}
