import { describe, expect, it } from 'vitest'
import { enRomains, numerosDesParties } from './romains'

describe('enRomains', () => {
  it.each([
    [1, 'I'],
    [4, 'IV'],
    [9, 'IX'],
    [14, 'XIV'],
    [40, 'XL'],
    [1999, 'MCMXCIX'],
  ])('%i → %s', (n, attendu) => {
    expect(enRomains(n)).toBe(attendu)
  })

  it('refuse 0 et les nombres non entiers', () => {
    expect(() => enRomains(0)).toThrow(RangeError)
    expect(() => enRomains(1.5)).toThrow(RangeError)
  })
})

describe('numerosDesParties', () => {
  it('numérote dans l’ordre en sautant les parties non numérotées', () => {
    const numeros = numerosDesParties([
      { id: 'a', numerotee: true },
      { id: 'lexique', numerotee: false },
      { id: 'b', numerotee: true },
    ])
    expect([...numeros]).toEqual([
      ['a', 'I'],
      ['b', 'II'],
    ])
  })
})
