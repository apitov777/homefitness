// Compra da semana: o que comprar no fim de semana para seguir as dietas do plano na semana seguinte.
// A lista é calculada aqui; no banco ficam só as marcações da família (já peguei, opção escolhida).
import { supabase } from './supabase'
import { hojeISO, somarDias, type PlanoItem } from './dados'
import { inicioSemana, type RefeicaoDoDia } from './semana'

/** A segunda-feira da semana que vem (no domingo, é amanhã). */
export function proximaSemana(hoje = hojeISO()): string {
  return inicioSemana(somarDias(hoje, 7))
}

/** Plano refeição → opção escolhida para a semana (sem escolha = A). */
export type Escolhas = Record<string, string>

/**
 * Os itens que a refeição vai usar naquele dia: o cardápio do dia, se a Semana montou um;
 * senão a opção escolhida para a semana; senão a A.
 */
export function itensParaComprar(r: RefeicaoDoDia, escolhas: Escolhas): PlanoItem[] {
  if (r.dia) return r.itens
  const opcao = r.plano.plano_opcao.find((o) => o.id === escolhas[r.plano.id])
  return opcao ? opcao.plano_opcao_item : r.plano.plano_item
}

/** Letra da opção: A é a de sempre (ordem 0), B é a ordem 1… */
export function letraOpcao(ordem: number): string {
  return String.fromCharCode(65 + ordem)
}

export interface Medida { nome: string; g: number }

/** "≈ 7 unidades", quando o alimento tem a medida caseira de uma unidade; arredonda para cima. */
export function emUnidades(gramas: number, medidas: Medida[] | null | undefined): string | null {
  const m = (medidas ?? []).find((x) => /^unidade/i.test(x.nome) && Number(x.g) > 0)
  if (!m) return null
  const n = Math.ceil(gramas / Number(m.g) - 0.05)
  if (n < 1) return null
  return `≈ ${n} ${n === 1 ? 'unidade' : 'unidades'}`
}

/** O peso da tabela é o do alimento pronto: cru, a quantidade muda. */
export function pesoPronto(nome: string): boolean {
  return /\b(cozid[oa]s?|grelhad[oa]s?|assad[oa]s?|frit[oa]s?|refogad[oa]s?)\b/i.test(nome)
}

// ---------------------------------------------------------------------------
// Banco: marcações da família na semana
// ---------------------------------------------------------------------------

export async function carregarMarcadas(familiaId: string, semana: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('compra_marcada').select('alimento_id').eq('familia_id', familiaId).eq('semana', semana)
  if (error) throw error
  return new Set(data.map((x) => x.alimento_id as string))
}

export async function marcarCompra(familiaId: string, semana: string, alimentoId: string, sim: boolean): Promise<void> {
  const { error } = sim
    ? await supabase.from('compra_marcada').upsert({ familia_id: familiaId, semana, alimento_id: alimentoId }, { onConflict: 'familia_id,semana,alimento_id', ignoreDuplicates: true })
    : await supabase.from('compra_marcada').delete().eq('familia_id', familiaId).eq('semana', semana).eq('alimento_id', alimentoId)
  if (error) throw error
}

export async function carregarEscolhas(familiaId: string, semana: string): Promise<Escolhas> {
  const { data, error } = await supabase.from('compra_opcao').select('plano_refeicao_id, opcao_id').eq('familia_id', familiaId).eq('semana', semana)
  if (error) throw error
  return Object.fromEntries(data.map((x) => [x.plano_refeicao_id as string, x.opcao_id as string]))
}

/** Opção nula volta para a A. */
export async function escolherOpcao(familiaId: string, semana: string, planoId: string, opcaoId: string | null): Promise<void> {
  const { error } = opcaoId
    ? await supabase.from('compra_opcao').upsert({ familia_id: familiaId, semana, plano_refeicao_id: planoId, opcao_id: opcaoId }, { onConflict: 'familia_id,semana,plano_refeicao_id' })
    : await supabase.from('compra_opcao').delete().eq('familia_id', familiaId).eq('semana', semana).eq('plano_refeicao_id', planoId)
  if (error) throw error
}

export async function carregarMedidas(ids: string[]): Promise<Map<string, Medida[]>> {
  const m = new Map<string, Medida[]>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('alimento').select('id, medidas_caseiras').in('id', ids.slice(i, i + 200))
    if (error) throw error
    for (const a of data) m.set(a.id as string, (a.medidas_caseiras ?? []) as Medida[])
  }
  return m
}
