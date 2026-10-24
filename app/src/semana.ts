// Semana e mês: receitas, cardápio por dia, treinos e a meta de cada dia.
import { supabase } from './supabase'
import {
  carregarAlimentos, esquecerComposicao, hojeISO, somarDias, somarItens,
  type Composicao, type PlanoItem, type PlanoRefeicao, type TipoRefeicao,
} from './dados'

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

export function diaDaSemana(iso: string): number {
  return new Date(iso + 'T12:00:00').getDay()
}

/** A semana do app começa na segunda. */
export function inicioSemana(iso: string): string {
  return somarDias(iso, -((diaDaSemana(iso) + 6) % 7))
}

export function diasEntre(de: string, ate: string): string[] {
  const lista: string[] = []
  for (let d = de; d <= ate; d = somarDias(d, 1)) lista.push(d)
  return lista
}

export function mesDe(iso: string): { de: string; ate: string } {
  const [a, m] = iso.split('-').map(Number)
  const ultimo = new Date(a, m, 0).getDate()
  return { de: `${iso.slice(0, 7)}-01`, ate: `${iso.slice(0, 7)}-${String(ultimo).padStart(2, '0')}` }
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** "seg 26/10" */
export function rotuloDia(iso: string): string {
  return `${DIAS_CURTOS[diaDaSemana(iso)]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

/** "26 out – 1 nov" */
export function rotuloSemana(de: string, ate: string): string {
  const d = (iso: string) => `${Number(iso.slice(8, 10))} ${MESES[Number(iso.slice(5, 7)) - 1]}`
  return `${d(de)} – ${d(ate)}`
}

/** "outubro de 2026" */
export function rotuloMes(iso: string): string {
  return `${MESES_LONGOS[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`
}

// ---------------------------------------------------------------------------
// Receitas
// ---------------------------------------------------------------------------

export interface ItemReceita {
  id: string
  quantidade_g: number
  alimento: { id: string; nome: string; categoria: string | null }
}

export interface Receita {
  id: string
  /** Nulo: receita do catálogo, igual para todas as famílias. */
  familia_id: string | null
  nome: string
  descricao: string | null
  alimento_id: string
  rendimento_g: number
  /** Porção sugerida para uma pessoa; sem ela, a Semana usa de 100 g a 1 kg. */
  porcao_g: number | null
  modo_preparo: string | null
  tipos: TipoRefeicao[]
  tags: string[]
  /** 'fotos/<slug>.jpg' (arquivo do app, catálogo) ou '<familia_id>/<receita_id>.jpg' (Storage, da família). */
  foto: string | null
  ativa: boolean
  /** Vazio no item avulso do catálogo: o alimento é o próprio da TACO. */
  item_receita: ItemReceita[]
}

export const TAGS: Record<string, string> = {
  fitness: 'fitness', proteico: 'proteico', doce: 'doce', avulso: 'avulso', vegetariano: 'vegetariano', rápido: 'rápido',
  forno: 'forno', fibra: 'fibra', 'ômega-3': 'ômega-3', leve: 'leve', lanche: 'lanche', 'sem glúten': 'sem glúten',
}

/** Todas as receitas: catálogo e da família, inclusive as arquivadas (o cardápio antigo ainda aponta para elas). */
export async function carregarReceitas(): Promise<Receita[]> {
  const { data, error } = await supabase
    .from('receita')
    .select('id, familia_id, nome, descricao, alimento_id, rendimento_g, porcao_g, modo_preparo, tipos, tags, foto, ativa, item_receita(id, quantidade_g, alimento:alimento_id(id, nome, categoria))')
    .order('nome')
  if (error) throw error
  return (data as unknown as Receita[]).map((r) => ({
    ...r, rendimento_g: Number(r.rendimento_g), porcao_g: r.porcao_g == null ? null : Number(r.porcao_g),
    item_receita: r.item_receita.map((i) => ({ ...i, quantidade_g: Number(i.quantidade_g) })),
  }))
}

export async function salvarReceita(r: {
  id: string | null
  alimentoAntigo: string | null
  nome: string
  descricao: string
  tipos: TipoRefeicao[]
  rendimento_g: number
  porcao_g: number | null
  modo_preparo: string
  itens: { alimento_id: string; quantidade_g: number }[]
}): Promise<string> {
  const { data, error } = await supabase.rpc('salvar_receita', {
    p_id: r.id, p_nome: r.nome, p_tipos: r.tipos, p_rendimento_g: r.rendimento_g, p_modo_preparo: r.modo_preparo, p_itens: r.itens,
    p_porcao_g: r.porcao_g, p_descricao: r.descricao,
  })
  if (error) throw error
  // O valor por 100 g mudou e pode ter nascido um alimento novo: recarrega as listas.
  if (r.alimentoAntigo) esquecerComposicao(r.alimentoAntigo)
  await carregarAlimentos(true)
  return data as string
}

export async function arquivarReceita(id: string): Promise<void> {
  const { error } = await supabase.rpc('arquivar_receita', { p_id: id })
  if (error) throw error
  await carregarAlimentos(true)
}

/** Porção da receita em gramas: a sugerida, ou a receita inteira quando não há. */
export function porcaoDe(r: Pick<Receita, 'porcao_g' | 'rendimento_g'>): number {
  return r.porcao_g ?? r.rendimento_g
}

// Favoritas: por pessoa. São as que a Semana oferece.

export interface Favorita { pessoa_id: string; receita_id: string }

export async function carregarFavoritas(pessoaIds: string[]): Promise<Favorita[]> {
  if (!pessoaIds.length) return []
  const { data, error } = await supabase.from('receita_favorita').select('pessoa_id, receita_id').in('pessoa_id', pessoaIds)
  if (error) throw error
  return data as Favorita[]
}

export async function favoritar(pessoaId: string, receitaId: string, sim: boolean): Promise<void> {
  const { error } = sim
    ? await supabase.from('receita_favorita').upsert({ pessoa_id: pessoaId, receita_id: receitaId })
    : await supabase.from('receita_favorita').delete().eq('pessoa_id', pessoaId).eq('receita_id', receitaId)
  if (error) throw error
}

export const ehFavorita = (favs: Favorita[], pessoaId: string, receitaId: string) =>
  favs.some((f) => f.pessoa_id === pessoaId && f.receita_id === receitaId)

/** Receitas que entram no plano dessas pessoas: as favoritas de qualquer uma delas e as da família. Ativas só. */
export function receitasDoPlano(receitas: Receita[], favs: Favorita[], pessoaIds: string[]): Receita[] {
  return receitas.filter((r) => r.ativa && (r.familia_id || pessoaIds.some((p) => ehFavorita(favs, p, r.id))))
}

/** As mesmas receitas, para montar ou registrar uma refeição: as que servem para esse tipo vêm primeiro, depois as outras, cada grupo por nome. */
export function receitasParaRefeicao(receitas: Receita[], favs: Favorita[], pessoaIds: string[], tipo: TipoRefeicao | null): Receita[] {
  const serve = (r: Receita) => (tipo ? r.tipos.includes(tipo) : true)
  return receitasDoPlano(receitas, favs, pessoaIds).sort((a, b) => Number(serve(b)) - Number(serve(a)) || a.nome.localeCompare(b.nome, 'pt-BR'))
}

// ---------------------------------------------------------------------------
// Treinos
// ---------------------------------------------------------------------------

export interface Treino {
  id: string
  pessoa_id: string
  atividade: string
  met: number | null
  minutos: number
  kcal_informada: number | null
  dias: number[]
  ativo: boolean
}

/** MET do Compendium of Physical Activities (Ainsworth et al., 2011). */
export const ATIVIDADES: { nome: string; met: number }[] = [
  { nome: 'Musculação moderada', met: 3.5 },
  { nome: 'Musculação pesada', met: 6 },
  { nome: 'Treino funcional / circuito', met: 8 },
  { nome: 'Caminhada 5 km/h', met: 3.5 },
  { nome: 'Caminhada rápida 6,4 km/h', met: 5 },
  { nome: 'Corrida 8 km/h', met: 8.3 },
  { nome: 'Corrida 10 km/h', met: 9.8 },
  { nome: 'Corrida 11 km/h', met: 11 },
  { nome: 'Bicicleta (pedal)', met: 7.5 },
  { nome: 'Bicicleta ergométrica moderada', met: 6.8 },
  { nome: 'Elíptico moderado', met: 5 },
  { nome: 'Natação leve ou moderada', met: 5.8 },
  { nome: 'Natação forte', met: 9.8 },
  { nome: 'Pilates', met: 3 },
  { nome: 'Yoga', met: 2.5 },
  { nome: 'Dança / aeróbica', met: 7.3 },
  { nome: 'Futebol', met: 7 },
  { nome: 'Tênis', met: 7.3 },
  { nome: 'Vôlei de praia', met: 8 },
  { nome: 'Luta / artes marciais', met: 5.3 },
]

/**
 * Calorias de uma sessão: as do relógio, se informadas; senão (MET − 1) × peso × horas.
 * Tira 1 MET porque o repouso já está na TMB.
 */
export function kcalTreino(t: Pick<Treino, 'met' | 'minutos' | 'kcal_informada'>, pesoKg: number | null): number | null {
  if (t.kcal_informada) return Number(t.kcal_informada)
  if (!t.met || !pesoKg) return null
  return ((Number(t.met) - 1) * pesoKg * t.minutos) / 60
}

export async function carregarTreinos(pessoaIds: string[]): Promise<Treino[]> {
  if (!pessoaIds.length) return []
  const { data, error } = await supabase
    .from('treino_plano')
    .select('id, pessoa_id, atividade, met, minutos, kcal_informada, dias, ativo')
    .in('pessoa_id', pessoaIds)
    .eq('ativo', true)
    .order('created_at')
  if (error) throw error
  return data as Treino[]
}

export async function salvarTreino(t: Omit<Treino, 'id' | 'ativo'> & { id: string | null }): Promise<void> {
  const { id, ...valores } = t
  const { error } = id
    ? await supabase.from('treino_plano').update(valores).eq('id', id)
    : await supabase.from('treino_plano').insert(valores)
  if (error) throw error
}

export async function apagarTreino(id: string): Promise<void> {
  const { error } = await supabase.from('treino_plano').delete().eq('id', id)
  if (error) throw error
}

export async function ultimoPeso(pessoaId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('medida_corporal')
    .select('peso_kg')
    .eq('pessoa_id', pessoaId)
    .not('peso_kg', 'is', null)
    .lte('data', hojeISO())
    .order('data', { ascending: false })
    .limit(1)
  if (error) throw error
  return data[0] ? Number(data[0].peso_kg) : null
}

// ---------------------------------------------------------------------------
// Meta de cada dia (fixa ou acompanhando o treino), calculada no banco
// ---------------------------------------------------------------------------

export interface MetaDia {
  pessoa_id: string
  data: string
  kcal: number | null
  proteina_g: number | null
  carboidrato_g: number | null
  gordura_g: number | null
  tmb_kcal: number | null
  gasto_kcal: number | null
  treino_kcal: number
  pelo_treino: boolean
}

const numOuNulo = (v: unknown) => (v == null ? null : Number(v))

export async function carregarMetasDia(pessoaIds: string[], de: string, ate: string): Promise<MetaDia[]> {
  if (!pessoaIds.length) return []
  const { data, error } = await supabase.rpc('metas_do_periodo', { p_pessoas: pessoaIds, p_de: de, p_ate: ate })
  if (error) throw error
  return (data as MetaDia[]).map((m) => ({
    ...m,
    kcal: numOuNulo(m.kcal), proteina_g: numOuNulo(m.proteina_g), carboidrato_g: numOuNulo(m.carboidrato_g),
    gordura_g: numOuNulo(m.gordura_g), tmb_kcal: numOuNulo(m.tmb_kcal), gasto_kcal: numOuNulo(m.gasto_kcal),
    treino_kcal: Number(m.treino_kcal ?? 0),
  }))
}

// ---------------------------------------------------------------------------
// Cardápio do dia: uma refeição do plano pode trocar os itens de sempre num dia
// ---------------------------------------------------------------------------

export interface DiaPlano {
  id: string
  plano_refeicao_id: string
  data: string
  receita_id: string | null
  plano_dia_item: PlanoItem[]
}

export async function carregarDias(planoIds: string[], de: string, ate: string): Promise<DiaPlano[]> {
  if (!planoIds.length) return []
  const { data, error } = await supabase
    .from('plano_dia')
    .select('id, plano_refeicao_id, data, receita_id, plano_dia_item(id, quantidade_g, ordem, alimento:alimento_id(id, nome))')
    .in('plano_refeicao_id', planoIds)
    .gte('data', de)
    .lte('data', ate)
  if (error) throw error
  const lista = data as unknown as DiaPlano[]
  for (const d of lista) d.plano_dia_item.sort((a, b) => a.ordem - b.ordem)
  return lista
}

export interface DiaDefinido {
  plano: string
  data: string
  receita: string | null
  /** Vazio volta a refeição aos itens de sempre. */
  itens: { alimento_id: string; quantidade_g: number }[]
}

export async function definirDias(dias: DiaDefinido[]): Promise<void> {
  if (!dias.length) return
  const { error } = await supabase.rpc('definir_dias', { p_dias: dias })
  if (error) throw error
}

export interface RefeicaoDoDia {
  plano: PlanoRefeicao
  itens: PlanoItem[]
  /** Preenchido quando o dia tem cardápio próprio para esta refeição. */
  dia: DiaPlano | null
}

/** As refeições do plano que acontecem na data, com o cardápio do dia quando houver. */
export function refeicoesDoDia(planos: PlanoRefeicao[], dias: DiaPlano[], pessoaId: string, data: string): RefeicaoDoDia[] {
  const dow = diaDaSemana(data)
  return planos
    .filter((p) => p.pessoa_id === pessoaId && p.dias.includes(dow))
    .map((p) => {
      const dia = dias.find((d) => d.plano_refeicao_id === p.id && d.data === data) ?? null
      return { plano: p, itens: dia ? dia.plano_dia_item : p.plano_item, dia }
    })
}

export function kcalItens(itens: PlanoItem[], comp: Map<string, Composicao>): number {
  return somarItens(itens, comp).energia ?? 0
}

/** Fecha o dia dentro de ±5% da meta. */
export function situacaoDia(planejado: number, meta: number | null): 'ok' | 'falta' | 'passou' | null {
  if (!meta) return null
  const r = planejado / meta
  return r < 0.95 ? 'falta' : r > 1.05 ? 'passou' : 'ok'
}

/**
 * Gramas da receita para cobrir as calorias que faltam, de 10 em 10 g.
 * Com porção sugerida, fica entre metade e o dobro dela (um doce não vira o almoço); sem, entre 100 g e 1 kg.
 */
export function gramasParaFechar(kcalFaltando: number, kcalPor100g: number, porcao: number | null = null): number {
  const min = porcao ? Math.round(porcao / 2) : 100
  const max = porcao ? porcao * 2 : 1000
  if (!kcalPor100g) return porcao ?? 100
  const g = Math.round(((kcalFaltando / kcalPor100g) * 100) / 10) * 10
  return Math.min(max, Math.max(min, g))
}

export interface PedidoSemana {
  datas: string[]
  pessoas: string[]
  tipos: TipoRefeicao[]
  /** Na ordem em que devem se revezar. */
  receitas: Receita[]
}

export interface ResultadoSemana {
  dias: DiaDefinido[]
  semRefeicao: Set<string>
  semMeta: Set<string>
  semReceita: Set<TipoRefeicao>
}

/**
 * Monta as refeições escolhidas com as receitas, revezando por dia. No mesmo dia todos comem a mesma receita
 * (uma panela só) e só as gramas mudam: cada um recebe o que falta para fechar a própria meta do dia,
 * dividido entre as refeições que estão sendo montadas.
 */
export function montarSemana(
  pedido: PedidoSemana,
  planos: PlanoRefeicao[],
  dias: DiaPlano[],
  metas: MetaDia[],
  comp: Map<string, Composicao>,
): ResultadoSemana {
  const r: ResultadoSemana = { dias: [], semRefeicao: new Set(), semMeta: new Set(), semReceita: new Set() }
  pedido.datas.forEach((data, i) => {
    for (const pessoaId of pedido.pessoas) {
      const doDia = refeicoesDoDia(planos, dias, pessoaId, data)
      const vagas = pedido.tipos.map((t) => doDia.find((x) => x.plano.tipo === t)).filter((x): x is RefeicaoDoDia => !!x)
      if (!vagas.length) {
        r.semRefeicao.add(pessoaId)
        continue
      }
      const meta = metas.find((m) => m.pessoa_id === pessoaId && m.data === data)?.kcal
      if (!meta) {
        r.semMeta.add(pessoaId)
        continue
      }
      const fixas = doDia.filter((x) => !vagas.includes(x)).reduce((s, x) => s + kcalItens(x.itens, comp), 0)
      const porVaga = (meta - fixas) / vagas.length
      vagas.forEach((v, j) => {
        const opcoes = pedido.receitas.filter((x) => x.tipos.includes(v.plano.tipo))
        if (!opcoes.length) {
          r.semReceita.add(v.plano.tipo)
          return
        }
        const rec = opcoes[(i + j) % opcoes.length]
        const k100 = comp.get(rec.alimento_id)?.energia ?? 0
        r.dias.push({
          plano: v.plano.id,
          data,
          receita: rec.id,
          itens: [{ alimento_id: rec.alimento_id, quantidade_g: gramasParaFechar(porVaga, k100, rec.porcao_g) }],
        })
      })
    }
  })
  return r
}

// ---------------------------------------------------------------------------
// Quanto cozinhar e lista de compras
// ---------------------------------------------------------------------------

export interface Panela {
  receita: Receita
  gramas: number
  /** Quantas vezes a receita, pelo peso pronto. */
  vezes: number
  porDia: { data: string; pessoaId: string; gramas: number }[]
}

export interface LinhaCompra {
  id: string
  nome: string
  gramas: number
  /** Pessoa → gramas, para mostrar de quem é cada parte. */
  porPessoa: Record<string, number>
}

export interface Compras {
  panelas: Panela[]
  /** Categoria → itens, com as receitas abertas nos ingredientes. */
  categorias: [string, LinhaCompra[]][]
}

export function montarCompras(
  refeicoes: { data: string; pessoaId: string; itens: PlanoItem[] }[],
  receitas: Receita[],
  categoriaDe: (alimentoId: string) => string | null,
): Compras {
  const porAlimento = new Map(receitas.map((r) => [r.alimento_id, r]))
  const panelas = new Map<string, Panela>()
  const linhas = new Map<string, LinhaCompra & { categoria: string }>()
  const somar = (a: { id: string; nome: string; categoria?: string | null }, g: number, pessoaId: string) => {
    const l = linhas.get(a.id) ?? { id: a.id, nome: a.nome, gramas: 0, porPessoa: {}, categoria: a.categoria ?? categoriaDe(a.id) ?? 'Outros' }
    l.gramas += g
    l.porPessoa[pessoaId] = (l.porPessoa[pessoaId] ?? 0) + g
    linhas.set(a.id, l)
  }
  for (const ref of refeicoes) {
    for (const it of ref.itens) {
      const g = Number(it.quantidade_g)
      const rec = porAlimento.get(it.alimento.id)
      // Item avulso do catálogo é o próprio alimento da TACO: vai direto para a lista.
      if (!rec || !rec.item_receita.length) {
        somar(it.alimento, g, ref.pessoaId)
        continue
      }
      const p = panelas.get(rec.id) ?? { receita: rec, gramas: 0, vezes: 0, porDia: [] }
      p.gramas += g
      p.porDia.push({ data: ref.data, pessoaId: ref.pessoaId, gramas: g })
      panelas.set(rec.id, p)
      for (const ing of rec.item_receita) somar(ing.alimento, (Number(ing.quantidade_g) * g) / rec.rendimento_g, ref.pessoaId)
    }
  }
  const grupos = new Map<string, LinhaCompra[]>()
  for (const l of linhas.values()) {
    const g = grupos.get(l.categoria) ?? []
    g.push({ id: l.id, nome: l.nome, gramas: l.gramas, porPessoa: l.porPessoa })
    grupos.set(l.categoria, g)
  }
  return {
    panelas: [...panelas.values()]
      .map((p) => ({ ...p, vezes: p.gramas / p.receita.rendimento_g }))
      .sort((a, b) => b.gramas - a.gramas),
    categorias: [...grupos.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
      .map(([c, ls]) => [c, ls.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))]),
  }
}

/** "850 g" ou "1,9 kg" */
export function formatarPeso(g: number): string {
  if (g >= 1000) return `${(g / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`
  return `${Math.round(g / 10) * 10 || Math.round(g)} g`
}
