const VALEURS: readonly [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
]

/** Convertit un entier de 1 à 3999 en chiffres romains. */
export function enRomains(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) {
    throw new RangeError(`Impossible d'écrire ${n} en chiffres romains`)
  }
  let reste = n
  let resultat = ''
  for (const [valeur, symbole] of VALEURS) {
    while (reste >= valeur) {
      resultat += symbole
      reste -= valeur
    }
  }
  return resultat
}

/**
 * Numéro romain de chaque partie numérotée, dans l'ordre de la liste.
 * Les parties non numérotées ne consomment pas de numéro.
 */
export function numerosDesParties(
  parties: readonly { id: string; numerotee: boolean }[],
): Map<string, string> {
  const numeros = new Map<string, string>()
  let n = 0
  for (const p of parties) {
    if (p.numerotee) numeros.set(p.id, enRomains(++n))
  }
  return numeros
}
