/**
 * Réglage de CodeMirror pour l'Atelier : Markdown brut avec un léger rendu
 * (intertitres plus grands, gras et italique visibles, signes de syntaxe
 * atténués), correcteur orthographique français, raccourcis et phrases de
 * l'interface en français.
 */

import { defaultKeymap, history, historyKeymap, redo } from '@codemirror/commands'
import { defineLanguageFacet, HighlightStyle, Language, syntaxHighlighting } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { EditorSelection, EditorState, RangeSetBuilder, type Extension, type StateCommand } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  keymap,
  placeholder,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { parser as parseurCommonMark, Table } from '@lezer/markdown'
import { titresReserves } from '../../domaine/titres'

/**
 * Markdown : CommonMark et tableaux GFM, rien d'autre. Directement sur
 * l'analyseur de @lezer/markdown (qui porte déjà les étiquettes de
 * coloration), sans @codemirror/lang-markdown qui embarquerait aussi HTML,
 * CSS et JavaScript.
 */
const MARKDOWN = new Language(
  defineLanguageFacet({ commentTokens: { block: { open: '<!--', close: '-->' } } }),
  parseurCommonMark.configure([Table]),
  [],
  'markdown',
)

const STYLE = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.55em', fontWeight: '700' },
  { tag: t.heading2, fontSize: '1.4em', fontWeight: '700' },
  { tag: t.heading3, fontSize: '1.25em', fontWeight: '700' },
  { tag: t.heading4, fontSize: '1.1em', fontWeight: '700' },
  { tag: [t.heading5, t.heading6], fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  // Signes de syntaxe (#, *, >, -, crochets…) : atténués.
  { tag: [t.processingInstruction, t.meta, t.contentSeparator, t.labelName], color: 'var(--texte-attenue)' },
  { tag: t.url, color: 'var(--texte-attenue)', textDecoration: 'none' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.9em' },
  { tag: t.quote, fontStyle: 'italic' },
])

/** Phrases de l'interface de CodeMirror (panneau de recherche…). */
const PHRASES: Record<string, string> = {
  Find: 'Chercher',
  Replace: 'Remplacer',
  next: 'suivant',
  previous: 'précédent',
  all: 'tout',
  'match case': 'respecter la casse',
  'by word': 'mot entier',
  regexp: 'expression régulière',
  replace: 'remplacer',
  'replace all': 'tout remplacer',
  close: 'fermer',
  'current match': 'occurrence courante',
  'replaced match on line $': 'occurrence remplacée à la ligne $',
  'replaced $ matches': '$ occurrences remplacées',
  'on line': 'à la ligne',
  'Go to line': 'Aller à la ligne',
  go: 'aller',
  'Selection deleted': 'Sélection supprimée',
  'Control character': 'Caractère de contrôle',
}

/**
 * Met en gras ou en italique la sélection, ou retire la marque si elle y
 * est déjà. Sans sélection, insère la paire de marques autour du curseur.
 */
export function basculerMarque(marque: string): StateCommand {
  return ({ state, dispatch }) => {
    const n = marque.length
    const transaction = state.changeByRange((plage) => {
      const avant = state.sliceDoc(plage.from - n, plage.from)
      const apres = state.sliceDoc(plage.to, plage.to + n)
      // Pour l'italique, ne pas confondre « * » avec la moitié de « ** ».
      const doublee = marque === '*' && state.sliceDoc(plage.from - 2, plage.from) === '**' && state.sliceDoc(plage.to, plage.to + 2) === '**'
      if (avant === marque && apres === marque && !doublee) {
        return {
          changes: [
            { from: plage.from - n, to: plage.from, insert: '' },
            { from: plage.to, to: plage.to + n, insert: '' },
          ],
          range: EditorSelection.range(plage.from - n, plage.to - n),
        }
      }
      return {
        changes: [
          { from: plage.from, insert: marque },
          { from: plage.to, insert: marque },
        ],
        range: EditorSelection.range(plage.from + n, plage.to + n),
      }
    })
    dispatch(state.update(transaction, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}

/** Souligne les titres # et ##, réservés à la compilation. */
const titresReservesSignales = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = this.calculer(view)
    }
    update(maj: ViewUpdate) {
      if (maj.docChanged) this.decorations = this.calculer(maj.view)
    }
    calculer(view: EditorView): DecorationSet {
      const constructeur = new RangeSetBuilder<Decoration>()
      const doc = view.state.doc
      for (const titre of titresReserves(doc.toString())) {
        const ligne = doc.line(titre.ligne)
        constructeur.add(ligne.from, ligne.from, Decoration.line({ class: 'cm-titre-reserve' }))
      }
      return constructeur.finish()
    }
  },
  { decorations: (v) => v.decorations },
)

export interface Rappels {
  envoyer: () => void
  rechercheGlobale: () => void
  /** Hauteur des éléments fixes en haut de l'écran, pour garder le curseur visible. */
  margeHaut: () => number
}

export function extensionsAtelier(rappels: Rappels): Extension[] {
  return [
    history(),
    EditorView.lineWrapping,
    MARKDOWN,
    syntaxHighlighting(STYLE),
    search({ top: true }),
    titresReservesSignales,
    keymap.of([
      // Cmd/Ctrl+Maj+Z rétablit sur tous les systèmes (CodeMirror ne le prévoit que sur Mac).
      { key: 'Mod-Shift-z', run: redo, preventDefault: true },
      { key: 'Mod-b', run: basculerMarque('**') },
      { key: 'Mod-i', run: basculerMarque('*') },
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          rappels.envoyer()
          return true
        },
      },
      {
        key: 'Mod-Shift-f',
        preventDefault: true,
        run: () => {
          rappels.rechercheGlobale()
          return true
        },
      },
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    EditorView.contentAttributes.of({
      spellcheck: 'true',
      lang: 'fr',
      autocorrect: 'on',
      autocapitalize: 'sentences',
      'aria-label': 'Texte de la section',
      'aria-multiline': 'true',
    }),
    placeholder('Commencez à écrire…'),
    EditorState.phrases.of(PHRASES),
    // Seule la balise <style> portant ce jeton passe la politique de sécurité.
    EditorView.cspNonce.of(__NONCE_STYLES__),
    // La page défile, pas l'éditeur : le curseur doit rester sous la barre fixe.
    EditorView.scrollMargins.of(() => ({ top: rappels.margeHaut() + 12, bottom: 96 })),
  ]
}
