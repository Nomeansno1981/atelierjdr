/**
 * Recherche dans tout le manuscrit. Insensible à la casse, aux accents et
 * à la différence entre espaces ordinaires et insécables : « eleve » trouve
 * « Élève », « Non ! » trouve « Non » suivi d'une insécable et de « ! ».
 */

export interface Occurrence {
  debut: number
  fin: number
  avant: string
  trouve: string
  apres: string
}

export interface ResultatSection {
  id: string
  titre: string
  occurrences: Occurrence[]
}

const CONTEXTE = 40
const MAX_OCCURRENCES = 200

interface TexteNormalise {
  texte: string
  /** Pour chaque caractère normalisé, sa position dans le texte d'origine. */
  origine: number[]
}

function normaliser(texte: string): TexteNormalise {
  let normal = ''
  const origine: number[] = []
  let i = 0
  for (const caractere of texte) {
    const simple = /\s/u.test(caractere)
      ? ' '
      : caractere.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr')
    for (const c of simple) {
      normal += c
      origine.push(i)
    }
    i += caractere.length
  }
  origine.push(texte.length)
  return { texte: normal, origine }
}

export interface OptionsRecherche {
  /** Nombre maximal d'occurrences (200 par défaut : au-delà, l'affichage n'aide plus). */
  max?: number
  /** Seulement les mots entiers : ni lettre ni chiffre juste avant ou juste après. */
  motEntier?: boolean
}

const LETTRE_OU_CHIFFRE = /[\p{L}\p{N}]/u

export function rechercher(
  sections: readonly { id: string; titre: string; texte: string }[],
  requete: string,
  options: OptionsRecherche = {},
): ResultatSection[] {
  const cherche = normaliser(requete.trim()).texte
  if (cherche.length < 2) return []
  const max = options.max ?? MAX_OCCURRENCES
  const resultats: ResultatSection[] = []
  let total = 0

  for (const s of sections) {
    const { texte, origine } = normaliser(s.texte)
    const occurrences: Occurrence[] = []
    for (let i = texte.indexOf(cherche); i !== -1 && total < max; i = texte.indexOf(cherche, i + 1)) {
      const debut = origine[i] ?? 0
      const fin = origine[i + cherche.length] ?? s.texte.length
      if (options.motEntier && (LETTRE_OU_CHIFFRE.test(s.texte[debut - 1] ?? '') || LETTRE_OU_CHIFFRE.test(s.texte[fin] ?? ''))) {
        continue
      }
      // Pas de chevauchement : la suivante commence après celle-ci.
      const precedente = occurrences.at(-1)
      if (precedente && debut < precedente.fin) continue
      occurrences.push({
        debut,
        fin,
        avant: extrait(s.texte.slice(Math.max(0, debut - CONTEXTE), debut), 'debut', debut > CONTEXTE),
        trouve: s.texte.slice(debut, fin),
        apres: extrait(s.texte.slice(fin, fin + CONTEXTE), 'fin', fin + CONTEXTE < s.texte.length),
      })
      total++
    }
    if (occurrences.length > 0) resultats.push({ id: s.id, titre: s.titre, occurrences })
  }
  return resultats
}

/** Contexte d'une occurrence, sur une seule ligne, avec points de suspension si coupé. */
function extrait(morceau: string, cote: 'debut' | 'fin', coupe: boolean): string {
  const uneLigne = morceau.replace(/\s+/g, ' ')
  if (!coupe) return uneLigne
  return cote === 'debut' ? `…${uneLigne.trimStart()}` : `${uneLigne.trimEnd()}…`
}
