/**
 * Compilation du manuscrit en un seul fichier Markdown, pour le pipeline
 * Python puis InDesign. outils/compiler.py fait exactement la même chose,
 * octet pour octet : toute modification ici doit y être reportée (un test
 * compare les deux).
 *
 * Format :
 * - « # Partie I — Présentation » quand une partie numérotée commence,
 *   « # Lexique » pour une partie non numérotée ;
 * - « ## Titre », puis une ligne vide et le texte exact de la section ;
 * - hors-texte : « <!-- HORS-TEXTE : Titre (p. 7) --> » ou « (p. 7-8) » ;
 * - page blanche posée à la main : « <!-- PAGE BLANCHE (p. 2) --> » ;
 * - repères de pages (option) : « <!-- pages 12-14 --> » sous le titre ;
 * - une ligne vide entre deux blocs, fins de ligne LF, un seul saut de
 *   ligne final. Seuls les sauts de ligne de fin de chaque texte sont
 *   retirés ; le texte n'est jamais modifié autrement.
 */

import { paginer } from './pagination'
import type { Plan } from './plan'
import { numerosDesParties } from './romains'

export const MODELE_PAR_DEFAUT = 'Katastrophe__v{n}.md'

/**
 * Modèle de nom tiré du titre d'un nouveau livre : lettres sans accents et
 * chiffres, le reste devient « _ ». « Katastrophê » donne le modèle par défaut.
 */
export function modelePourTitre(titre: string): string {
  const base = titre
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `${base || 'Manuscrit'}__v{n}.md`
}

const TIRET_CADRATIN = String.fromCharCode(0x2014)

/** Blancs : une section qui n'en contient que d'autres est vide. Même liste dans compiler.py. */
const BLANCS = new Set([' ', '\t', '\n', '\r', '\f', '\v', String.fromCharCode(0xa0, 0x202f, 0xfeff)].join(''))

export interface OptionsCompilation {
  sectionsVides: 'incluses' | 'exclues'
  reperesPages: boolean
}

export function estVide(texte: string): boolean {
  for (const c of texte) if (!BLANCS.has(c)) return false
  return true
}

/**
 * @param textes texte de chaque section de texte, par identifiant (absent : vide)
 */
export function compiler(plan: Plan, textes: ReadonlyMap<string, string>, options: OptionsCompilation): string {
  // La pagination porte sur tout le plan, sections exclues comprises :
  // elles occupent leurs pages dans le livre.
  const pagination = paginer(plan.sections, plan.livre.premierePage)
  const numeros = numerosDesParties(plan.parties)
  const parties = new Map(plan.parties.map((p) => [p.id, p]))
  const blocs: string[] = []
  let partiePrecedente: string | null = null

  for (const s of plan.sections) {
    const e = pagination.emplacements.get(s.id)
    const pages = e ? (e.premiere === e.derniere ? `${e.premiere}` : `${e.premiere}-${e.derniere}`) : '?'
    const texte = s.type === 'texte' ? (textes.get(s.id) ?? '') : ''
    if (s.type === 'texte' && options.sectionsVides === 'exclues' && estVide(texte)) continue

    if (s.partie !== partiePrecedente) {
      const titre = parties.get(s.partie)?.titre ?? s.partie
      const numero = numeros.get(s.partie)
      blocs.push(numero ? `# Partie ${numero} ${TIRET_CADRATIN} ${titre}` : `# ${titre}`)
      partiePrecedente = s.partie
    }

    if (s.type === 'hors-texte') {
      blocs.push(`<!-- HORS-TEXTE : ${s.titre} (p. ${pages}) -->`)
      continue
    }
    if (s.type === 'blanche') {
      blocs.push(`<!-- PAGE BLANCHE (p. ${pages}) -->`)
      continue
    }
    const tete = options.reperesPages ? `## ${s.titre}\n<!-- pages ${pages} -->` : `## ${s.titre}`
    const corps = texte.replace(/[\r\n]+$/, '')
    blocs.push(corps === '' ? tete : `${tete}\n\n${corps}`)
  }
  return blocs.join('\n\n') + '\n'
}

/** Nom de fichier d'une compilation : le modèle, avec {n} remplacé par la version. */
export function nomCompilation(modele: string, version: number): string {
  return modele.replace('{n}', String(version))
}

/** Un modèle valable : contient {n}, finit par .md, sans dossier. */
export function modeleValide(modele: string): boolean {
  return modele.includes('{n}') && modele.endsWith('.md') && !/[/\\]/.test(modele) && modele.trim() === modele
}

/** Version suivante : une de plus que la plus haute trouvée parmi ces noms de fichiers. */
export function versionSuivante(modele: string, noms: readonly string[], derniereConnue = 0): number {
  const [avant = '', apres = ''] = modele.split('{n}')
  const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const motif = new RegExp(`^${echapper(avant)}(\\d+)${echapper(apres)}$`)
  let plusHaute = derniereConnue
  for (const nom of noms) {
    const m = motif.exec(nom.slice(nom.lastIndexOf('/') + 1))
    if (m?.[1]) plusHaute = Math.max(plusHaute, Number(m[1]))
  }
  return plusHaute + 1
}
