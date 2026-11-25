import { describe, expect, it } from 'vitest'
import { lireExemple } from '../test/exemple'
import { creerSection, deplacer, modifierSection, restaurerSection, supprimerSection } from './operations'
import {
  deplacerPartie,
  estRegroupe,
  finDePartie,
  fusionnerPartie,
  modifierPartie,
  nouvellePartie,
  partiesVidesAvant,
  regrouper,
  sectionsDeplaceesParRegroupement,
  supprimerPartie,
} from './parties'
import { lirePlan, serialiserPlan, type Plan } from './plan'

const exemple = (): Plan => lirePlan(lireExemple()['plan.json'] ?? '')
const ids = (p: Plan) => p.sections.map((s) => s.id)
const parties = (p: Plan) => p.parties.map((x) => x.id)
const partieDe = (p: Plan, id: string) => p.sections.find((s) => s.id === id)?.partie
const valide = (p: Plan) => lirePlan(serialiserPlan(p))

// presentation : t9e2rk v4n8hs c3w7mj · regles : s8q1lz k7f3qa p2m9xd h5d6yb r2x9fe m6u4og · lexique : l7k3pw
const ORDRE = ['t9e2rk', 'v4n8hs', 'c3w7mj', 's8q1lz', 'k7f3qa', 'p2m9xd', 'h5d6yb', 'r2x9fe', 'm6u4og', 'l7k3pw']

describe('regroupement', () => {
  it('le plan d’exemple est regroupé', () => {
    expect(estRegroupe(exemple())).toBe(true)
  })

  it('une partie en deux morceaux, ou dans le désordre, ne l’est pas', () => {
    const coupe = { ...exemple(), sections: [...exemple().sections.slice(1), ...exemple().sections.slice(0, 1)] }
    expect(estRegroupe(coupe)).toBe(false)
    const desordre = { ...exemple(), parties: [...exemple().parties].reverse() }
    expect(estRegroupe(desordre)).toBe(false)
  })

  it('regrouper suit l’ordre de la grille : chaque partie prend la place de sa première section', () => {
    // Page de titre envoyée en fin de grille : la Présentation est en deux morceaux.
    const coupe = { ...exemple(), sections: [...exemple().sections.slice(1), ...exemple().sections.slice(0, 1)] }
    expect(sectionsDeplaceesParRegroupement(coupe)).toEqual(['Page de titre'])
    const r = regrouper(coupe)
    expect(estRegroupe(r)).toBe(true)
    expect(ids(r)).toEqual(['v4n8hs', 'c3w7mj', 't9e2rk', ...ORDRE.slice(3)])
    expect(parties(r)).toEqual(['presentation', 'regles', 'lexique'])
  })

  it('regrouper renumérote d’après la grille ; une partie vide reste avant la même voisine, ou en fin de livre', () => {
    let plan = exemple()
    const vide = (id: string) => ({ id, titre: id, numerotee: true })
    plan = { ...plan, parties: [vide('prologue'), ...plan.parties.slice(0, 2), vide('intermede'), plan.parties[2], vide('annexes')].filter((x) => x !== undefined) }
    // Le Lexique tout en tête de grille.
    plan = { ...plan, sections: [plan.sections[9], ...plan.sections.slice(0, 9)].filter((s) => s !== undefined) }
    const r = regrouper(plan)
    expect(parties(r)).toEqual(['intermede', 'lexique', 'prologue', 'presentation', 'regles', 'annexes'])
    expect(ids(r)).toEqual(['l7k3pw', ...ORDRE.slice(0, 9)])
  })
})

describe('déplacer une section', () => {
  it('la partie indiquée l’emporte : à la frontière, le côté de la ligne décide', () => {
    // Créer son personnage (première des règles) rejoint la fin de la Présentation, sans bouger.
    const p = deplacer(exemple(), 's8q1lz', 3, 'presentation')
    expect(ids(p)).toEqual(ORDRE)
    expect(partieDe(p, 's8q1lz')).toBe('presentation')
  })

  it('reste regroupé même avec une partie incohérente avec la place', () => {
    const p = deplacer(exemple(), 'l7k3pw', 0, 'regles')
    expect(estRegroupe(p)).toBe(true)
    expect(partieDe(p, 'l7k3pw')).toBe('regles')
    expect(ids(p).indexOf('l7k3pw')).toBe(3)
  })

  it('changer la partie dans le panneau envoie la section au bout le plus proche de sa nouvelle partie', () => {
    const versAvant = modifierSection(exemple(), 'h5d6yb', { partie: 'presentation' })
    expect(ids(versAvant).indexOf('h5d6yb')).toBe(3)
    const versApres = modifierSection(exemple(), 'k7f3qa', { partie: 'lexique' })
    expect(ids(versApres).at(-2)).toBe('k7f3qa')
    expect(estRegroupe(versApres)).toBe(true)
  })

  it('une section créée ou restaurée rejoint sa partie', () => {
    const creee = creerSection(exemple(), { type: 'texte', titre: 'Dés', partie: 'presentation', pages: 1 }, 8, 'zzz111')
    expect(ids(creee).indexOf('zzz111')).toBe(3)
    const supprimee = supprimerSection(exemple(), 'v4n8hs', new Date())
    const deplacee = deplacer(supprimee, 'l7k3pw', 0)
    // Restaurée en position 1, mais le Lexique y est désormais : elle rejoint la Présentation.
    const restauree = restaurerSection(deplacee, 'v4n8hs')
    expect(estRegroupe(restauree)).toBe(true)
    expect(partieDe(restauree, 'v4n8hs')).toBe('presentation')
  })

  it('un plan non regroupé n’est pas regroupé en silence', () => {
    const coupe = { ...exemple(), sections: [...exemple().sections.slice(1), ...exemple().sections.slice(0, 1)] }
    expect(estRegroupe(deplacer(coupe, 'l7k3pw', 0))).toBe(false)
  })
})

describe('parties', () => {
  it('déplacer une partie emmène ses sections, et la numérotation suit', () => {
    const p = deplacerPartie(exemple(), 'regles', 0)
    expect(parties(p)).toEqual(['regles', 'presentation', 'lexique'])
    expect(ids(p)).toEqual([...ORDRE.slice(3, 9), ...ORDRE.slice(0, 3), 'l7k3pw'])
    expect(valide(p)).toEqual(p)
    expect(deplacerPartie(exemple(), 'regles', 1)).toEqual(exemple())
  })

  it('nouvelle partie au milieu d’une partie : elle reprend la suite', () => {
    const p = nouvellePartie(exemple(), { titre: 'Le combat', numerotee: true }, 'h5d6yb')
    expect(parties(p)).toEqual(['presentation', 'regles', 'le-combat', 'lexique'])
    expect(['s8q1lz', 'k7f3qa', 'p2m9xd'].map((id) => partieDe(p, id))).toEqual(['regles', 'regles', 'regles'])
    expect(['h5d6yb', 'r2x9fe', 'm6u4og'].map((id) => partieDe(p, id))).toEqual(['le-combat', 'le-combat', 'le-combat'])
    expect(ids(p)).toEqual(ORDRE)
    expect(estRegroupe(p)).toBe(true)
  })

  it('nouvelle partie avant la première section d’une partie : vide, juste avant elle', () => {
    const p = nouvellePartie(exemple(), { titre: 'Intermède', numerotee: false }, 's8q1lz')
    expect(parties(p)).toEqual(['presentation', 'intermede', 'regles', 'lexique'])
    expect(p.sections).toEqual(exemple().sections)
    expect(partiesVidesAvant(p)).toEqual(new Map([['regles', [{ id: 'intermede', titre: 'Intermède', numerotee: false }]]]))
    expect(finDePartie(p, 'intermede')).toBe(3)
  })

  it('nouvelle partie en fin de livre : vide, après les autres', () => {
    const p = nouvellePartie(exemple(), { titre: 'Annexes', numerotee: true }, null)
    expect(parties(p)).toEqual(['presentation', 'regles', 'lexique', 'annexes'])
    expect(partiesVidesAvant(p).get(null)?.map((x) => x.id)).toEqual(['annexes'])
    expect(finDePartie(p, 'annexes')).toBe(10)
  })

  it('renommer, dénuméroter ; supprimer seulement une partie vide', () => {
    const p = modifierPartie(exemple(), 'regles', { titre: '  Le système ', numerotee: false })
    expect(p.parties[1]).toEqual({ id: 'regles', titre: 'Le système', numerotee: false })
    expect(supprimerPartie(exemple(), 'regles')).toEqual(exemple())
    const avecVide = nouvellePartie(exemple(), { titre: 'Annexes', numerotee: true }, null)
    expect(parties(supprimerPartie(avecVide, 'annexes'))).toEqual(['presentation', 'regles', 'lexique'])
  })

  it('fusionner verse les sections dans la précédente (ou la suivante pour la première)', () => {
    const p = fusionnerPartie(exemple(), 'lexique')
    expect(parties(p)).toEqual(['presentation', 'regles'])
    expect(partieDe(p, 'l7k3pw')).toBe('regles')
    expect(ids(p)).toEqual(ORDRE)
    const premiere = fusionnerPartie(exemple(), 'presentation')
    expect(partieDe(premiere, 't9e2rk')).toBe('regles')
    expect(ids(premiere)).toEqual(ORDRE)
  })
})
