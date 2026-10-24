import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import { andamentoDia, ehAMais, feitasDoPlano, tipoPelaHora } from './hoje'

describe('tipoPelaHora', () => {
  it('segue as faixas do dia', () => {
    expect(tipoPelaHora(7)).toBe('cafe')
    expect(tipoPelaHora(10)).toBe('lanche_manha')
    expect(tipoPelaHora(12)).toBe('almoco')
    expect(tipoPelaHora(16)).toBe('lanche_tarde')
    expect(tipoPelaHora(19)).toBe('jantar')
    expect(tipoPelaHora(23)).toBe('ceia')
  })
})

describe('andamentoDia', () => {
  it('diz quanto falta até a meta', () => {
    expect(andamentoDia(1240, 2000)).toEqual({ pct: 0.62, estado: 'falta', texto: 'falta 760 kcal' })
  })
  it('entre 90% e 110% está na meta', () => {
    expect(andamentoDia(1850, 2000).estado).toBe('na-meta')
    expect(andamentoDia(2150, 2000).estado).toBe('na-meta')
    expect(andamentoDia(2000, 2000).texto).toBe('na meta')
  })
  it('acima de 110% passou, e o anel fica cheio', () => {
    expect(andamentoDia(2400, 2000)).toEqual({ pct: 1, estado: 'passou', texto: 'passou 400 kcal' })
  })
  it('sem meta não inventa', () => {
    expect(andamentoDia(500, null)).toEqual({ pct: 0, estado: 'sem-meta', texto: 'sem meta' })
    expect(andamentoDia(0, 2000).pct).toBe(0)
  })
})

describe('feitasDoPlano', () => {
  it('conta feitas e trocadas, não puladas', () => {
    const planos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    const checagens = [
      { plano_refeicao_id: 'a', status: 'feita' as const },
      { plano_refeicao_id: 'b', status: 'trocada' as const },
      { plano_refeicao_id: 'c', status: 'pulada' as const },
    ]
    expect(feitasDoPlano(planos, checagens)).toBe(2)
  })
})

describe('ehAMais', () => {
  it('reconhece a descrição do "comi algo a mais"', () => {
    expect(ehAMais('A mais')).toBe(true)
    expect(ehAMais(' a mais ')).toBe(true)
    expect(ehAMais('strogonoff de domingo')).toBe(false)
    expect(ehAMais(null)).toBe(false)
  })
})
