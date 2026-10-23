// Port de skills/nutricao-saude/scripts/calc_nutricional.py (mesmos fatores e regras).

export type Sexo = 'M' | 'F'
export type Atividade = 'sedentario' | 'leve' | 'moderado' | 'ativo' | 'muito_ativo'
export type Objetivo = 'manter' | 'perder' | 'perder_lento' | 'ganhar' | 'saude'

export const FATORES: Record<Atividade, number> = {
  sedentario: 1.2,
  leve: 1.375,
  moderado: 1.55,
  ativo: 1.725,
  muito_ativo: 1.9,
}

export const AJUSTE_OBJETIVO: Record<Objetivo, number> = {
  manter: 0,
  perder: -0.18,
  perder_lento: -0.1,
  ganhar: 0.12,
  saude: -0.05,
}

const PROTEINA_PADRAO: Record<Objetivo, number> = {
  manter: 1.4,
  perder: 1.8,
  perder_lento: 1.8,
  ganhar: 1.8,
  saude: 1.4,
}

export const NOMES_ATIVIDADE: Record<Atividade, string> = {
  sedentario: 'Sedentário',
  leve: 'Leve (1–3×/semana)',
  moderado: 'Moderado (3–5×/semana)',
  ativo: 'Ativo (6–7×/semana)',
  muito_ativo: 'Muito ativo (treino pesado diário)',
}

export const NOMES_OBJETIVO: Record<Objetivo, string> = {
  manter: 'Manter o peso',
  perder: 'Perder gordura (−18%)',
  perder_lento: 'Perder devagar (−10%)',
  ganhar: 'Ganhar massa (+12%)',
  saude: 'Saúde geral (−5%)',
}

export interface EntradaCalculo {
  sexo: Sexo
  idade: number
  pesoKg: number
  alturaCm: number
  atividade: Atividade
  objetivo: Objetivo
  gorduraPct?: number | null
}

export interface ResultadoCalculo {
  metodo: 'mifflin-st-jeor' | 'katch-mcardle'
  tmbKcal: number
  fatorAtividade: number
  tdeeKcal: number
  ajusteObjetivo: number
  kcal: number
  proteinaG: number
  proteinaGkg: number
  gorduraG: number
  carboidratoG: number
  fibraG: number
  aguaMl: number
  avisos: string[]
}

// Arredonda como o round() do Python (meio para o par), para bater com o script de referência.
function round(x: number, casas = 0): number {
  const f = 10 ** casas
  const v = x * f
  const r = Math.round(v)
  const meio = Math.abs(v % 1) === 0.5
  return (meio && r % 2 !== 0 ? r - 1 : r) / f
}

export function calcular(e: EntradaCalculo): ResultadoCalculo {
  let tmb: number
  let metodo: ResultadoCalculo['metodo']
  if (e.gorduraPct) {
    tmb = 370 + 21.6 * e.pesoKg * (1 - e.gorduraPct / 100)
    metodo = 'katch-mcardle'
  } else {
    const base = 10 * e.pesoKg + 6.25 * e.alturaCm - 5 * e.idade
    tmb = e.sexo === 'M' ? base + 5 : base - 161
    metodo = 'mifflin-st-jeor'
  }

  const tdee = tmb * FATORES[e.atividade]
  const ajuste = AJUSTE_OBJETIVO[e.objetivo]
  let kcal = tdee * (1 + ajuste)
  const avisos: string[] = []
  if (kcal < tmb) {
    avisos.push('Meta abaixo da TMB — elevada para a TMB.')
    kcal = tmb
  }

  let pGkg = PROTEINA_PADRAO[e.objetivo]
  if (e.atividade === 'sedentario') pGkg = Math.min(pGkg, 1.2)
  if (e.idade >= 65 && pGkg < 1.0) pGkg = 1.0
  const proteinaG = pGkg * e.pesoKg
  const gorduraG = Math.max((0.28 * kcal) / 9, 0.7 * e.pesoKg) // nunca abaixo de 0,7 g/kg
  const carboG = (kcal - proteinaG * 4 - gorduraG * 9) / 4
  if (carboG < 1.5 * e.pesoKg) {
    avisos.push('Carboidrato ficou baixo (< 1,5 g/kg); considere reduzir proteína ou gordura.')
  }

  return {
    metodo,
    tmbKcal: round(tmb),
    fatorAtividade: FATORES[e.atividade],
    tdeeKcal: round(tdee),
    ajusteObjetivo: ajuste,
    kcal: round(kcal),
    proteinaG: round(proteinaG),
    proteinaGkg: round(pGkg, 2),
    gorduraG: round(gorduraG),
    carboidratoG: round(Math.max(carboG, 0)),
    fibraG: round((14 * kcal) / 1000),
    aguaMl: round(33 * e.pesoKg),
    avisos,
  }
}

export function idadeEm(dataNascimento: string, hoje = new Date()): number {
  const n = new Date(dataNascimento + 'T12:00:00')
  let idade = hoje.getFullYear() - n.getFullYear()
  const m = hoje.getMonth() - n.getMonth()
  if (m < 0 || (m === 0 && hoje.getDate() < n.getDate())) idade--
  return idade
}
