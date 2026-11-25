import { describe, expect, it } from 'vitest'
import { lireExemple } from '../../test/exemple'
import { substitutionFrappe, taper } from './frappe'
import { normaliser } from './normaliser'
import { REGLES_PAR_DEFAUT, type ReglesTypo } from './regles'

const NB = String.fromCharCode(0xa0)
const FINE = String.fromCharCode(0x202f)
const R = REGLES_PAR_DEFAUT
const sans = (regle: keyof ReglesTypo): ReglesTypo => ({ ...R, [regle]: false })

/** Les cas de test minimaux du cahier des charges, en frappe et en normalisation. */
const CAS: [saisie: string, attendu: string][] = [
  ["l'acte", 'l’acte'],
  ['"Oui, mais"', `«${NB}Oui, mais${NB}»`],
  ['Non !', `Non${NB}!`],
  ['Non!', `Non${NB}!`],
  ['```\nPourquoi ?\n```', '```\nPourquoi ?\n```'],
  ['14:30', '14:30'],
  ['https://exemple.fr/?q=1', 'https://exemple.fr/?q=1'],
  ['![image](a.png)', '![image](a.png)'],
  ['Attends...', 'Attends…'],
]

describe('cas de test du cahier des charges', () => {
  it.each(CAS)('frappe : « %s »', (saisie, attendu) => {
    expect(taper('', saisie, R)).toBe(attendu)
  })

  it.each(CAS)('normaliser : « %s »', (saisie, attendu) => {
    expect(normaliser(saisie, R).texte).toBe(attendu)
  })

  it.each(CAS)('normaliser deux fois de suite : « %s »', (saisie) => {
    const une = normaliser(saisie, R).texte
    const deux = normaliser(une, R)
    expect(deux.texte).toBe(une)
    expect(deux.remplacements).toBe(0)
  })
})

describe('frappe', () => {
  it('guillemets : ouvrant après une parenthèse, fermant ailleurs', () => {
    expect(taper('', '("Oui")', R)).toBe(`(«${NB}Oui${NB}»)`)
  })

  it('guillemets anglais d’un clavier d’iPhone', () => {
    const ouvrant = String.fromCharCode(0x201c)
    const fermant = String.fromCharCode(0x201d)
    expect(taper('', `${ouvrant}Oui${fermant}`, R)).toBe(`«${NB}Oui${NB}»`)
  })

  it('ponctuation double : une seule espace pour « ?! »', () => {
    expect(taper('', 'Quoi?!', R)).toBe(`Quoi${NB}?!`)
  })

  it('pas d’espace en début de ligne ni après une parenthèse', () => {
    expect(taper('', '!', R)).toBe('!')
    expect(taper('', '(?)', R)).toBe('(?)')
  })

  it('rapports et heures intacts, même au milieu d’une phrase', () => {
    expect(taper('', 'Un rapport 3:2 à 14:30.', R)).toBe('Un rapport 3:2 à 14:30.')
  })

  it('le « ! » d’une image au milieu d’une ligne reste intact', () => {
    expect(taper('', 'Voir ![carte](carte.png)', R)).toBe('Voir ![carte](carte.png)')
  })

  it('aucune substitution dans le code en ligne, même pas encore fermé', () => {
    expect(taper('', "`l'a : b?`", R)).toBe("`l'a : b?`")
    expect(taper('', "Code `l'a", R)).toBe("Code `l'a")
  })

  it('aucune substitution dans l’adresse d’un lien', () => {
    expect(taper('', '[voir](https://exemple.fr/a?b=1)', R)).toBe('[voir](https://exemple.fr/a?b=1)')
    expect(taper('', "[l'aide](page.html?x=1)", R)).toBe('[l’aide](page.html?x=1)')
  })

  it('aucune substitution dans un commentaire HTML', () => {
    expect(taper('', "<!-- l'a : b -->", R)).toBe("<!-- l'a : b -->")
  })

  it('aucune substitution dans un bloc de code pas encore fermé', () => {
    expect(taper('```\n', "l'a : b", R)).toBe("```\nl'a : b")
  })

  it('espace fine devant ; ! ? si l’option est active, insécable devant :', () => {
    const fine = { ...R, espaceFine: true }
    expect(taper('', 'Oui ! Non ? Donc ; puis :', fine)).toBe(`Oui${FINE}! Non${FINE}? Donc${FINE}; puis${NB}:`)
  })

  it('quatre points ne deviennent pas des points de suspension', () => {
    expect(taper('', '....', R)).toBe('....')
  })

  it('chaque règle se désactive à part', () => {
    expect(taper('', "l'acte", sans('apostrophe'))).toBe("l'acte")
    expect(taper('', '"a"', sans('guillemets'))).toBe('"a"')
    expect(taper('', 'Non!', sans('ponctuation'))).toBe('Non!')
    expect(taper('', 'Attends...', sans('suspension'))).toBe('Attends...')
  })

  it('aucune conversion de tirets', () => {
    expect(taper('', 'a -- b - c', R)).toBe('a -- b - c')
  })

  it('décrit la substitution à appliquer et comment la défaire', () => {
    const sub = substitutionFrappe('Non ', 4, '!', R)
    expect(sub?.changement).toEqual({ from: 3, to: 4, insert: NB })
    expect(sub?.annulation).toEqual({ from: 3, to: 4, insert: ' ' })
  })
})

describe('normaliser', () => {
  it('compte les remplacements', () => {
    expect(normaliser(`l'acte, "oui", non! Attends...`, R)).toEqual({
      texte: `l’acte, «${NB}oui${NB}», non${NB}! Attends…`,
      remplacements: 5,
    })
  })

  it('remet une insécable dans des guillemets français mal espacés', () => {
    expect(normaliser('« oui »', R).texte).toBe(`«${NB}oui${NB}»`)
    expect(normaliser('«oui»', R).texte).toBe(`«${NB}oui${NB}»`)
  })

  it('remplace l’espace fine par l’insécable si l’option est désactivée', () => {
    expect(normaliser(`Oui${FINE}!`, R)).toEqual({ texte: `Oui${NB}!`, remplacements: 1 })
  })

  it('ne touche ni au code, ni aux URL, ni aux définitions de liens, ni aux tableaux', () => {
    const texte = [
      "Voir `l'a : b` et https://exemple.fr/?q=1 ou www.exemple.fr/x?y.",
      '',
      '[ref]: https://exemple.fr/doc',
      '',
      '| Caractéristique | Mesure |',
      '| :--- | ---: |',
      '| Force | Vite |',
      '',
      '    code indenté : non !',
    ].join('\n')
    const r = normaliser(texte, R)
    expect(r.texte).toBe(texte)
    expect(r.remplacements).toBe(0)
  })

  it('laisse le manuscrit d’exemple intact : il suit déjà la convention', () => {
    for (const [chemin, contenu] of Object.entries(lireExemple())) {
      if (!chemin.endsWith('.md')) continue
      expect({ chemin, ...normaliser(contenu, R) }).toEqual({ chemin, texte: contenu, remplacements: 0 })
    }
  })

  it('est idempotente sur un texte varié', () => {
    const texte = `"Pourquoi?" demanda-t-il. "Parce que : voilà !" Il était 14:30... l'heure de partir ; enfin.\n« déjà » ; (?) ?!`
    const une = normaliser(texte, R).texte
    expect(normaliser(une, R)).toEqual({ texte: une, remplacements: 0 })
  })

  it('donne le même texte que la frappe', () => {
    const saisie = `"Oui, mais" dit-il. Non! l'acte... Pourquoi ? 3:2 voir ![img](a.png).`
    expect(normaliser(saisie, R).texte).toBe(taper('', saisie, R))
  })
})
