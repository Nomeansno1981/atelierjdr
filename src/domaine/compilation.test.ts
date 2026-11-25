import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { lireExemple } from '../test/exemple'
import { compiler, estVide, modeleValide, nomCompilation, versionSuivante, type OptionsCompilation } from './compilation'
import { creerSection, deplacer } from './operations'
import { lirePlan, serialiserPlan, type Plan } from './plan'

const exemple = lireExemple()
const planExemple = (): Plan => lirePlan(exemple['plan.json'] ?? '')
const NB = String.fromCharCode(0xa0)
const TIRET = String.fromCharCode(0x2014)

function textesDe(plan: Plan, fichiers: Record<string, string>): Map<string, string> {
  const textes = new Map<string, string>()
  for (const s of plan.sections) if (s.type === 'texte' && fichiers[s.fichier] !== undefined) textes.set(s.id, fichiers[s.fichier] ?? '')
  return textes
}

const TOUT: OptionsCompilation = { sectionsVides: 'incluses', reperesPages: false }

describe('compiler', () => {
  const sortie = compiler(planExemple(), textesDe(planExemple(), exemple), TOUT)

  it('titres de parties, numérotées ou non, et de sections', () => {
    const titres = sortie.split('\n').filter((l) => l.startsWith('# ') || l.startsWith('## '))
    expect(titres).toEqual([
      `# Partie I ${TIRET} Présentation`,
      '## Avant-propos',
      `## Qu’est-ce que Katastrophê${NB}?`,
      `# Partie II ${TIRET} Les règles`,
      '## Créer son personnage',
      '## Le heurt',
      '## Les serments',
      '## La chute',
      '## Les conséquences',
      '# Lexique',
      '## Lexique',
    ])
  })

  it('hors-texte en commentaire HTML avec ses pages', () => {
    expect(sortie).toContain('<!-- HORS-TEXTE : Page de titre (p. 1) -->')
    expect(sortie).toContain(`<!-- HORS-TEXTE : Illustration${NB}: la chute (p. 9) -->`)
  })

  it('texte intact, une ligne vide entre les blocs, un seul saut de ligne final', () => {
    expect(sortie).toContain(`## Le heurt\n\n${(exemple['sections/le-heurt.md'] ?? '').replace(/\n+$/, '')}\n\n<!-- HORS-TEXTE : Illustration`)
    expect(sortie.endsWith('.\n')).toBe(true)
    expect(sortie.endsWith('\n\n')).toBe(false)
    expect(sortie.includes('\r')).toBe(false)
  })

  it('section vide incluse (titre seul) ou exclue', () => {
    expect(sortie).toContain('## Les conséquences\n\n# Lexique')
    const sans = compiler(planExemple(), textesDe(planExemple(), exemple), { ...TOUT, sectionsVides: 'exclues' })
    expect(sans).not.toContain('Les conséquences')
  })

  it('repères de pages en option, pagination du livre entier', () => {
    const avec = compiler(planExemple(), textesDe(planExemple(), exemple), { ...TOUT, reperesPages: true })
    expect(avec).toContain('## Le heurt\n<!-- pages 7-8 -->\n\n### Quand')
    expect(avec).toContain('## Avant-propos\n<!-- pages 2 -->')
    // Une section vide exclue garde ses pages : le Lexique reste en 18-19.
    const sans = compiler(planExemple(), textesDe(planExemple(), exemple), { sectionsVides: 'exclues', reperesPages: true })
    expect(sans).toContain('## Lexique\n<!-- pages 18-19 -->')
  })

  it('une partie qui revient après une autre a de nouveau son titre', () => {
    const plan = deplacer(planExemple(), 'l7k3pw', 3)
    const titres = compiler(plan, textesDe(plan, exemple), TOUT).split('\n').filter((l) => l.startsWith('# '))
    expect(titres).toEqual([`# Partie I ${TIRET} Présentation`, '# Lexique', `# Partie II ${TIRET} Les règles`])
  })

  it('vide = seulement des blancs, insécables comprises', () => {
    expect(estVide('')).toBe(true)
    expect(estVide(` \n${NB}\t`)).toBe(true)
    expect(estVide(' a ')).toBe(false)
  })
})

describe('noms des compilations', () => {
  it('remplace {n} par la version', () => {
    expect(nomCompilation('Katastrophe__v{n}.md', 27)).toBe('Katastrophe__v27.md')
  })

  it('propose la version suivante', () => {
    const noms = ['compilations/Katastrophe__v3.md', 'compilations/Katastrophe__v12.md', 'compilations/Autre.md']
    expect(versionSuivante('Katastrophe__v{n}.md', noms)).toBe(13)
    expect(versionSuivante('Katastrophe__v{n}.md', [])).toBe(1)
    expect(versionSuivante('Katastrophe__v{n}.md', noms, 20)).toBe(21)
  })

  it('valide le modèle', () => {
    expect(modeleValide('Katastrophe__v{n}.md')).toBe(true)
    expect(modeleValide('Katastrophe.md')).toBe(false)
    expect(modeleValide('dossier/K{n}.md')).toBe(false)
    expect(modeleValide('K{n}.txt')).toBe(false)
  })
})

describe('outils/compiler.py donne exactement le même fichier que le site', () => {
  const dossiers: string[] = []
  afterAll(() => {
    for (const d of dossiers) rmSync(d, { recursive: true, force: true })
  })

  /** Écrit un dépôt de manuscrit dans un dossier temporaire. */
  function depot(fichiers: Record<string, string>): string {
    const racine = mkdtempSync(join(tmpdir(), 'atelier-compilation-'))
    dossiers.push(racine)
    for (const [chemin, contenu] of Object.entries(fichiers)) {
      mkdirSync(dirname(join(racine, chemin)), { recursive: true })
      writeFileSync(join(racine, chemin), contenu, 'utf8')
    }
    return racine
  }

  function python(racine: string, arguments_: string[]): string {
    const script = join(import.meta.dirname, '..', '..', 'outils', 'compiler.py')
    return execFileSync('python3', [script, '--depot', racine, '--sortie', '-', ...arguments_], { encoding: 'utf8' })
  }

  // Manuscrit piégeux : marque d'ordre des octets, fins de ligne CRLF,
  // section faite d'insécables, fichier absent, sauts de ligne en trop.
  let plan = planExemple()
  plan = creerSection(plan, { type: 'texte', titre: 'Avec BOM', partie: 'regles', pages: 1 }, 2, 'bom001')
  plan = creerSection(plan, { type: 'texte', titre: 'Insécables', partie: 'regles', pages: 2 }, 5, 'nbs001')
  plan = creerSection(plan, { type: 'texte', titre: 'Absent', partie: 'lexique', pages: 1 }, 99, 'abs001')
  plan = deplacer(plan, 'p2m9xd', 0)
  const fichiers: Record<string, string> = {
    ...exemple,
    'plan.json': serialiserPlan(plan),
    'sections/avec-bom.md': `${String.fromCharCode(0xfeff)}Début\r\nSuite\r\n\r\n\r\n`,
    'sections/insecables.md': `${NB} \n${NB}\n`,
    'sections/le-heurt.md': `${exemple['sections/le-heurt.md'] ?? ''}\n\n\n`,
  }

  const cas: [string, OptionsCompilation, string[]][] = [
    ['tout inclus', { sectionsVides: 'incluses', reperesPages: false }, []],
    ['sans les sections vides', { sectionsVides: 'exclues', reperesPages: false }, ['--sans-vides']],
    ['avec repères de pages', { sectionsVides: 'incluses', reperesPages: true }, ['--reperes']],
    ['sans vides, avec repères', { sectionsVides: 'exclues', reperesPages: true }, ['--sans-vides', '--reperes']],
  ]

  it.each(cas)('manuscrit d’exemple, %s', (_nom, options, args) => {
    const site = compiler(planExemple(), textesDe(planExemple(), exemple), options)
    expect(Buffer.from(python(depot(exemple), args), 'utf8').equals(Buffer.from(site, 'utf8'))).toBe(true)
  })

  it.each(cas)('manuscrit piégeux, %s', (_nom, options, args) => {
    const site = compiler(plan, textesDe(plan, fichiers), options)
    const script = python(depot(fichiers), args)
    expect(script).toBe(site)
    expect(Buffer.from(script, 'utf8').equals(Buffer.from(site, 'utf8'))).toBe(true)
  })

  it('le script écrit dans compilations/ avec la version suivante et le modèle du plan', () => {
    const avecModele = { ...plan, reglages: { typographie: { apostrophe: true, guillemets: true, ponctuation: true, suspension: true, espaceFine: false }, compilation: { modele: 'K_{n}.md' } } }
    const racine = depot({ ...fichiers, 'plan.json': serialiserPlan(avecModele), 'compilations/K_4.md': 'ancienne\n' })
    const script = join(import.meta.dirname, '..', '..', 'outils', 'compiler.py')
    const chemin = execFileSync('python3', [script, '--depot', racine], { encoding: 'utf8' }).trim()
    expect(chemin).toBe(join(racine, 'compilations', 'K_5.md'))
    expect(readFileSync(chemin, 'utf8')).toBe(compiler(avecModele, textesDe(avecModele, fichiers), TOUT))
  })
})
