import { describe, expect, it } from 'vitest'
import { calcular, idadeEm } from './calc'

// Valores esperados gerados com skills/nutricao-saude/scripts/calc_nutricional.py --json
const casos = [
  { e: { sexo: 'M', idade: 35, pesoKg: 85, alturaCm: 178, atividade: 'moderado', objetivo: 'perder' }, r: [1792, 2778, 2278, 153, 71, 257, 32, 2805] },
  { e: { sexo: 'F', idade: 32, pesoKg: 62, alturaCm: 165, atividade: 'leve', objetivo: 'manter' }, r: [1330, 1829, 1829, 87, 57, 242, 26, 2046] },
  { e: { sexo: 'M', idade: 40, pesoKg: 95, alturaCm: 180, atividade: 'sedentario', objetivo: 'saude' }, r: [1880, 2256, 2143, 114, 67, 272, 30, 3135] },
  { e: { sexo: 'F', idade: 70, pesoKg: 55, alturaCm: 160, atividade: 'sedentario', objetivo: 'perder_lento' }, r: [1039, 1247, 1122, 66, 38, 128, 16, 1815] },
  { e: { sexo: 'M', idade: 28, pesoKg: 72, alturaCm: 175, atividade: 'ativo', objetivo: 'ganhar' }, r: [1679, 2896, 3243, 130, 101, 454, 45, 2376] },
] as const

describe('calcular', () => {
  for (const { e, r } of casos) {
    it(`${e.sexo} ${e.idade} anos, ${e.objetivo}`, () => {
      const x = calcular(e)
      expect([x.tmbKcal, x.tdeeKcal, x.kcal, x.proteinaG, x.gorduraG, x.carboidratoG, x.fibraG, x.aguaMl]).toEqual(r)
    })
  }

  it('nunca fica abaixo da TMB', () => {
    const x = calcular({ sexo: 'F', idade: 30, pesoKg: 50, alturaCm: 160, atividade: 'sedentario', objetivo: 'perder' })
    expect(x.kcal).toBeGreaterThanOrEqual(x.tmbKcal)
  })
})

describe('idadeEm', () => {
  it('conta o aniversário', () => {
    expect(idadeEm('1990-10-24', new Date('2026-10-23T12:00:00'))).toBe(35)
    expect(idadeEm('1990-10-23', new Date('2026-10-23T12:00:00'))).toBe(36)
  })
})
