import { describe, expect, it } from 'vitest'
import { cibleMots, compterMots, depasseLaCible } from './mots'
import { baseDuChemin, cheminLibre, slug } from './nomFichier'

const NBSP = String.fromCharCode(0xa0)
const FINE = String.fromCharCode(0x202f)

describe('compterMots', () => {
  it.each([
    ['', 0],
    ['   \n\n ', 0],
    ['Le choc des volontés.', 4],
    // L'apostrophe et le trait d'union ne séparent pas.
    ['l’acte de peut-être', 3],
    // Une espace insécable ne sépare pas : « Non ! » compte pour un mot.
    [`Non${NBSP}!`, 1],
    [`Non${FINE}?`, 1],
    [`«${NBSP}Oui, mais${NBSP}»`, 2],
    // Ponctuation isolée : ignorée.
    ['avant - après', 2],
    ['… ; ! ?', 0],
    // Nombres.
    [`10${NBSP}000 dés`, 2],
  ])('« %s » → %i', (texte, attendu) => {
    expect(compterMots(texte)).toBe(attendu)
  })

  it('ne compte pas la syntaxe Markdown', () => {
    expect(compterMots('### Le heurt\n\nUn **coup** *bref*.')).toBe(5)
    expect(compterMots('- un\n- deux\n\n1. trois')).toBe(3)
    expect(compterMots('> Une citation')).toBe(2)
  })

  it('compte le texte d’un lien, pas son adresse', () => {
    expect(compterMots('Voir [la règle du heurt](https://exemple.fr/regles?x=1 "titre").')).toBe(5)
  })

  it('ne compte pas les séparateurs de tableau', () => {
    const tableau = '| Caractéristique | Mesure |\n| --- | --- |\n| Force | Imposer |'
    expect(compterMots(tableau)).toBe(4)
  })

  it('ne compte pas les commentaires HTML', () => {
    expect(compterMots('Texte <!-- note pour moi --> fini')).toBe(2)
  })

  it('compte le signe échappé comme du texte, sans la barre oblique', () => {
    expect(compterMots('2 \\* 3')).toBe(2)
  })
})

describe('cible de mots', () => {
  it('pages × mots par page, celui de la section en priorité', () => {
    expect(cibleMots({ pages: 3, motsParPage: null }, 350)).toBe(1050)
    expect(cibleMots({ pages: 2, motsParPage: 300 }, 350)).toBe(600)
  })

  it('la jauge vire au rouge au-delà de 110 %', () => {
    expect(depasseLaCible(1155, 1050)).toBe(false)
    expect(depasseLaCible(1156, 1050)).toBe(true)
  })
})

describe('noms de fichiers', () => {
  it.each([
    ['Le heurt', 'le-heurt'],
    ['Qu’est-ce que Katastrophê ?', 'qu-est-ce-que-katastrophe'],
    ['Œuvres & Cœurs', 'oeuvres-coeurs'],
    ['  --  ', 'section'],
    ['Été 1914 : la chute', 'ete-1914-la-chute'],
  ])('« %s » → %s', (titre, attendu) => {
    expect(slug(titre)).toBe(attendu)
  })

  it('coupe un titre trop long à la fin d’un mot', () => {
    const long = slug('Une très longue section dont le titre ne tient pas dans un nom de fichier raisonnable')
    expect(long.length).toBeLessThanOrEqual(60)
    expect(long.endsWith('-')).toBe(false)
  })

  it('suffixe en cas de doublon', () => {
    const pris = new Set(['sections/le-heurt.md', 'sections/le-heurt-2.md'])
    expect(cheminLibre('sections/', 'le-heurt', pris)).toBe('sections/le-heurt-3.md')
    expect(cheminLibre('corbeille/', 'le-heurt', pris)).toBe('corbeille/le-heurt.md')
  })

  it('extrait la base d’un chemin', () => {
    expect(baseDuChemin('sections/le-heurt-2.md')).toBe('le-heurt-2')
  })
})
