import { useEffect, useMemo, useState } from 'react'
import type { Contexto } from '../App'
import { supabase } from '../supabase'
import {
  carregarComposicao, carregarDietas, carregarMetasVigentes, carregarPlanos, erroTexto, fmt, hojeISO, nomeTipo, situacaoMeta, somarDias,
  somarItens, TIPOS_REFEICAO,
  type Checagem, type Composicao, type Dieta, type Meta, type Pessoa, type PlanoRefeicao, type TipoRefeicao,
} from '../dados'
import { dietaDoDia, opcoesDe } from '../dietas'
import { idadeEm } from '../calc'
import { carregarDias, carregarMetasDia, carregarTreinos, diaDaSemana, type MetaDia, type Treino } from '../semana'
import CartaoInstalar from './Instalar'

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

function ChecklistPlano({ planos, checagens, comp, data, dieta, onMudou }: {
  planos: PlanoRefeicao[]
  checagens: Checagem[]
  comp: Map<string, Composicao>
  data: string
  /** A dieta que vale neste dia para a pessoa, se houver. */
  dieta: Dieta | null
  onMudou: () => void
}) {
  const [ajustando, setAjustando] = useState<string | null>(null)
  const [gramas, setGramas] = useState<Record<string, string>>({})
  // Opção escolhida por refeição (id da opção; nula = A).
  const [opcaoSel, setOpcaoSel] = useState<Record<string, string | null>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const agora = new Date().toTimeString().slice(0, 5)
  const ehHoje = data === hojeISO()

  async function marcar(p: PlanoRefeicao, status: 'feita' | 'pulada', itens?: { alimento_id: string; quantidade_g: number }[], opcao: string | null = null) {
    setOcupado(p.id)
    setErro(null)
    const { error } = await supabase.rpc('marcar_plano', { p_plano: p.id, p_data: data, p_status: status, p_itens: itens ?? null, p_opcao: opcao })
    setOcupado(null)
    if (error) return setErro(erroTexto(error))
    setAjustando(null)
    onMudou()
  }
  const opcaoDe = (p: PlanoRefeicao) => {
    const ops = opcoesDe(p)
    return ops.find((o) => o.id === (opcaoSel[p.id] ?? null)) ?? ops[0]
  }

  async function desfazer(p: PlanoRefeicao) {
    setOcupado(p.id)
    const { error } = await supabase.rpc('desmarcar_plano', { p_plano: p.id, p_data: data })
    setOcupado(null)
    if (error) setErro(erroTexto(error))
    else onMudou()
  }

  function abrirAjuste(p: PlanoRefeicao) {
    setAjustando(p.id)
    setGramas(Object.fromEntries(opcaoDe(p).itens.map((i) => [i.id, String(i.quantidade_g)])))
  }

  return (
    <div className="checklist">
      <h3>Plano do dia</h3>
      {dieta && (
        <p className="dica dieta-hoje">
          Dieta: <strong>{dieta.nome}</strong>{dieta.kcal_alvo != null && <> · alvo {fmt(dieta.kcal_alvo)} kcal</>} · toque na opção que comeu e em Fiz.
        </p>
      )}
      <ul>
        {planos.map((p) => {
          const c = checagens.find((x) => x.plano_refeicao_id === p.id)
          const ops = opcoesDe(p)
          const op = opcaoDe(p)
          const kcal = somarItens(op.itens, comp).energia ?? 0
          const atrasada = !c && ehHoje && p.hora.slice(0, 5) < agora
          const comida = c?.status === 'feita' ? ops.find((o) => o.id === (c.opcao_id ?? null)) : undefined
          return (
            <li key={p.id} className={c ? c.status : atrasada ? 'atrasada' : ''}>
              <div className="refeicao-topo">
                <span className="hora">{p.hora.slice(0, 5)}</span>
                <strong>{p.nome ?? nomeTipo(p.tipo)}</strong>
                {atrasada && <span className="selo alto">atrasada</span>}
                <span className="kcal">{fmt(kcal)} kcal{p.kcal_alvo != null ? ` · alvo ${fmt(p.kcal_alvo)}` : ''}</span>
              </div>
              {!c && ops.length > 1 && (
                <>
                  <div className="chips opcoes" role="group" aria-label={`Opções de ${p.nome ?? nomeTipo(p.tipo)}`}>
                    {ops.map((o) => (
                      <button key={o.letra} type="button" className={o === op ? 'ativa' : ''} aria-pressed={o === op}
                        onClick={() => setOpcaoSel((xs) => ({ ...xs, [p.id]: o.id }))}>
                        {o.letra} · {fmt(somarItens(o.itens, comp).energia ?? 0)} kcal
                      </button>
                    ))}
                  </div>
                  <ul className="itens">
                    {op.itens.map((i) => <li key={i.id}>{i.alimento.nome} · {fmt(i.quantidade_g)} g</li>)}
                  </ul>
                </>
              )}
              {c ? (
                <div className="acoes">
                  <span>{c.status === 'feita' ? `✓ Feita${comida && ops.length > 1 ? ` (opção ${comida.letra})` : ''}` : '✗ Não fez'}</span>
                  <button className="link" disabled={ocupado === p.id} onClick={() => desfazer(p)}>desfazer</button>
                </div>
              ) : ajustando === p.id ? (
                <div className="ajuste">
                  {op.itens.map((i) => (
                    <label key={i.id} className="item-plano">
                      <span className="nome">{i.alimento.nome}</span>
                      <span className="com-unidade">
                        <input
                          inputMode="decimal"
                          value={gramas[i.id] ?? ''}
                          onChange={(e) => setGramas({ ...gramas, [i.id]: e.target.value })}
                        />
                        g
                      </span>
                    </label>
                  ))}
                  <p className="dica">Coloque 0 no que não comeu. Comeu outra coisa? Registre à parte em Registrar.</p>
                  <div className="linha">
                    <button onClick={() => setAjustando(null)}>Cancelar</button>
                    <button
                      className="primario"
                      disabled={ocupado === p.id}
                      onClick={() => marcar(p, 'feita', op.itens.map((i) => ({
                        alimento_id: i.alimento.id,
                        quantidade_g: parseFloat((gramas[i.id] ?? '0').replace(',', '.')) || 0,
                      })), op.id)}
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="botoes-marcar">
                  <button className="fiz" disabled={ocupado === p.id} onClick={() => marcar(p, 'feita', undefined, op.id)}>{ops.length > 1 ? `Fiz a ${op.letra}` : 'Fiz'}</button>
                  <button disabled={ocupado === p.id} onClick={() => abrirAjuste(p)}>Ajustar gramas</button>
                  <button disabled={ocupado === p.id} onClick={() => marcar(p, 'pulada')}>Não fiz</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {erro && <p className="erro">{erro}</p>}
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

  const ids = useMemo(() => ctx.pessoas.map((p) => p.id), [ctx.pessoas])

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setCarregando(true)
      try {
        const { data: refs, error } = await supabase
          .from('refeicao')
          .select('id, pessoa_id, tipo, hora, refeicao_grupo_id, item_refeicao(id, quantidade_g, medida_caseira, alimento:alimento_id(id, nome))')
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
  const doPlano = new Set(checagens.map((c) => c.refeicao_id).filter(Boolean))

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
      <CartaoInstalar dispensavel />

      {ctx.pessoas.map((p) => {
        const minhas = refeicoes.filter((r) => r.pessoa_id === p.id)
        const tot = somar(minhas.flatMap((r) => r.item_refeicao), comp)
        // Meta do dia (acompanha o treino quando a pessoa escolheu); a vigente completa fibra e o resto.
        const md = metasDia.find((x) => x.pessoa_id === p.id)
        const vigente = metas[p.id]
        const m = md?.kcal ? {
          ...vigente, kcal: md.kcal, proteina_g: md.proteina_g, carboidrato_g: md.carboidrato_g, gordura_g: md.gordura_g,
        } : vigente
        const treinosDia = treinos.filter((t) => t.pessoa_id === p.id && t.dias.includes(diaSemana))
        const planoDia = planos.filter((x) => x.pessoa_id === p.id && x.dias.includes(diaSemana))
        const feitas = planoDia.filter((x) => checagens.some((c) => c.plano_refeicao_id === x.id && c.status === 'feita')).length
        const situacao = situacaoMeta(tot.energia ?? 0, m?.kcal)
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
            {(situacao || planoDia.length > 0) && (
              <div className={'situacao' + (situacao?.batida ? ' batida' : '')}>
                {situacao && <strong>{situacao.batida ? '✅ ' : ''}{situacao.texto}</strong>}
                {planoDia.length > 0 && <span>{feitas} de {planoDia.length} refeições do plano feitas</span>}
              </div>
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

            {planoDia.length > 0 && (
              <ChecklistPlano
                planos={planoDia}
                checagens={checagens}
                comp={comp}
                data={data}
                dieta={dietaDoDia(dietas, p.id, diaDaSemana(data)) ?? null}
                onMudou={() => setTick((t) => t + 1)}
              />
            )}

            {minhas.length === 0 ? (
              <p className="dica">Nada registrado neste dia.</p>
            ) : (
              <ul className="refeicoes">
                {minhas.map((r) => {
                  const k = somar(r.item_refeicao, comp).energia ?? 0
                  const junto = r.refeicao_grupo_id && (grupoCompartilhado.get(r.refeicao_grupo_id) ?? 0) > 1
                  return (
                    <li key={r.id}>
                      <div className="refeicao-topo">
                        <strong>{TIPOS_REFEICAO.find((t) => t.valor === r.tipo)?.nome}</strong>
                        {r.hora && <span className="hora">{r.hora.slice(0, 5)}</span>}
                        {junto && <span className="selo">juntos</span>}
                        {doPlano.has(r.id) && <span className="selo">plano</span>}
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
      })}

      <button className="primario flutuante" onClick={onRegistrar}>＋ Registrar refeição</button>
    </div>
  )
}
