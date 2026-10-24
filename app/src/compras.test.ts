import { describe, expect, it, vi } from 'vitest'
import { emUnidades, itensParaComprar, letraOpcao, pesoPronto, proximaSemana } from './compras'
import type { PlanoItem, PlanoRefeicao } from './dados'
import type { RefeicaoDoDia } from './semana'

// Só as contas; nada aqui fala com o banco.
vi.mock('./supabase', () => ({ supabase: {} }))

const item = (id: string, g: number): PlanoItem => ({ id, quantidade_g: g, ordem: 0, alimento: { id, nome: id } })
const plano: PlanoRefeicao = {
  id: 'cafe', pessoa_id: 'd', tipo: 'cafe', nome: null, hora: '07:00', dias: [1, 2, 3, 4, 5], avisar: false, ativo: true,
  dieta_id: 'x', kcal_alvo: 400, plano_item: [item('pao', 50)],
  plano_opcao: [{ id: 'b', ordem: 1, nome: 'Ovos', plano_opcao_item: [item('ovo', 100)] }],
}

describe('compra da semana', () => {
  it('pega a semana que vem: no sábado e no domingo, a segunda seguinte; na segunda, a outra', () => {
    expect(proximaSemana('2026-10-24')).toBe('2026-10-26')
    expect(proximaSemana('2026-10-25')).toBe('2026-10-26')
    expect(proximaSemana('2026-10-26')).toBe('2026-11-02')
  })
  it('conta a opção A, a escolhida para a semana, e o cardápio do dia acima das duas', () => {
    const r: RefeicaoDoDia = { plano, itens: plano.plano_item, dia: null }
    expect(itensParaComprar(r, {}).map((i) => i.alimento.id)).toEqual(['pao'])
    expect(itensParaComprar(r, { cafe: 'b' }).map((i) => i.alimento.id)).toEqual(['ovo'])
    expect(itensParaComprar(r, { cafe: 'sumiu' }).map((i) => i.alimento.id)).toEqual(['pao'])
    const dia = { id: 'd1', plano_refeicao_id: 'cafe', data: '2026-10-26', receita_id: null, plano_dia_item: [item('tapioca', 80)] }
    expect(itensParaComprar({ plano, itens: dia.plano_dia_item, dia }, { cafe: 'b' }).map((i) => i.alimento.id)).toEqual(['tapioca'])
  })
  it('mostra unidades só com a medida caseira de uma unidade, arredondando para cima', () => {
    expect(emUnidades(700, [{ nome: 'unidade média', g: 100 }])).toBe('≈ 7 unidades')
    expect(emUnidades(720, [{ nome: 'unidade', g: 100 }])).toBe('≈ 8 unidades')
    expect(emUnidades(50, [{ nome: 'unidade', g: 50 }])).toBe('≈ 1 unidade')
    expect(emUnidades(700, [{ nome: 'colher de sopa', g: 25 }])).toBeNull()
    expect(emUnidades(700, [])).toBeNull()
  })
  it('letras e peso pronto', () => {
    expect([0, 1, 2].map(letraOpcao)).toEqual(['A', 'B', 'C'])
    expect(pesoPronto('Arroz, tipo 1, cozido')).toBe(true)
    expect(pesoPronto('Frango, peito, sem pele, grelhado')).toBe(true)
    expect(pesoPronto('Banana, prata, crua')).toBe(false)
  })
})
