// Dietas: um dia inteiro de refeições com opções A/B/C de calorias parecidas, ligado ao gasto do dia.
// Aqui ficam as contas puras; o banco está em dados.ts e a tela em telas/Dietas.tsx.
import { somarItens, type Composicao, type PlanoItem, type PlanoRefeicao, type TipoRefeicao } from './dados'
import { gramasParaFechar, porcaoDe, receitasDoPlano, type Favorita, type Receita } from './semana'

export interface ModeloRefeicao { tipo: TipoRefeicao; hora: string; fracao: number }

/** Como dividir o dia por número de refeições: tipo, horário e fração das kcal (somam 1). */
export const MODELOS: Record<number, ModeloRefeicao[]> = {
  3: [
    { tipo: 'cafe', hora: '07:00', fracao: 0.25 }, { tipo: 'almoco', hora: '12:30', fracao: 0.4 }, { tipo: 'jantar', hora: '19:30', fracao: 0.35 },
  ],
  4: [
    { tipo: 'cafe', hora: '07:00', fracao: 0.25 }, { tipo: 'almoco', hora: '12:30', fracao: 0.35 },
    { tipo: 'lanche_tarde', hora: '16:00', fracao: 0.1 }, { tipo: 'jantar', hora: '19:30', fracao: 0.3 },
  ],
  5: [
    { tipo: 'cafe', hora: '07:00', fracao: 0.2 }, { tipo: 'lanche_manha', hora: '10:00', fracao: 0.1 }, { tipo: 'almoco', hora: '12:30', fracao: 0.3 },
    { tipo: 'lanche_tarde', hora: '16:00', fracao: 0.12 }, { tipo: 'jantar', hora: '19:30', fracao: 0.28 },
  ],
  6: [
    { tipo: 'cafe', hora: '07:00', fracao: 0.18 }, { tipo: 'lanche_manha', hora: '10:00', fracao: 0.1 }, { tipo: 'almoco', hora: '12:30', fracao: 0.27 },
    { tipo: 'lanche_tarde', hora: '16:00', fracao: 0.1 }, { tipo: 'jantar', hora: '19:30', fracao: 0.25 }, { tipo: 'ceia', hora: '21:30', fracao: 0.1 },
  ],
}

export function modeloDoDia(n: number): ModeloRefeicao[] {
  return MODELOS[Math.min(6, Math.max(3, n))]
}

/** Alvo de kcal de uma refeição a partir do alvo do dia, em múltiplos de 10. */
export function alvoDaRefeicao(kcalDia: number, fracao: number): number {
  return Math.max(10, Math.round((kcalDia * fracao) / 10) * 10)
}

export const letra = (i: number) => String.fromCharCode(65 + i)

export interface Opcao {
  /** Nula para a opção A (os itens de sempre da refeição). */
  id: string | null
  letra: string
  nome: string | null
  itens: PlanoItem[]
}

/** As opções de uma refeição: A (plano_item) e depois B, C… (plano_opcao). */
export function opcoesDe(p: Pick<PlanoRefeicao, 'plano_item' | 'plano_opcao'>): Opcao[] {
  return [
    { id: null, letra: 'A', nome: null, itens: p.plano_item },
    ...(p.plano_opcao ?? []).map((o, i) => ({ id: o.id, letra: letra(i + 1), nome: o.nome, itens: o.plano_opcao_item })),
  ]
}

export const kcalDe = (itens: { quantidade_g: number; alimento: { id: string } }[], comp: Map<string, Composicao>) =>
  somarItens(itens, comp).energia ?? 0

/** Reescala as gramas de todos os itens na mesma proporção para a opção chegar ao alvo. Múltiplos de 5 g. */
export function escalarParaKcal<T extends { quantidade_g: number; alimento: { id: string } }>(itens: T[], comp: Map<string, Composicao>, alvo: number): T[] {
  const atual = kcalDe(itens, comp)
  if (!atual || !alvo) return itens
  const f = alvo / atual
  return itens.map((it) => ({ ...it, quantidade_g: Math.max(5, Math.round((it.quantidade_g * f) / 5) * 5) }))
}

/** Desvio da opção em relação ao alvo da refeição (0,1 = 10% acima). */
export function desvio(kcal: number, alvo: number | null): number | null {
  return alvo ? (kcal - alvo) / alvo : null
}

/** A opção "tem as mesmas calorias" quando fica a até 10% do alvo. */
export const naFaixa = (kcal: number, alvo: number | null) => alvo == null || Math.abs(desvio(kcal, alvo) ?? 0) <= 0.1

export interface Sugestao { receita: Receita; gramas: number; kcal: number }

/**
 * Opções para uma refeição a partir das receitas da semana da pessoa (favoritas e da família) que servem
 * para o tipo, nas gramas que chegam ao alvo (entre ½ e 2× a porção). As mais próximas do alvo primeiro.
 */
export function sugerirOpcoes(
  receitas: Receita[], favs: Favorita[], pessoaId: string, tipo: TipoRefeicao, alvo: number,
  comp: Map<string, Composicao>, excluirAlimentos: Set<string> = new Set(), max = 3,
): Sugestao[] {
  return receitasDoPlano(receitas, favs, [pessoaId])
    .filter((r) => r.tipos.includes(tipo) && !excluirAlimentos.has(r.alimento_id))
    .map((r) => {
      const por100 = comp.get(r.alimento_id)?.energia ?? 0
      const gramas = gramasParaFechar(alvo, por100, porcaoDe(r))
      return { receita: r, gramas, kcal: (por100 * gramas) / 100 }
    })
    .filter((s) => s.kcal > 0)
    .sort((a, b) => Math.abs(a.kcal - alvo) - Math.abs(b.kcal - alvo))
    .slice(0, max)
}

export interface ResumoRefeicao { plano: PlanoRefeicao; alvo: number | null; opcoes: { letra: string; kcal: number; naFaixa: boolean }[] }

/** O dia da dieta: kcal da opção A de cada refeição somadas, e se todas as opções ficam na faixa do alvo. */
export function resumoDieta(refeicoes: PlanoRefeicao[], comp: Map<string, Composicao>): { kcalA: number; refeicoes: ResumoRefeicao[]; todasNaFaixa: boolean } {
  const rs = refeicoes.map((p) => ({
    plano: p,
    alvo: p.kcal_alvo,
    opcoes: opcoesDe(p).map((o) => {
      const kcal = kcalDe(o.itens, comp)
      return { letra: o.letra, kcal, naFaixa: naFaixa(kcal, p.kcal_alvo) }
    }),
  }))
  return {
    kcalA: rs.reduce((s, r) => s + (r.opcoes[0]?.kcal ?? 0), 0),
    refeicoes: rs,
    todasNaFaixa: rs.every((r) => r.opcoes.every((o) => o.naFaixa)),
  }
}

/** Dieta que vale numa data (pelo dia da semana) para a pessoa. */
export function dietaDoDia<D extends { pessoa_id: string; dias: number[] }>(dietas: D[], pessoaId: string, dow: number): D | undefined {
  return dietas.find((d) => d.pessoa_id === pessoaId && d.dias.includes(dow))
}
