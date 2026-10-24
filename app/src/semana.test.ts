import { describe, expect, it, vi } from 'vitest'
import type { Composicao, PlanoRefeicao } from './dados'
import {
  diasEntre, ehFavorita, formatarPeso, gramasParaFechar, inicioSemana, kcalTreino, mesDe, montarCompras, montarSemana,
  receitasDoPlano, receitasParaRefeicao, refeicoesDoDia, situacaoDia, type DiaPlano, type MetaDia, type Receita,
} from './semana'

// Só as contas; nada aqui fala com o banco.
vi.mock('./supabase', () => ({ supabase: {} }))

const arroz = { id: 'arroz', nome: 'Arroz, tipo 1, cozido', categoria: 'Cereais e derivados' }
const frango = { id: 'frango', nome: 'Frango, peito, sem pele, grelhado', categoria: 'Carnes e derivados' }
const feijao = { id: 'feijao', nome: 'Feijão, carioca, cozido', categoria: 'Leguminosas e derivados' }
const ovo = { id: 'ovo', nome: 'Ovo, de galinha, inteiro, cozido', categoria: 'Ovos e derivados' }

// Energia da TACO por 100 g; as receitas com o valor que o banco calcula.
const comp = new Map<string, Composicao>([
  ['arroz', { energia: 128 }], ['frango', { energia: 159 }], ['feijao', { energia: 76 }], ['ovo', { energia: 146 }],
  ['r1-al', { energia: 155.6 }], ['r2-al', { energia: 200 }],
])

function receita(id: string, nome: string, tipos: Receita['tipos'], rendimento: number, itens: [typeof arroz, number][]): Receita {
  return {
    id, nome, alimento_id: id + '-al', rendimento_g: rendimento, modo_preparo: null, tipos, ativa: true,
    familia_id: 'fam', descricao: null, porcao_g: null, tags: [], foto: null,
    item_receita: itens.map(([a, g], i) => ({ id: `${id}-${i}`, quantidade_g: g, alimento: a })),
  }
}
const r1 = receita('r1', 'Frango com arroz e feijão', ['almoco', 'jantar'], 500, [[arroz, 300], [frango, 200], [feijao, 100]])
const r2 = receita('r2', 'Escondidinho', ['almoco'], 800, [[frango, 400]])

function plano(id: string, pessoa: string, tipo: PlanoRefeicao['tipo'], dias: number[], itens: [typeof arroz, number][]): PlanoRefeicao {
  return {
    id, pessoa_id: pessoa, tipo, nome: null, hora: '12:00:00', dias, avisar: true, ativo: true, dieta_id: null, kcal_alvo: null, plano_opcao: [],
    plano_item: itens.map(([a, g], i) => ({ id: `${id}-${i}`, quantidade_g: g, ordem: i, alimento: a })),
  }
}
const planos = [
  plano('cafe-d', 'd', 'cafe', [0, 1, 2, 3, 4, 5, 6], [[ovo, 100]]), // 146 kcal
  plano('almoco-d', 'd', 'almoco', [0, 1, 2, 3, 4, 5, 6], [[arroz, 150], [frango, 120]]),
  plano('jantar-d', 'd', 'jantar', [1, 2, 3, 4, 5], [[frango, 100]]),
  plano('almoco-m', 'm', 'almoco', [1, 2, 3, 4, 5], [[arroz, 100]]),
]
const meta = (pessoa: string, data: string, kcal: number | null): MetaDia => ({
  pessoa_id: pessoa, data, kcal, proteina_g: null, carboidrato_g: null, gordura_g: null, tmb_kcal: null, gasto_kcal: null,
  treino_kcal: 0, pelo_treino: false,
})

describe('datas', () => {
  it('semana começa na segunda', () => {
    expect(inicioSemana('2026-10-24')).toBe('2026-10-19') // sábado
    expect(inicioSemana('2026-10-25')).toBe('2026-10-19') // domingo
    expect(inicioSemana('2026-10-26')).toBe('2026-10-26')
  })
  it('mês e intervalo', () => {
    expect(mesDe('2026-02-10')).toEqual({ de: '2026-02-01', ate: '2026-02-28' })
    expect(mesDe('2026-10-24')).toEqual({ de: '2026-10-01', ate: '2026-10-31' })
    expect(diasEntre('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })
})

describe('treino e meta', () => {
  it('relógio vence o MET; MET líquido × peso × horas', () => {
    expect(kcalTreino({ met: 5, minutos: 60, kcal_informada: null }, 80)).toBe(320)
    expect(kcalTreino({ met: 9.8, minutos: 30, kcal_informada: null }, 70)).toBeCloseTo(308)
    expect(kcalTreino({ met: 5, minutos: 60, kcal_informada: 450 }, 80)).toBe(450)
    expect(kcalTreino({ met: 5, minutos: 60, kcal_informada: null }, null)).toBeNull()
  })
  it('fecha o dia em ±5%', () => {
    expect(situacaoDia(1900, 2000)).toBe('ok')
    expect(situacaoDia(1890, 2000)).toBe('falta')
    expect(situacaoDia(2110, 2000)).toBe('passou')
    expect(situacaoDia(1500, null)).toBeNull()
  })
  it('gramas de 10 em 10, entre 100 g e 1 kg', () => {
    expect(gramasParaFechar(700, 155.6)).toBe(450)
    expect(gramasParaFechar(-200, 155.6)).toBe(100)
    expect(gramasParaFechar(5000, 155.6)).toBe(1000)
  })
  it('com porção, fica entre metade e o dobro dela', () => {
    expect(gramasParaFechar(140, 475, 30)).toBe(30) // 30 g de chocolate meio amargo
    expect(gramasParaFechar(5000, 475, 30)).toBe(60)
    expect(gramasParaFechar(-50, 475, 30)).toBe(15)
    expect(gramasParaFechar(300, 0, 30)).toBe(30)
  })
})

describe('catálogo e favoritas', () => {
  const catalogo = { ...receita('c1', 'Mousse de banana', ['lanche_tarde'], 300, [[ovo, 100]]), familia_id: null }
  const outra = { ...receita('c2', 'Omelete', ['cafe'], 200, [[ovo, 200]]), familia_id: null }
  const favs = [{ pessoa_id: 'd', receita_id: 'c1' }]
  it('a família vê as suas e as favoritas de cada pessoa', () => {
    expect(ehFavorita(favs, 'd', 'c1')).toBe(true)
    expect(ehFavorita(favs, 'm', 'c1')).toBe(false)
    expect(receitasDoPlano([r1, catalogo, outra], favs, ['d']).map((r) => r.id)).toEqual(['r1', 'c1'])
    expect(receitasDoPlano([r1, catalogo, outra], favs, ['m']).map((r) => r.id)).toEqual(['r1'])
    expect(receitasDoPlano([r1, catalogo, outra], favs, ['d', 'm']).map((r) => r.id)).toEqual(['r1', 'c1'])
    // Para uma refeição: as que servem para o tipo vêm primeiro; o resto do catálogo continua de fora.
    expect(receitasParaRefeicao([r1, catalogo, outra], favs, ['d'], 'lanche_tarde').map((r) => r.id)).toEqual(['c1', 'r1'])
    expect(receitasParaRefeicao([r1, catalogo, outra], favs, ['d'], 'cafe').map((r) => r.id)).toEqual(['r1', 'c1'])
    expect(receitasParaRefeicao([r1, catalogo, outra], favs, ['m'], 'lanche_tarde').map((r) => r.id)).toEqual(['r1'])
  })
})

describe('montarSemana', () => {
  const datas = ['2026-10-25', '2026-10-26', '2026-10-27'] // dom, seg, ter
  const metas = datas.flatMap((d) => [meta('d', d, 2000), meta('m', d, 1600)])

  it('reveza receitas por dia, a mesma panela para todos e gramas pela meta de cada um', () => {
    const r = montarSemana({ datas, pessoas: ['d', 'm'], tipos: ['almoco'], receitas: [r1, r2] }, planos, [], metas, comp)
    // Domingo: só d almoça pelo plano; a meta dele tira o café (146) e, no domingo, não há jantar.
    expect(r.dias.filter((x) => x.data === '2026-10-25')).toEqual([
      { plano: 'almoco-d', data: '2026-10-25', receita: 'r1', itens: [{ alimento_id: 'r1-al', quantidade_g: 1000 }] },
    ])
    // Segunda: r2 para os dois. d: 2000 − 146 − 159 (jantar) = 1695 kcal → 850 g; m: 1600 kcal → 800 g.
    expect(r.dias.filter((x) => x.data === '2026-10-26')).toEqual([
      { plano: 'almoco-d', data: '2026-10-26', receita: 'r2', itens: [{ alimento_id: 'r2-al', quantidade_g: 850 }] },
      { plano: 'almoco-m', data: '2026-10-26', receita: 'r2', itens: [{ alimento_id: 'r2-al', quantidade_g: 800 }] },
    ])
    expect(r.dias.filter((x) => x.data === '2026-10-27').map((x) => x.receita)).toEqual(['r1', 'r1'])
    expect([...r.semRefeicao]).toEqual(['m'])
  })

  it('divide o que falta entre almoço e jantar e respeita os tipos da receita', () => {
    const r = montarSemana({ datas: ['2026-10-26'], pessoas: ['d'], tipos: ['almoco', 'jantar'], receitas: [r1, r2] }, planos, [], metas, comp)
    // 2000 − 146 = 1854 kcal, 927 para cada. Almoço r1 (índice 0); jantar só aceita r1.
    expect(r.dias).toEqual([
      { plano: 'almoco-d', data: '2026-10-26', receita: 'r1', itens: [{ alimento_id: 'r1-al', quantidade_g: 600 }] },
      { plano: 'jantar-d', data: '2026-10-26', receita: 'r1', itens: [{ alimento_id: 'r1-al', quantidade_g: 600 }] },
    ])
  })

  it('conta o cardápio do dia que já existe nas outras refeições e avisa quem está sem meta', () => {
    const dias: DiaPlano[] = [{
      id: 'x', plano_refeicao_id: 'cafe-d', data: '2026-10-26', receita_id: null,
      plano_dia_item: [{ id: 'x1', quantidade_g: 300, ordem: 0, alimento: ovo }], // 438 kcal no lugar de 146
    }]
    expect(refeicoesDoDia(planos, dias, 'd', '2026-10-26').map((x) => x.itens.length)).toEqual([1, 2, 1])
    const r = montarSemana({ datas: ['2026-10-26'], pessoas: ['d', 'm'], tipos: ['almoco'], receitas: [r1] }, planos, dias,
      [meta('d', '2026-10-26', 2000), meta('m', '2026-10-26', null)], comp)
    // 2000 − 438 − 159 = 1403 kcal → 900 g
    expect(r.dias).toEqual([{ plano: 'almoco-d', data: '2026-10-26', receita: 'r1', itens: [{ alimento_id: 'r1-al', quantidade_g: 900 }] }])
    expect([...r.semMeta]).toEqual(['m'])
  })
})

describe('montarCompras', () => {
  it('abre a receita nos ingredientes e diz quantas panelas fazer', () => {
    const c = montarCompras([
      { data: '2026-10-26', pessoaId: 'd', itens: [{ id: '1', quantidade_g: 450, ordem: 0, alimento: { id: 'r1-al', nome: r1.nome } }] },
      { data: '2026-10-26', pessoaId: 'm', itens: [{ id: '2', quantidade_g: 300, ordem: 0, alimento: { id: 'r1-al', nome: r1.nome } }] },
      { data: '2026-10-27', pessoaId: 'd', itens: [{ id: '3', quantidade_g: 150, ordem: 0, alimento: arroz }, { id: '4', quantidade_g: 100, ordem: 1, alimento: ovo }] },
    ], [r1, r2], (id) => [arroz, frango, feijao, ovo].find((a) => a.id === id)?.categoria ?? null)
    expect(c.panelas.map((p) => [p.receita.id, p.gramas, p.vezes])).toEqual([['r1', 750, 1.5]])
    expect(c.categorias).toEqual([
      ['Carnes e derivados', [{ id: 'frango', nome: frango.nome, gramas: 300, porPessoa: { d: 180, m: 120 } }]],
      ['Cereais e derivados', [{ id: 'arroz', nome: arroz.nome, gramas: 450 + 150, porPessoa: { d: 270 + 150, m: 180 } }]],
      ['Leguminosas e derivados', [{ id: 'feijao', nome: feijao.nome, gramas: 150, porPessoa: { d: 90, m: 60 } }]],
      ['Ovos e derivados', [{ id: 'ovo', nome: ovo.nome, gramas: 100, porPessoa: { d: 100 } }]],
    ])
  })
  it('item avulso (sem ingredientes) vai direto para a lista', () => {
    const chocolate = { id: 'choc', nome: 'Chocolate, meio amargo', categoria: 'Produtos açucarados' }
    const avulso: Receita = { ...receita('a1', 'Chocolate meio amargo (30 g)', ['lanche_tarde'], 30, []), familia_id: null, porcao_g: 30, alimento_id: 'choc' }
    const c = montarCompras([
      { data: '2026-10-26', pessoaId: 'd', itens: [{ id: '1', quantidade_g: 30, ordem: 0, alimento: chocolate }] },
      { data: '2026-10-27', pessoaId: 'd', itens: [{ id: '2', quantidade_g: 30, ordem: 0, alimento: chocolate }] },
    ], [r1, avulso], () => null)
    expect(c.panelas).toEqual([])
    expect(c.categorias).toEqual([['Produtos açucarados', [{ id: 'choc', nome: chocolate.nome, gramas: 60, porPessoa: { d: 60 } }]]])
  })
  it('formata o peso', () => {
    expect(formatarPeso(853)).toBe('850 g')
    expect(formatarPeso(1890)).toBe('1,9 kg')
  })
})
