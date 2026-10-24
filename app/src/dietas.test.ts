import { describe, expect, it, vi } from 'vitest'
import type { Composicao, PlanoRefeicao } from './dados'
import { alvoDaRefeicao, dietaDoDia, escalarParaKcal, letra, modeloDoDia, naFaixa, opcoesDe, resumoDieta, sugerirOpcoes } from './dietas'
import type { Receita } from './semana'

// Só as contas; nada aqui fala com o banco.
vi.mock('./supabase', () => ({ supabase: {} }))

const comp = new Map<string, Composicao>([
  ['arroz', { energia: 128, proteina: 2.5, carboidrato: 28, gordura: 0.2 }],
  ['frango', { energia: 159, proteina: 32, carboidrato: 0, gordura: 2.5 }],
  ['rec-frango', { energia: 108 }],
  ['rec-omelete', { energia: 164 }],
  ['rec-sopa', { energia: 54 }],
])
const item = (id: string, g: number, ordem = 0) => ({ id: 'i-' + id + g, quantidade_g: g, ordem, alimento: { id, nome: id } })
const receita = (id: string, alimento: string, tipos: Receita['tipos'], porcao: number): Receita =>
  ({ id, familia_id: null, nome: id, descricao: null, alimento_id: alimento, rendimento_g: porcao * 2, porcao_g: porcao, modo_preparo: null, tipos, tags: [], foto: null, ativa: true, item_receita: [] })

describe('modelo do dia', () => {
  it('divide o dia em 3 a 6 refeições, com as frações somando 1', () => {
    for (const n of [3, 4, 5, 6]) {
      const m = modeloDoDia(n)
      expect(m).toHaveLength(n)
      expect(m.reduce((s, x) => s + x.fracao, 0)).toBeCloseTo(1, 6)
    }
    expect(modeloDoDia(9)).toHaveLength(6)
    expect(modeloDoDia(1)).toHaveLength(3)
    expect(alvoDaRefeicao(2450, 0.3)).toBe(740)
  })
})

describe('opções', () => {
  const plano: PlanoRefeicao = {
    id: 'p', pessoa_id: 'd', tipo: 'almoco', nome: null, hora: '12:30', dias: [1], avisar: true, ativo: true, dieta_id: 'x', kcal_alvo: 650,
    plano_item: [item('arroz', 200), item('frango', 150, 1)],
    plano_opcao: [{ id: 'ob', ordem: 1, nome: 'Só frango', plano_opcao_item: [item('frango', 400)] }],
  }
  it('A é o plano_item e as outras seguem as letras', () => {
    const os = opcoesDe(plano)
    expect(os.map((o) => o.letra)).toEqual(['A', 'B'])
    expect(os[0].id).toBeNull()
    expect(os[1].id).toBe('ob')
    expect(letra(2)).toBe('C')
  })
  it('reescala as gramas na proporção para chegar ao alvo, em múltiplos de 5 g', () => {
    const e = escalarParaKcal(plano.plano_item, comp, 650)
    // A: 200 g arroz (256) + 150 g frango (238,5) = 494,5 kcal → fator 1,314
    expect(e.map((x) => x.quantidade_g)).toEqual([265, 195])
    expect(naFaixa(494.5, 650)).toBe(false)
    expect(naFaixa(636, 650)).toBe(true)
  })
  it('resume a dieta: kcal da A somadas e se as opções estão na faixa', () => {
    const r = resumoDieta([plano], comp)
    expect(Math.round(r.kcalA)).toBe(495)
    expect(r.refeicoes[0].opcoes.map((o) => o.naFaixa)).toEqual([false, true]) // B: 400 g frango = 636 kcal
    expect(r.todasNaFaixa).toBe(false)
  })
})

describe('sugestões das favoritas', () => {
  const frango = receita('r1', 'rec-frango', ['almoco', 'jantar'], 480)
  const omelete = receita('r2', 'rec-omelete', ['cafe'], 160)
  const sopa = { ...receita('r3', 'rec-sopa', ['jantar'], 400), familia_id: 'fam' }
  const favs = [{ pessoa_id: 'd', receita_id: 'r1' }]
  it('só as que servem para o tipo, nas gramas do alvo, as mais próximas primeiro', () => {
    const s = sugerirOpcoes([frango, omelete, sopa], favs, 'd', 'jantar', 650, comp)
    expect(s.map((x) => x.receita.id)).toEqual(['r1', 'r3'])
    expect(s[0].gramas).toBe(600) // 650 / 1,08 ≈ 602 → 600 g, dentro de ½–2× de 480 g
    expect(Math.round(s[0].kcal)).toBe(648)
    expect(s[1].gramas).toBe(800) // sopa é leve: bate no teto de 2× a porção
  })
  it('deixa de fora o que já está na refeição e respeita o máximo', () => {
    expect(sugerirOpcoes([frango, omelete, sopa], favs, 'd', 'jantar', 650, comp, new Set(['rec-frango']))).toHaveLength(1)
    expect(sugerirOpcoes([frango, omelete, sopa], favs, 'd', 'jantar', 650, comp, new Set(), 1)).toHaveLength(1)
    expect(sugerirOpcoes([frango, omelete, sopa], [], 'm', 'cafe', 400, comp)).toEqual([])
  })
})

describe('dieta do dia', () => {
  it('acha a dieta pelo dia da semana da pessoa', () => {
    const ds = [{ id: 'a', pessoa_id: 'd', dias: [1, 3, 5] }, { id: 'b', pessoa_id: 'd', dias: [2, 4] }, { id: 'c', pessoa_id: 'm', dias: [1] }]
    expect(dietaDoDia(ds, 'd', 3)?.id).toBe('a')
    expect(dietaDoDia(ds, 'd', 4)?.id).toBe('b')
    expect(dietaDoDia(ds, 'd', 0)).toBeUndefined()
    expect(dietaDoDia(ds, 'm', 1)?.id).toBe('c')
  })
})
