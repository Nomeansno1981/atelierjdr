/**
 * Typographie française dans CodeMirror : substitutions pendant la frappe,
 * affichage des espaces insécables, normalisation d'une section.
 */

import { isolateHistory } from '@codemirror/commands'
import { Compartment, Facet, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { estDeclencheur, substitutionFrappe, type Substitution } from '../../domaine/typographie/frappe'
import { normaliser } from '../../domaine/typographie/normaliser'
import { FINE, INSECABLE, REGLES_PAR_DEFAUT, type ReglesTypo } from '../../domaine/typographie/regles'

const reglesTypo = Facet.define<ReglesTypo, ReglesTypo>({
  combine: (valeurs) => valeurs[0] ?? REGLES_PAR_DEFAUT,
})

/** Mémorise la dernière substitution, pour la défaire si « ![ » ou « .... » la contredit. */
const noter = StateEffect.define<Substitution | null>()
const derniereSubstitution = StateField.define<Substitution | null>({
  create: () => null,
  update(valeur, tr) {
    for (const e of tr.effects) if (e.is(noter)) return e.value
    return tr.docChanged || tr.selection ? null : valeur
  },
})

const substitutionALaFrappe = EditorView.inputHandler.of((view, from, to, texte) => {
  // Remplacement d'une sélection, collage, saisie prédictive : on laisse faire.
  if (from !== to || !estDeclencheur(texte)) return false
  const etat = view.state
  const sub = substitutionFrappe(
    etat.doc.toString(),
    from,
    texte,
    etat.facet(reglesTypo),
    etat.field(derniereSubstitution),
  )
  if (!sub) return false
  // 1. Le caractère tapé, comme une frappe ordinaire.
  view.dispatch({
    changes: { from, insert: texte },
    selection: { anchor: from + texte.length },
    userEvent: 'input.type',
    scrollIntoView: true,
  })
  // 2. La substitution, à part dans l'historique : un Cmd/Ctrl+Z immédiat
  //    l'annule seule et rend le caractère tapé.
  view.dispatch({
    changes: sub.changement,
    effects: noter.of(sub.signe === 'annulation' ? null : sub),
    userEvent: 'input.typographie',
    annotations: isolateHistory.of('full'),
  })
  return true
})

/** Espaces insécables sur un léger fond gris, pour vérifier la typographie d'un coup d'œil. */
const insecablesVisibles = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    private readonly decorateur = new MatchDecorator({
      regexp: new RegExp(`[${INSECABLE}${FINE}]`, 'g'),
      decoration: (m) =>
        Decoration.mark({
          class: 'cm-insecable',
          attributes: { title: m[0] === FINE ? 'Espace fine insécable' : 'Espace insécable' },
        }),
    })
    constructor(view: EditorView) {
      this.decorations = this.decorateur.createDeco(view)
    }
    update(maj: ViewUpdate) {
      this.decorations = this.decorateur.updateDeco(maj, this.decorations)
    }
  },
  { decorations: (v) => v.decorations },
)

export const compartimentRegles = new Compartment()
export const compartimentInsecables = new Compartment()

export function configurationRegles(regles: ReglesTypo): Extension {
  return reglesTypo.of(regles)
}

export function configurationInsecables(afficher: boolean): Extension {
  return afficher ? insecablesVisibles : []
}

export function extensionsTypographie(regles: ReglesTypo, afficherInsecables: boolean): Extension[] {
  return [
    derniereSubstitution,
    substitutionALaFrappe,
    compartimentRegles.of(configurationRegles(regles)),
    compartimentInsecables.of(configurationInsecables(afficherInsecables)),
  ]
}

/**
 * Normalise le texte de l'éditeur en une seule modification, annulable par
 * Cmd/Ctrl+Z. Renvoie le nombre de remplacements faits.
 */
export function normaliserEditeur(view: EditorView, regles: ReglesTypo): number {
  const avant = view.state.doc.toString()
  const { texte, remplacements } = normaliser(avant, regles)
  if (remplacements === 0 || texte === avant) return 0
  // Seule la partie modifiée est remplacée : le curseur reste à sa place.
  let debut = 0
  while (debut < avant.length && avant[debut] === texte[debut]) debut++
  let finAvant = avant.length
  let finApres = texte.length
  while (finAvant > debut && finApres > debut && avant[finAvant - 1] === texte[finApres - 1]) {
    finAvant--
    finApres--
  }
  view.dispatch({
    changes: { from: debut, to: finAvant, insert: texte.slice(debut, finApres) },
    userEvent: 'input.typographie',
    annotations: isolateHistory.of('full'),
  })
  return remplacements
}
