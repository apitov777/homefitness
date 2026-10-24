import { fmt, type Checagem, type TipoRefeicao } from './dados'

/** Tipo de refeição mais provável pela hora do dia (para registrar à mão e para o "comi algo a mais"). */
export function tipoPelaHora(h: number): TipoRefeicao {
  if (h < 10) return 'cafe'
  if (h < 12) return 'lanche_manha'
  if (h < 15) return 'almoco'
  if (h < 18) return 'lanche_tarde'
  if (h < 22) return 'jantar'
  return 'ceia'
}

export interface AndamentoDia {
  /** Fração da meta já comida, de 0 a 1 (para o anel). */
  pct: number
  estado: 'sem-meta' | 'falta' | 'na-meta' | 'passou'
  texto: string
}

/** Quanto do dia já foi comido contra a meta da pessoa: falta, na meta (entre 90% e 110%) ou passou. */
export function andamentoDia(kcal: number, meta: number | null | undefined): AndamentoDia {
  if (!meta) return { pct: 0, estado: 'sem-meta', texto: 'sem meta' }
  const pct = Math.max(0, Math.min(1, kcal / meta))
  if (kcal < meta * 0.9) return { pct, estado: 'falta', texto: `falta ${fmt(meta - kcal)} kcal` }
  if (kcal > meta * 1.1) return { pct: 1, estado: 'passou', texto: `passou ${fmt(kcal - meta)} kcal` }
  return { pct, estado: 'na-meta', texto: 'na meta' }
}

/** Refeições do plano do dia que já foram comidas: feitas como estava ou trocadas por outra coisa. */
export function feitasDoPlano(planos: { id: string }[], checagens: Pick<Checagem, 'plano_refeicao_id' | 'status'>[]): number {
  return planos.filter((p) => checagens.some((c) => c.plano_refeicao_id === p.id && (c.status === 'feita' || c.status === 'trocada'))).length
}

/** Descrição que marca uma refeição registrada como "comi algo a mais" (fora do plano). */
export const A_MAIS = 'A mais'
export const ehAMais = (descricao: string | null | undefined) => (descricao ?? '').trim().toLowerCase() === A_MAIS.toLowerCase()
