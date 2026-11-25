/**
 * Convention typographique du projet : espace insécable U+00A0 avant
 * « : ; ! ? » et à l'intérieur des guillemets, apostrophe typographique
 * U+2019, points de suspension U+2026. Aucune conversion de tirets.
 */

export interface ReglesTypo {
  apostrophe: boolean
  guillemets: boolean
  /** Insécable avant : ; ! ? */
  ponctuation: boolean
  suspension: boolean
  /** Espace fine insécable U+202F devant ; ! ? (au lieu de U+00A0). */
  espaceFine: boolean
}

export const REGLES_PAR_DEFAUT: ReglesTypo = {
  apostrophe: true,
  guillemets: true,
  ponctuation: true,
  suspension: true,
  espaceFine: false,
}

export const INSECABLE = String.fromCharCode(0x00a0)
export const FINE = String.fromCharCode(0x202f)
export const APOSTROPHE = String.fromCharCode(0x2019)
export const OUVRANT = String.fromCharCode(0x00ab)
export const FERMANT = String.fromCharCode(0x00bb)
export const POINTS = String.fromCharCode(0x2026)

/** Guillemets droits, et guillemets anglais que posent certains claviers (iPhone). */
export const GUILLEMETS_A_CONVERTIR = '"' + String.fromCharCode(0x201c, 0x201d, 0x201e)
/** Apostrophe droite, et apostrophe ouvrante anglaise. */
export const APOSTROPHES_A_CONVERTIR = "'" + String.fromCharCode(0x2018)
export const PONCTUATION_DOUBLE = ':;!?'

/** Espace à placer devant un signe de ponctuation double. */
export function espaceAvant(signe: string, regles: ReglesTypo): string {
  return regles.espaceFine && ';!?'.includes(signe) ? FINE : INSECABLE
}

export function estEspaceInsecable(c: string | undefined): boolean {
  return c === INSECABLE || c === FINE
}

/** Un guillemet tapé ici est-il ouvrant ? Après une espace, un début de ligne ou une parenthèse ouvrante. */
export function guillemetOuvrant(precedent: string | undefined): boolean {
  return precedent === undefined || precedent === '\n' || /\s/u.test(precedent) || precedent === '('
}
