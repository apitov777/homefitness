import { useEffect, useMemo, useState } from 'react'
import type { Contexto } from '../App'
import { supabase } from '../supabase'
import { avisoDeTeste, desligarAvisos, estadoAvisos, ligarAvisos, type EstadoAvisos } from '../avisos'
import {
  buscarAlimentos, carregarAlimentos, carregarComposicao, carregarMetasVigentes, carregarPlanos, DIAS_SEMANA,
  descreverDias, erroTexto, fmt, lerNumero, nomeTipo, somarItens, TIPOS_REFEICAO,
  type AlimentoResumo, type Composicao, type Meta, type Pessoa, type PlanoRefeicao, type TipoRefeicao,
} from '../dados'
import Semana from './Semana'
import Treinos from './Treinos'

function AvisosCartao({ ctx, eu }: { ctx: Contexto; eu: Pessoa }) {
  const [estado, setEstado] = useState<EstadoAvisos | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [resumo, setResumo] = useState(eu.aviso_resumo?.slice(0, 5) ?? '')

  useEffect(() => {
    estadoAvisos().then(setEstado).catch(() => setEstado('sem_suporte'))
  }, [])

  async function agir(f: () => Promise<unknown>, ok?: string) {
    setOcupado(true)
    setErro(null)
    setMsg(null)
    try {
      await f()
      if (ok) setMsg(ok)
    } catch (e) {
      setErro(erroTexto(e))
    }
    setEstado(await estadoAvisos().catch(() => 'sem_suporte' as const))
    setOcupado(false)
  }

  async function mudarResumo(v: string | null) {
    setResumo(v ?? '')
    const { error } = await supabase.from('pessoa').update({ aviso_resumo: v || null }).eq('id', eu.id)
    if (error) setErro(erroTexto(error))
    else await ctx.recarregarPessoas()
  }

  return (
    <section className="cartao">
      <h2>Avisos neste aparelho</h2>
      {estado === null && <p className="dica">Verificando…</p>}
      {estado === 'instalar' && (
        <p className="dica">
          No iPhone, os avisos só funcionam com o app instalado: no Safari, toque em Compartilhar › Adicionar à Tela de
          Início e abra o Homefitness por esse ícone.
        </p>
      )}
      {estado === 'sem_suporte' && <p className="dica">Este navegador não recebe avisos.</p>}
      {estado === 'bloqueado' && (
        <p className="dica">Os avisos estão bloqueados. Libere em Ajustes › Notificações › Homefitness e volte aqui.</p>
      )}
      {estado === 'desligado' && (
        <>
          <p className="dica">O app avisa na hora de cada refeição do seu plano que estiver com o sino ligado.</p>
          <button className="primario" disabled={ocupado} onClick={() => agir(ligarAvisos, 'Avisos ligados.')}>
            Ligar avisos
          </button>
        </>
      )}
      {estado === 'ligado' && (
        <>
          <p className="ok">Avisos ligados neste aparelho.</p>
          <div className="linha">
            <button disabled={ocupado} onClick={() => agir(async () => {
              const n = await avisoDeTeste()
              if (!n) throw new Error('Nenhum aparelho recebeu. Desligue e ligue os avisos de novo.')
            }, 'Aviso de teste enviado.')}>Mandar aviso de teste</button>
            <button disabled={ocupado} onClick={() => agir(desligarAvisos)}>Desligar</button>
          </div>
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={!!resumo} onChange={(e) => mudarResumo(e.target.checked ? '21:30' : null)} />
        Resumo do dia contra a meta
      </label>
      {resumo && (
        <label>
          Horário do resumo
          <input type="time" value={resumo} onChange={(e) => e.target.value && mudarResumo(e.target.value)} />
        </label>
      )}
      {msg && <p className="ok">{msg}</p>}
      {erro && <p className="erro">{erro}</p>}
    </section>
  )
}

interface ItemEditado { alimento: AlimentoResumo | { id: string; nome: string }; gramas: string }

const num = lerNumero

function EditorRefeicao({ pessoa, original, onFim }: { pessoa: Pessoa; original: PlanoRefeicao | null; onFim: (salvou: boolean) => void }) {
  const [tipo, setTipo] = useState<TipoRefeicao>(original?.tipo ?? 'almoco')
  const [nome, setNome] = useState(original?.nome ?? '')
  const [hora, setHora] = useState(original?.hora.slice(0, 5) ?? '12:00')
  const [dias, setDias] = useState<number[]>(original?.dias ?? [0, 1, 2, 3, 4, 5, 6])
  const [avisar, setAvisar] = useState(original?.avisar ?? true)
  const [itens, setItens] = useState<ItemEditado[]>(
    original?.plano_item.map((i) => ({ alimento: i.alimento, gramas: String(i.quantidade_g) })) ?? [],
  )
  const [termo, setTermo] = useState('')
  const [alimentos, setAlimentos] = useState<AlimentoResumo[]>([])
  const [comp, setComp] = useState<Map<string, Composicao>>(new Map())
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    carregarAlimentos().then(setAlimentos).catch((e) => setErro(erroTexto(e)))
  }, [])
  useEffect(() => {
    carregarComposicao(itens.map((i) => i.alimento.id)).then(setComp).catch((e) => setErro(erroTexto(e)))
  }, [itens.length])

  const resultados = useMemo(() => buscarAlimentos(alimentos, termo), [alimentos, termo])
  const tot = somarItens(itens.map((i) => ({ alimento: i.alimento, quantidade_g: num(i.gramas) })), comp)

  async function salvar() {
    setErro(null)
    if (!dias.length) return setErro('Escolha pelo menos um dia da semana.')
    if (!hora) return setErro('Informe o horário.')
    setSalvando(true)
    const { error } = await supabase.rpc('salvar_plano_refeicao', {
      p_id: original?.id ?? null,
      p_pessoa: pessoa.id,
      p_tipo: tipo,
      p_nome: nome,
      p_hora: hora,
      p_dias: [...dias].sort(),
      p_avisar: avisar,
      p_itens: itens.map((i) => ({ alimento_id: i.alimento.id, quantidade_g: num(i.gramas) })),
    })
    setSalvando(false)
    if (error) setErro(erroTexto(error))
    else onFim(true)
  }

  return (
    <section className="cartao editor">
      <h2>{original ? 'Editar refeição' : 'Nova refeição'} de {pessoa.nome}</h2>
      <div className="linha">
        <label>
          Refeição
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoRefeicao)}>
            {TIPOS_REFEICAO.map((t) => <option key={t.valor} value={t.valor}>{t.nome}</option>)}
          </select>
        </label>
        <label>Horário<input type="time" value={hora} onChange={(e) => setHora(e.target.value)} /></label>
      </div>
      <label>Nome (opcional)<input value={nome} placeholder="ex.: pós-treino com whey" onChange={(e) => setNome(e.target.value)} /></label>
      <fieldset className="quem">
        <legend>Dias</legend>
        <div className="dias">
          {DIAS_SEMANA.map((d, i) => (
            <button
              key={d}
              type="button"
              className={dias.includes(i) ? 'ativa' : ''}
              onClick={() => setDias((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i]))}
            >
              {d}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
        Avisar no horário
      </label>

      <h2>Alimentos</h2>
      {itens.map((it, idx) => {
        const c = comp.get(it.alimento.id)
        return (
          <div key={idx} className="item-plano">
            <span className="nome">{it.alimento.nome}</span>
            <span className="com-unidade">
              <input
                inputMode="decimal"
                aria-label={`Gramas de ${it.alimento.nome}`}
                value={it.gramas}
                onChange={(e) => setItens((xs) => xs.map((x, i) => (i === idx ? { ...x, gramas: e.target.value } : x)))}
              />
              g
            </span>
            <small>{fmt(((c?.energia ?? 0) * num(it.gramas)) / 100)} kcal</small>
            <button className="apagar" onClick={() => setItens((xs) => xs.filter((_, i) => i !== idx))} aria-label="Remover">×</button>
          </div>
        )
      })}
      <input className="busca" type="search" placeholder="Adicionar: arroz, ovo, frango…" value={termo} onChange={(e) => setTermo(e.target.value)} />
      {termo && (
        <ul className="resultados">
          {resultados.map((a) => (
            <li key={a.id}>
              <button onClick={() => { setTermo(''); setItens((xs) => [...xs, { alimento: a, gramas: '100' }]) }}>
                {a.nome}
                <small>{a.familia_id ? `${a.fonte} · da família` : a.categoria}</small>
              </button>
            </li>
          ))}
          {!resultados.length && <li className="dica">Nada encontrado. Cadastre pelo rótulo em Perfil.</li>}
        </ul>
      )}
      {itens.length > 0 && (
        <p className="total-plano">
          <strong>{fmt(tot.energia)} kcal</strong> · proteína {fmt(tot.proteina, 1)} g · carboidrato {fmt(tot.carboidrato, 1)} g ·
          gordura {fmt(tot.gordura, 1)} g
        </p>
      )}
      {erro && <p className="erro">{erro}</p>}
      <div className="linha">
        <button onClick={() => onFim(false)}>Cancelar</button>
        <button className="primario" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar refeição'}</button>
      </div>
    </section>
  )
}

/** As refeições de sempre: horários e gramas que valem para os dias da semana marcados. */
function Refeicoes({ ctx, sel }: { ctx: Contexto; sel: string | undefined }) {
  const [dia, setDia] = useState(new Date().getDay())
  const [planos, setPlanos] = useState<PlanoRefeicao[]>([])
  const [comp, setComp] = useState<Map<string, Composicao>>(new Map())
  const [metas, setMetas] = useState<Record<string, Meta>>({})
  const [editando, setEditando] = useState<PlanoRefeicao | 'nova' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const pessoa = ctx.pessoas.find((p) => p.id === sel)
  const outras = ctx.pessoas.filter((p) => p.id !== sel)

  useEffect(() => {
    if (!sel) return
    ;(async () => {
      try {
        const ps = await carregarPlanos([sel])
        const [c, m] = await Promise.all([
          carregarComposicao([...new Set(ps.flatMap((p) => p.plano_item.map((i) => i.alimento.id)))]),
          carregarMetasVigentes([sel]),
        ])
        setPlanos(ps)
        setComp(c)
        setMetas(m)
      } catch (e) {
        setErro(erroTexto(e))
      }
    })()
  }, [sel, tick])

  const doDia = planos.filter((p) => p.dias.includes(dia))
  const tot = somarItens(doDia.flatMap((p) => p.plano_item), comp)
  const meta = sel ? metas[sel] : undefined

  async function apagar(p: PlanoRefeicao) {
    if (!confirm(`Tirar ${p.nome ?? nomeTipo(p.tipo)} das ${p.hora.slice(0, 5)} do plano?`)) return
    // Desativa em vez de apagar, para manter as marcações dos dias anteriores.
    const { error } = await supabase.from('plano_refeicao').update({ ativo: false }).eq('id', p.id)
    if (error) setErro(erroTexto(error))
    else setTick((t) => t + 1)
  }

  async function copiar(p: PlanoRefeicao, para: Pessoa) {
    setMsg(null)
    const { error } = await supabase.rpc('salvar_plano_refeicao', {
      p_id: null, p_pessoa: para.id, p_tipo: p.tipo, p_nome: p.nome, p_hora: p.hora.slice(0, 5), p_dias: p.dias,
      p_avisar: p.avisar, p_itens: p.plano_item.map((i) => ({ alimento_id: i.alimento.id, quantidade_g: i.quantidade_g })),
    })
    if (error) setErro(erroTexto(error))
    else setMsg(`Copiada para ${para.nome}. Ajuste as gramas no plano de ${para.nome}.`)
  }

  if (pessoa && editando) {
    return (
      <EditorRefeicao
        pessoa={pessoa}
        original={editando === 'nova' ? null : editando}
        onFim={(salvou) => { setEditando(null); if (salvou) setTick((t) => t + 1) }}
      />
    )
  }

  return (
    <>
      <p className="dica">
        O que você come em cada horário nos dias marcados. Na Semana dá para trocar uma refeição por uma receita só naquele dia.
      </p>
      <section className="cartao">
        <div className="dias">
          {DIAS_SEMANA.map((d, i) => (
            <button key={d} className={dia === i ? 'ativa' : ''} onClick={() => setDia(i)}>{d}</button>
          ))}
        </div>
        <p className="total-plano">
          {doDia.length} {doDia.length === 1 ? 'refeição' : 'refeições'} · <strong>{fmt(tot.energia)} kcal</strong>
          {meta && <> de {fmt(meta.kcal)} kcal da meta ({fmt(((tot.energia ?? 0) / meta.kcal) * 100)}%)</>}
        </p>
        <p className="dica">
          Proteína {fmt(tot.proteina)}{meta?.proteina_g ? ` de ${fmt(meta.proteina_g)}` : ''} g · carboidrato {fmt(tot.carboidrato)}
          {meta?.carboidrato_g ? ` de ${fmt(meta.carboidrato_g)}` : ''} g · gordura {fmt(tot.gordura)}{meta?.gordura_g ? ` de ${fmt(meta.gordura_g)}` : ''} g
        </p>
        {!meta && <p className="dica">Sem meta ainda: faça o cadastro em Perfil para comparar.</p>}
      </section>

      {erro && <p className="erro">{erro}</p>}
      {msg && <p className="ok">{msg}</p>}

      {planos.map((p) => {
        const t = somarItens(p.plano_item, comp)
        const fora = !p.dias.includes(dia)
        return (
          <section key={p.id} className={'cartao refeicao-plano' + (fora ? ' fora' : '')}>
            <div className="refeicao-topo">
              <span className="hora">{p.hora.slice(0, 5)}</span>
              <strong>{p.nome ?? nomeTipo(p.tipo)}</strong>
              {p.avisar && <span aria-label="com aviso" title="com aviso">🔔</span>}
              <span className="kcal">{fmt(t.energia)} kcal</span>
            </div>
            <small className="dica">{p.nome ? `${nomeTipo(p.tipo)} · ` : ''}{descreverDias(p.dias)}{fora ? ' · não neste dia' : ''}</small>
            <ul className="itens">
              {p.plano_item.map((i) => (
                <li key={i.id}>{i.alimento.nome} · {fmt(i.quantidade_g)} g</li>
              ))}
            </ul>
            <small className="dica">Proteína {fmt(t.proteina, 1)} g · carboidrato {fmt(t.carboidrato, 1)} g · gordura {fmt(t.gordura, 1)} g</small>
            <div className="acoes">
              <button className="link" onClick={() => setEditando(p)}>Editar</button>
              {outras.map((o) => (
                <button key={o.id} className="link" onClick={() => copiar(p, o)}>Copiar para {o.nome}</button>
              ))}
              <button className="link perigo" onClick={() => apagar(p)}>Tirar do plano</button>
            </div>
          </section>
        )
      })}
      {!planos.length && <p className="dica">Nenhuma refeição no plano ainda. Monte o dia com os horários e as gramas de cada alimento.</p>}

      <button className="primario" onClick={() => setEditando('nova')}>＋ Adicionar refeição ao plano</button>

      {pessoa && pessoa.user_id === ctx.session.user.id && <AvisosCartao ctx={ctx} eu={pessoa} />}
    </>
  )
}

type Parte = 'semana' | 'refeicoes' | 'treinos'

const PARTES: { id: Parte; nome: string }[] = [
  { id: 'semana', nome: 'Semana' },
  { id: 'refeicoes', nome: 'Refeições' },
  { id: 'treinos', nome: 'Treinos' },
]

export default function Plano({ ctx }: { ctx: Contexto }) {
  const [parte, setParte] = useState<Parte>('semana')
  const [sel, setSel] = useState(ctx.eu?.id ?? ctx.pessoas[0]?.id)

  return (
    <div className="tela">
      <h1>Plano</h1>
      <div className="segmentos" role="tablist">
        {PARTES.map((p) => (
          <button key={p.id} role="tab" aria-selected={parte === p.id} className={parte === p.id ? 'ativa' : ''} onClick={() => setParte(p.id)}>
            {p.nome}
          </button>
        ))}
      </div>
      <div className="chips">
        {ctx.pessoas.map((x) => (
          <button key={x.id} className={x.id === sel ? 'ativa' : ''} onClick={() => setSel(x.id)}>{x.nome}</button>
        ))}
      </div>
      {parte === 'semana' && sel && <Semana ctx={ctx} sel={sel} onIrPara={setParte} />}
      {parte === 'refeicoes' && <Refeicoes ctx={ctx} sel={sel} />}
      {parte === 'treinos' && sel && <Treinos ctx={ctx} sel={sel} />}
    </div>
  )
}
