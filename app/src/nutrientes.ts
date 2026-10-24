// Tabela de nutrientes e recomendações diárias (RDA/AI por sexo e idade), para mostrar "% do dia".
import { supabase } from './supabase'
import { idadeEm } from './calc'
import type { Pessoa } from './dados'

export interface Nutriente {
  codigo: string
  nome: string
  unidade: string
  grupo: 'macro' | 'vitamina' | 'mineral' | 'outro' | null
  ordem: number | null
}

export interface Recomendacao {
  nutriente: { codigo: string }
  sexo: string
  idade_min: number
  idade_max: number
  rda: number | null
  ai: number | null
}

let cacheNutrientes: Nutriente[] | null = null
let cacheRecs: Recomendacao[] | null = null

export async function carregarNutrientes(): Promise<Nutriente[]> {
  if (cacheNutrientes) return cacheNutrientes
  const { data, error } = await supabase.from('nutriente').select('codigo, nome, unidade, grupo, ordem').order('ordem')
  if (error) throw error
  cacheNutrientes = data as Nutriente[]
  return cacheNutrientes
}

export async function carregarRecomendacoes(): Promise<Recomendacao[]> {
  if (cacheRecs) return cacheRecs
  const { data, error } = await supabase
    .from('nutriente_recomendacao')
    .select('sexo, idade_min, idade_max, rda, ai, nutriente:nutriente_id(codigo)')
  if (error) throw error
  cacheRecs = data as unknown as Recomendacao[]
  return cacheRecs
}

/** Valor diário recomendado (RDA, ou AI quando não há RDA) para a pessoa; nulo sem sexo e nascimento. */
export function recomendada(recs: Recomendacao[], p: Pessoa, codigo: string): number | null {
  if (!p.sexo || !p.data_nascimento) return null
  const idade = idadeEm(p.data_nascimento, new Date())
  const r = recs.find((x) => x.nutriente.codigo === codigo && x.sexo === p.sexo && idade >= x.idade_min && idade <= x.idade_max)
  return r ? Number(r.rda ?? r.ai) : null
}

/** Casas decimais que fazem sentido para o valor: 1.234 → 0, 12,3 → 1, 0,45 → 2. */
export function casasPara(v: number): number {
  return v >= 10 ? 0 : v >= 1 ? 1 : 2
}
