import { useEffect, useMemo, useState } from 'react'
import type { Contexto } from '../App'
import { supabase } from '../supabase'
import {
  carregarComposicao, carregarDietas, carregarMetasVigentes, carregarPlanos, erroTexto, fmt, hojeISO, somarDias,
  TIPOS_REFEICAO,
  type Checagem, type Composicao, type Dieta, type Meta, type Pessoa, type PlanoRefeicao, type TipoRefeicao,
} from '../dados'
import { dietaDoDia } from '../dietas'
import { andamentoDia, ehAMais, feitasDoPlano } from '../hoje'
import { idadeEm } from '../calc'
import { carregarDias, carregarMetasDia, carregarTreinos, diaDaSemana, type MetaDia, type Treino } from '../semana'
import CartaoInstalar from './Instalar'
import RegistroRapido from './RegistroRapido'

interface ItemDia {
  id: string
  quantidade_g: number
  medida_caseira: string | null
  alimento: { id: string; nome: string }
}

interface RefeicaoDia {
  id: string
  pessoa_id: string
  tipo: TipoRefeicao
  hora: string | null
  refeicao_grupo_id: string | null
  refeicao_grupo: { descricao: string | null } | null
  item_refeicao: ItemDia[]
}

interface Recomendacao {
  nutriente: { codigo: string; nome: string; unidade: string }
  sexo: string
  idade_min: number
  idade_max: number
  rda: number | null
  ai: number | null
}

// Micronutrientes que a TACO traz e que pesam nos exames acompanhados.
const MICROS = ['ferro', 'calcio', 'magnesio', 'zinco', 'potassio', 'sodio', 'vit_c', 'vit_a', 'b6', 'fibra']

function somar(itens: ItemDia[], comp: Map<string, Composicao>): Composicao {
  const t: Composicao = {}
  for (const it of itens) {
    const c = comp.get(it.alimento.id) ?? {}
    for (const [k, v] of Object.entries(c)) t[k] = (t[k] ?? 0) + (v * it.quantidade_g) / 100
  }
  return t
}

function Barra({ rotulo, valor, meta, unidade }: { rotulo: string; valor: number; meta?: number | null; unidade: string }) {
  const pct = meta ? Math.min(100, (valor / meta) * 100) : 0
  const passou = meta ? valor > meta * 1.05 : false
  return (
    <div className="barra">
      <div className="barra-topo">
        <span>{rotulo}</span>
        <span>
          {fmt(valor)}{meta ? ` / ${fmt(meta)}` : ''} {unidade}
        </span>
      </div>
      {meta ? (
        <div className="trilho">
          <div className={'enchimento' + (passou ? ' passou' : '')} style={{ width: pct + '%' }} />
        </div>
      ) : null}
    </div>
  )
}

export default function Hoje({ ctx, versao, onRegistrar }: { ctx: Contexto; versao: number; onRegistrar: () => void }) {
  const [data, setData] = useState(hojeISO())
  const [refeicoes, setRefeicoes] = useState<RefeicaoDia[]>([])
  const [comp, setComp] = useState<Map<string, Composicao>>(new Map())
  const [metas, setMetas] = useState<Record<string, Meta>>({})
  const [recs, setRecs] = useState<Recomendacao[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [abertoMicros, setAbertoMicros] = useState<string | null>(null)
  const [planos, setPlanos] = useState<PlanoRefeicao[]>([])
  const [metasDia, setMetasDia] = useState<MetaDia[]>([])
  const [treinos, setTreinos] = useState<Treino[]>([])
  const [checagens, setChecagens] = useState<Checagem[]>([])
  const [dietas, setDietas] = useState<Dieta[]>([])
  const [tick, setTick] = useState(0)
  // Pessoa aberta embaixo da meta da família: quem está logado, por padrão.
  const [sel, setSel] = useState<string | null>(null)

  const ids = useMemo(() => ctx.pessoas.map((p) => p.id), [ctx.pessoas])
  const pessoaSel = ctx.pessoas.find((p) => p.id === sel) ?? ctx.eu ?? ctx.pessoas[0]

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setCarregando(true)
      try {
        const { data: refs, error } = await supabase
          .from('refeicao')
          .select('id, pessoa_id, tipo, hora, refeicao_grupo_id, refeicao_grupo:refeicao_grupo_id(descricao), item_refeicao(id, quantidade_g, medida_caseira, alimento:alimento_id(id, nome))')
          .in('pessoa_id', ids)
          .eq('data', data)
          .eq('planejada', false)
          .order('hora', { nullsFirst: true })
        if (error) throw error
        const lista = refs as unknown as RefeicaoDia[]
        const [ps, { data: chs, error: e2 }, ds] = await Promise.all([
          carregarPlanos(ids),
          supabase.from('plano_checagem').select('id, plano_refeicao_id, data, status, refeicao_id, opcao_id').eq('data', data),
          carregarDietas(ids),
        ])
        if (e2) throw e2
        const [diasDoPlano, md, ts] = await Promise.all([
          carregarDias(ps.map((p) => p.id), data, data), carregarMetasDia(ids, data, data), carregarTreinos(ids),
        ])
        // Onde a Semana trocou a refeição neste dia, valem os itens do dia.
        const efetivos = ps.map((p) => {
          const d = diasDoPlano.find((x) => x.plano_refeicao_id === p.id)
          return d ? { ...p, plano_item: d.plano_dia_item, plano_opcao: [] } : p
        })
        const alimentoIds = [...new Set([
          ...lista.flatMap((r) => r.item_refeicao.map((i) => i.alimento.id)),
          ...efetivos.flatMap((p) => p.plano_item.map((i) => i.alimento.id)),
          ...efetivos.flatMap((p) => p.plano_opcao.flatMap((o) => o.plano_opcao_item.map((i) => i.alimento.id))),
        ])]
        const [c, m] = await Promise.all([carregarComposicao(alimentoIds), carregarMetasVigentes(ids)])
        if (!vivo) return
        setRefeicoes(lista)
        setPlanos(efetivos)
        setMetasDia(md)
        setTreinos(ts)
        setChecagens(chs as Checagem[])
        setDietas(ds)
        setComp(c)
        setMetas(m)
        setErro(null)
      } catch (e) {
        if (vivo) setErro(erroTexto(e))
      } finally {
        if (vivo) setCarregando(false)
      }
    })()
    return () => { vivo = false }
  }, [data, ids, versao, tick])

  useEffect(() => {
    supabase
      .from('nutriente_recomendacao')
      .select('sexo, idade_min, idade_max, rda, ai, nutriente:nutriente_id(codigo, nome, unidade)')
      .then(({ data }) => setRecs((data ?? []) as unknown as Recomendacao[]))
  }, [])

  const grupoCompartilhado = useMemo(() => {
    const cont = new Map<string, number>()
    for (const r of refeicoes) if (r.refeicao_grupo_id) cont.set(r.refeicao_grupo_id, (cont.get(r.refeicao_grupo_id) ?? 0) + 1)
    return cont
  }, [refeicoes])

  async function apagar(r: RefeicaoDia, p: Pessoa) {
    const nome = TIPOS_REFEICAO.find((t) => t.valor === r.tipo)?.nome
    if (!confirm(`Apagar ${nome} de ${p.nome}?`)) return
    const { error } = await supabase.from('refeicao').delete().eq('id', r.id)
    if (error) alert(erroTexto(error))
    else setTick((t) => t + 1)
  }

  function recomendacao(p: Pessoa, codigo: string): number | null {
    if (!p.sexo || !p.data_nascimento) return null
    const idade = idadeEm(p.data_nascimento, new Date(data + 'T12:00:00'))
    const r = recs.find((x) => x.nutriente.codigo === codigo && x.sexo === p.sexo && idade >= x.idade_min && idade <= x.idade_max)
    return r ? Number(r.rda ?? r.ai) : null
  }

  const ehHoje = data === hojeISO()
  const diaSemana = new Date(data + 'T12:00:00').getDay()
  // Refeição registrada → como veio do plano (feita ou trocada).
  const doPlano = new Map(checagens.filter((c) => c.refeicao_id).map((c) => [c.refeicao_id as string, c.status]))

  /** O dia de uma pessoa: o que comeu, a meta do dia (acompanha o treino quando ela escolheu) e o plano. */
  function diaDe(p: Pessoa) {
    const minhas = refeicoes.filter((r) => r.pessoa_id === p.id)
    const tot = somar(minhas.flatMap((r) => r.item_refeicao), comp)
    const md = metasDia.find((x) => x.pessoa_id === p.id)
    const vigente = metas[p.id]
    const m = md?.kcal ? {
      ...vigente, kcal: md.kcal, proteina_g: md.proteina_g, carboidrato_g: md.carboidrato_g, gordura_g: md.gordura_g,
    } : vigente
    const planoDia = planos.filter((x) => x.pessoa_id === p.id && x.dias.includes(diaSemana))
    return { minhas, tot, md, m, planoDia, feitas: feitasDoPlano(planoDia, checagens), andamento: andamentoDia(tot.energia ?? 0, m?.kcal) }
  }

  return (
    <div className="tela">
      <div className="cabecalho-data">
        <button onClick={() => setData(somarDias(data, -1))} aria-label="Dia anterior">‹</button>
        <input type="date" value={data} onChange={(e) => e.target.value && setData(e.target.value)} />
        <button onClick={() => setData(somarDias(data, 1))} aria-label="Próximo dia">›</button>
      </div>
      {!ehHoje && <button className="link" onClick={() => setData(hojeISO())}>Voltar para hoje</button>}
      {erro && <p className="erro">{erro}</p>}
      {carregando && !refeicoes.length && <p className="dica">Carregando…</p>}

      <section className="cartao familia-hoje">
        <h2>Meta do dia</h2>
        <div className="pessoas-hoje">
          {ctx.pessoas.map((p) => {
            const d = diaDe(p)
            const anel = d.m?.kcal
              ? `conic-gradient(${d.andamento.estado === 'passou' ? 'var(--alerta)' : 'var(--verde)'} 0 ${(d.andamento.pct * 100).toFixed(1)}%, var(--linha) ${(d.andamento.pct * 100).toFixed(1)}% 100%)`
              : 'conic-gradient(var(--linha) 0 100%)'
            return (
              <button
                key={p.id}
                type="button"
                className={'pessoa-hoje' + (p.id === pessoaSel?.id ? ' ativa' : '')}
                aria-pressed={p.id === pessoaSel?.id}
                onClick={() => setSel(p.id)}
              >
                <span className="anel-dia" style={{ background: anel }} role="img" aria-label={`${p.nome}: ${fmt(d.tot.energia ?? 0)} de ${d.m?.kcal ? fmt(d.m.kcal) : '–'} kcal`}>
                  <span><b>{fmt(d.tot.energia ?? 0)}</b><small>{d.m?.kcal ? `de ${fmt(d.m.kcal)} kcal` : 'kcal'}</small></span>
                </span>
                <strong>{p.nome}</strong>
                <small className={d.andamento.estado}>{d.andamento.texto}</small>
                {d.planoDia.length > 0 && <small>{d.feitas} de {d.planoDia.length} do plano</small>}
              </button>
            )
          })}
        </div>
        <p className="dica">Cada um contra a própria meta. Toque na pessoa para registrar o dia dela.</p>
      </section>
      <CartaoInstalar dispensavel />

      {pessoaSel && (() => {
        const p = pessoaSel
        const { minhas, tot, md, m, planoDia } = diaDe(p)
        const treinosDia = treinos.filter((t) => t.pessoa_id === p.id && t.dias.includes(diaSemana))
        const kcalRegistrada = new Map(minhas.map((r) => [r.id, somar(r.item_refeicao, comp).energia ?? 0]))
        return (
          <section key={p.id} className="cartao">
            <h2>{p.nome}</h2>
            {treinosDia.length > 0 && (
              <p className="treino-hoje">
                🏋 {treinosDia.map((t) => `${t.atividade} ${t.minutos} min`).join(' + ')}
                {md?.treino_kcal ? ` · ≈ ${fmt(md.treino_kcal)} kcal` : ''}
                {md?.pelo_treino && md.gasto_kcal ? ` · gasto do dia ≈ ${fmt(md.gasto_kcal)} kcal, meta acompanha o treino` : ''}
              </p>
            )}
            <Barra rotulo="Energia" valor={tot.energia ?? 0} meta={m?.kcal} unidade="kcal" />
            <Barra rotulo="Proteína" valor={tot.proteina ?? 0} meta={m?.proteina_g} unidade="g" />
            <Barra rotulo="Carboidrato" valor={tot.carboidrato ?? 0} meta={m?.carboidrato_g} unidade="g" />
            <Barra rotulo="Gordura" valor={tot.gordura ?? 0} meta={m?.gordura_g} unidade="g" />
            {!m && <p className="dica">Sem meta ainda. Defina em Perfil.</p>}

            <button className="link" onClick={() => setAbertoMicros(abertoMicros === p.id ? null : p.id)}>
              {abertoMicros === p.id ? 'Esconder micronutrientes' : 'Ver micronutrientes'}
            </button>
            {abertoMicros === p.id && (
              <table className="tabela">
                <thead>
                  <tr><th>Nutriente</th><th>Hoje</th><th>Recomendado</th></tr>
                </thead>
                <tbody>
                  {MICROS.map((cod) => {
                    const ref = recs.find((x) => x.nutriente.codigo === cod)?.nutriente
                    const alvo = cod === 'fibra' ? (m?.fibra_g ?? recomendacao(p, cod)) : recomendacao(p, cod)
                    const v = tot[cod] ?? 0
                    const baixo = alvo && cod !== 'sodio' && v < alvo * 0.7
                    return (
                      <tr key={cod} className={baixo ? 'baixo' : ''}>
                        <td>{ref?.nome ?? cod}</td>
                        <td>{fmt(v, v < 10 ? 1 : 0)} {ref?.unidade}</td>
                        <td>{alvo ? `${fmt(alvo, 1)} ${ref?.unidade}${cod === 'sodio' ? ' (AI)' : ''}` : '–'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            {abertoMicros === p.id && (!p.sexo || !p.data_nascimento) && (
              <p className="dica">Preencha sexo e data de nascimento em Perfil para ver o recomendado.</p>
            )}

            <RegistroRapido
              key={p.id + data}
              pessoa={p}
              familiaId={ctx.familiaId}
              planos={planoDia}
              checagens={checagens}
              kcalRegistrada={kcalRegistrada}
              comp={comp}
              data={data}
              dieta={dietaDoDia(dietas, p.id, diaDaSemana(data)) ?? null}
              onMudou={() => setTick((t) => t + 1)}
            />

            {minhas.length === 0 ? (
              <p className="dica">Nada registrado neste dia.</p>
            ) : (
              <ul className="refeicoes">
                {minhas.map((r) => {
                  const k = somar(r.item_refeicao, comp).energia ?? 0
                  const junto = r.refeicao_grupo_id && (grupoCompartilhado.get(r.refeicao_grupo_id) ?? 0) > 1
                  const origem = doPlano.get(r.id)
                  const descricao = r.refeicao_grupo?.descricao
                  return (
                    <li key={r.id}>
                      <div className="refeicao-topo">
                        <strong>{TIPOS_REFEICAO.find((t) => t.valor === r.tipo)?.nome}</strong>
                        {r.hora && <span className="hora">{r.hora.slice(0, 5)}</span>}
                        {junto && <span className="selo">juntos</span>}
                        {origem === 'feita' && <span className="selo">plano</span>}
                        {origem === 'trocada' && <span className="selo neutro">no lugar do plano</span>}
                        {descricao && (ehAMais(descricao) ? <span className="selo alto">a mais</span> : <span className="selo neutro">{descricao}</span>)}
                        <span className="kcal">{fmt(k)} kcal</span>
                        <button className="apagar" onClick={() => apagar(r, p)} aria-label="Apagar">×</button>
                      </div>
                      <ul className="itens">
                        {r.item_refeicao.map((i) => (
                          <li key={i.id}>
                            {i.alimento.nome} · {fmt(i.quantidade_g)} g{i.medida_caseira ? ` (${i.medida_caseira})` : ''}
                          </li>
                        ))}
                      </ul>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })()}

      <button className="primario flutuante" onClick={onRegistrar}>＋ Registrar refeição</button>
    </div>
  )
}
