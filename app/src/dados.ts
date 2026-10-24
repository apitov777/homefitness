import { supabase } from './supabase'
import type { Atividade, Objetivo, ResultadoCalculo, Sexo } from './calc'

export type TipoRefeicao =
  | 'cafe' | 'lanche_manha' | 'almoco' | 'lanche_tarde' | 'jantar' | 'ceia' | 'pre_treino' | 'pos_treino' | 'outro'

export const TIPOS_REFEICAO: { valor: TipoRefeicao; nome: string }[] = [
  { valor: 'cafe', nome: 'Café da manhã' },
  { valor: 'lanche_manha', nome: 'Lanche da manhã' },
  { valor: 'almoco', nome: 'Almoço' },
  { valor: 'lanche_tarde', nome: 'Lanche da tarde' },
  { valor: 'jantar', nome: 'Jantar' },
  { valor: 'ceia', nome: 'Ceia' },
  { valor: 'pre_treino', nome: 'Pré-treino' },
  { valor: 'pos_treino', nome: 'Pós-treino' },
  { valor: 'outro', nome: 'Outro' },
]

export interface Pessoa {
  id: string
  familia_id: string
  user_id: string | null
  nome: string
  sexo: Sexo | null
  data_nascimento: string | null
  altura_cm: number | null
  nivel_atividade: Atividade | null
  objetivo: Objetivo | null
  restricoes: string[] | null
  preferencias: string | null
  compartilha_exames: boolean
  aviso_resumo: string | null
  /** TMB × fator da rotina sem o treino; o treino entra à parte quando a meta acompanha o treino. */
  fator_rotina: number
  meta_pelo_treino: boolean
}

/** Sem estes dados não dá para calcular a meta; o app abre o cadastro inicial. */
export function cadastroIncompleto(p: Pessoa): boolean {
  return !p.sexo || !p.data_nascimento || !p.altura_cm || !p.nivel_atividade || !p.objetivo
}

export interface Meta {
  id: string
  pessoa_id: string
  inicio: string
  fim: string | null
  tmb_kcal: number | null
  tdee_kcal: number | null
  kcal: number
  proteina_g: number | null
  carboidrato_g: number | null
  gordura_g: number | null
  fibra_g: number | null
  agua_ml: number | null
  metodo: string | null
}

export function nomeTipo(t: TipoRefeicao): string {
  return TIPOS_REFEICAO.find((x) => x.valor === t)?.nome ?? t
}

/** 0 = domingo, como Date.getDay() e extract(dow) no banco. */
export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export function descreverDias(dias: number[]): string {
  const d = [...dias].sort()
  if (d.length === 7) return 'todo dia'
  if (d.join() === '1,2,3,4,5') return 'seg a sex'
  if (d.join() === '0,6') return 'fim de semana'
  return d.map((x) => DIAS_SEMANA[x].toLowerCase()).join(', ')
}

export interface PlanoItem {
  id: string
  quantidade_g: number
  ordem: number
  alimento: { id: string; nome: string }
}

/** Opção B, C… de uma refeição do plano (a A é plano_item). */
export interface PlanoOpcao {
  id: string
  ordem: number
  nome: string | null
  plano_opcao_item: PlanoItem[]
}

export interface PlanoRefeicao {
  id: string
  pessoa_id: string
  tipo: TipoRefeicao
  nome: string | null
  hora: string
  dias: number[]
  avisar: boolean
  ativo: boolean
  dieta_id: string | null
  kcal_alvo: number | null
  plano_item: PlanoItem[]
  plano_opcao: PlanoOpcao[]
}

/** Um dia inteiro de refeições com opções, que vale nos dias da semana marcados (um dia tem uma dieta só). */
export interface Dieta {
  id: string
  pessoa_id: string
  nome: string
  kcal_alvo: number | null
  dias: number[]
}

export interface Checagem {
  id: string
  opcao_id?: string | null
  plano_refeicao_id: string
  data: string
  status: 'feita' | 'pulada' | 'trocada'
  refeicao_id: string | null
}

const SELECT_PLANO = 'id, pessoa_id, tipo, nome, hora, dias, avisar, ativo, dieta_id, kcal_alvo, '
  + 'plano_item(id, quantidade_g, ordem, alimento:alimento_id(id, nome)), '
  + 'plano_opcao(id, ordem, nome, plano_opcao_item(id, quantidade_g, ordem, alimento:alimento_id(id, nome)))'

function arrumarPlanos(data: unknown): PlanoRefeicao[] {
  const lista = data as PlanoRefeicao[]
  for (const p of lista) {
    p.plano_item.sort((a, b) => a.ordem - b.ordem)
    p.kcal_alvo = p.kcal_alvo == null ? null : Number(p.kcal_alvo)
    p.plano_opcao = (p.plano_opcao ?? []).sort((a, b) => a.ordem - b.ordem)
    for (const o of p.plano_opcao) o.plano_opcao_item.sort((a, b) => a.ordem - b.ordem)
  }
  return lista
}

/** As refeições do plano que valem (ativas): as de sempre e as das dietas com dia marcado. */
export async function carregarPlanos(pessoaIds: string[]): Promise<PlanoRefeicao[]> {
  if (!pessoaIds.length) return []
  const { data, error } = await supabase.from('plano_refeicao').select(SELECT_PLANO).in('pessoa_id', pessoaIds).eq('ativo', true).order('hora')
  if (error) throw error
  return arrumarPlanos(data)
}

/** Todas as refeições de uma dieta, inclusive as inativas (dieta sem dia marcado). */
export async function carregarRefeicoesDaDieta(dietaId: string): Promise<PlanoRefeicao[]> {
  const { data, error } = await supabase.from('plano_refeicao').select(SELECT_PLANO).eq('dieta_id', dietaId).order('hora')
  if (error) throw error
  return arrumarPlanos(data)
}

export async function carregarDietas(pessoaIds: string[]): Promise<Dieta[]> {
  if (!pessoaIds.length) return []
  const { data, error } = await supabase.from('dieta').select('id, pessoa_id, nome, kcal_alvo, dias').in('pessoa_id', pessoaIds).order('nome')
  if (error) throw error
  return (data as Dieta[]).map((d) => ({ ...d, kcal_alvo: d.kcal_alvo == null ? null : Number(d.kcal_alvo) }))
}

export async function salvarDieta(d: { id: string | null; pessoa_id: string; nome: string; kcal_alvo: number | null; dias: number[] }): Promise<string> {
  const { data, error } = await supabase.rpc('salvar_dieta', { p_id: d.id, p_pessoa: d.pessoa_id, p_nome: d.nome, p_kcal_alvo: d.kcal_alvo, p_dias: d.dias })
  if (error) throw error
  return data as string
}

export async function apagarDieta(id: string): Promise<void> {
  const { error } = await supabase.rpc('apagar_dieta', { p_id: id })
  if (error) throw error
}

export interface ItemGramas { alimento_id: string; quantidade_g: number }

/** Grava uma refeição do plano com a opção A (itens) e as opções B, C… */
export async function salvarPlanoRefeicao(r: {
  id: string | null; pessoa_id: string; tipo: TipoRefeicao; nome: string; hora: string; dias: number[]; avisar: boolean
  itens: ItemGramas[]; dieta_id?: string | null; kcal_alvo?: number | null; opcoes?: { nome: string | null; itens: ItemGramas[] }[]
}): Promise<string> {
  const { data, error } = await supabase.rpc('salvar_plano_refeicao', {
    p_id: r.id, p_pessoa: r.pessoa_id, p_tipo: r.tipo, p_nome: r.nome, p_hora: r.hora, p_dias: [...r.dias].sort(), p_avisar: r.avisar,
    p_itens: r.itens, p_dieta: r.dieta_id ?? null, p_kcal_alvo: r.kcal_alvo ?? null, p_opcoes: r.opcoes ?? [],
  })
  if (error) throw error
  return data as string
}

export async function apagarPlanoRefeicao(id: string): Promise<void> {
  const { error } = await supabase.from('plano_refeicao').delete().eq('id', id)
  if (error) throw error
}

/** Soma os nutrientes de itens em gramas, pela composição por 100 g. */
export function somarItens(itens: { quantidade_g: number; alimento: { id: string } }[], comp: Map<string, Composicao>): Composicao {
  const t: Composicao = {}
  for (const it of itens) {
    for (const [k, v] of Object.entries(comp.get(it.alimento.id) ?? {})) t[k] = (t[k] ?? 0) + (v * it.quantidade_g) / 100
  }
  return t
}

/** Situação do dia contra a meta de energia: batida entre 90% e 110%. */
export function situacaoMeta(kcal: number, meta: number | null | undefined): { batida: boolean; texto: string } | null {
  if (!meta) return null
  const pct = kcal / meta
  if (pct >= 0.9 && pct <= 1.1) return { batida: true, texto: `Meta batida: ${fmt(kcal)} de ${fmt(meta)} kcal (${fmt(pct * 100)}%)` }
  if (pct < 0.9) return { batida: false, texto: `Faltam ${fmt(meta * 0.9 - kcal)} kcal para chegar a 90% da meta (${fmt(meta)} kcal)` }
  return { batida: false, texto: `Passou ${fmt(kcal - meta * 1.1)} kcal dos 110% da meta (${fmt(meta)} kcal)` }
}

export interface AlimentoResumo {
  id: string
  nome: string
  categoria: string | null
  fonte: string
  familia_id: string | null
  busca: string
}

/** Nutrientes por 100 g, por código (energia, proteina…). */
export type Composicao = Record<string, number>

export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function hojeISO(d = new Date()): string {
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

export function somarDias(iso: string, dias: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + dias)
  return hojeISO(d)
}

/** Número digitado com vírgula ou ponto; vazio, negativo ou inválido vira 0. */
export function lerNumero(s: string): number {
  const n = parseFloat(s.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function erroTexto(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

export async function carregarPessoas(familiaId: string): Promise<Pessoa[]> {
  const { data, error } = await supabase.from('pessoa').select('*').eq('familia_id', familiaId).order('created_at')
  if (error) throw error
  return data as Pessoa[]
}

export async function carregarMetasVigentes(pessoaIds: string[]): Promise<Record<string, Meta>> {
  if (!pessoaIds.length) return {}
  const { data, error } = await supabase.from('meta').select('*').in('pessoa_id', pessoaIds).is('fim', null)
  if (error) throw error
  return Object.fromEntries((data as Meta[]).map((m) => [m.pessoa_id, m]))
}

/** Grava a meta calculada: substitui a de hoje ou encerra a anterior ontem e abre uma nova. */
export async function salvarMeta(pessoaId: string, calc: ResultadoCalculo, atual: Meta | null): Promise<void> {
  const hoje = hojeISO()
  const valores = {
    tmb_kcal: calc.tmbKcal, tdee_kcal: calc.tdeeKcal, kcal: calc.kcal, proteina_g: calc.proteinaG,
    carboidrato_g: calc.carboidratoG, gordura_g: calc.gorduraG, fibra_g: calc.fibraG, agua_ml: calc.aguaMl,
    metodo: calc.metodo,
  }
  if (atual && atual.inicio === hoje) {
    const { error } = await supabase.from('meta').update(valores).eq('id', atual.id)
    if (error) throw error
    return
  }
  if (atual) {
    const { error } = await supabase.from('meta').update({ fim: somarDias(hoje, -1) }).eq('id', atual.id)
    if (error) throw error
  }
  const { error } = await supabase.from('meta').insert({ pessoa_id: pessoaId, inicio: hoje, ...valores })
  if (error) throw error
}

let cacheAlimentos: AlimentoResumo[] | null = null

export async function carregarAlimentos(forcar = false): Promise<AlimentoResumo[]> {
  if (cacheAlimentos && !forcar) return cacheAlimentos
  const lista: AlimentoResumo[] = []
  // PostgREST devolve no máximo 1000 linhas por chamada; paginamos.
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase
      .from('alimento')
      .select('id, nome, categoria, fonte, familia_id')
      .eq('ativo', true)
      .order('nome')
      .range(de, de + 999)
    if (error) throw error
    for (const a of data) lista.push({ ...(a as Omit<AlimentoResumo, 'busca'>), busca: semAcento(a.nome) })
    if (data.length < 1000) break
  }
  cacheAlimentos = lista
  return lista
}

export function buscarAlimentos(lista: AlimentoResumo[], termo: string, limite = 30): AlimentoResumo[] {
  const partes = semAcento(termo).split(/[\s,]+/).filter(Boolean)
  if (!partes.length) return []
  return lista
    .filter((a) => partes.every((p) => a.busca.includes(p)))
    .sort((a, b) => {
      // os da família primeiro, depois os que começam com o termo
      if (!!a.familia_id !== !!b.familia_id) return a.familia_id ? -1 : 1
      const ia = a.busca.startsWith(partes[0]) ? 0 : 1
      const ib = b.busca.startsWith(partes[0]) ? 0 : 1
      return ia - ib || a.nome.length - b.nome.length
    })
    .slice(0, limite)
}

const cacheComposicao = new Map<string, Composicao>()

export async function carregarComposicao(ids: string[]): Promise<Map<string, Composicao>> {
  const faltam = [...new Set(ids.filter((id) => !cacheComposicao.has(id)))]
  if (faltam.length) {
    for (const id of faltam) cacheComposicao.set(id, {})
    // Cada alimento tem ~25 nutrientes e o PostgREST devolve no máximo 1000 linhas por chamada:
    // 66 receitas já passam disso. Paginamos em ordem fixa até vir uma página incompleta.
    for (let de = 0; ; de += 1000) {
      const { data, error } = await supabase
        .from('alimento_nutriente')
        .select('alimento_id, valor_por_100g, nutriente:nutriente_id(codigo)')
        .in('alimento_id', faltam)
        .order('alimento_id')
        .order('nutriente_id')
        .range(de, de + 999)
      if (error) throw error
      for (const linha of data as unknown as { alimento_id: string; valor_por_100g: number; nutriente: { codigo: string } }[]) {
        cacheComposicao.get(linha.alimento_id)![linha.nutriente.codigo] = Number(linha.valor_por_100g)
      }
      if (data.length < 1000) break
    }
  }
  return new Map(ids.map((id) => [id, cacheComposicao.get(id)!]))
}

export function esquecerComposicao(id: string) {
  cacheComposicao.delete(id)
}

export function fmt(n: number | null | undefined, casas = 0): string {
  if (n == null || Number.isNaN(n)) return '–'
  return n.toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: 0 })
}
