import { useEffect, useMemo, useState } from 'react'
import type { Contexto } from '../App'
import {
  apagarDieta, apagarPlanoRefeicao, buscarAlimentos, carregarAlimentos, carregarComposicao, carregarDietas, carregarMetasVigentes,
  carregarRefeicoesDaDieta, DIAS_SEMANA, descreverDias, erroTexto, fmt, hojeISO, lerNumero, nomeTipo, salvarDieta, salvarPlanoRefeicao,
  somarDias, TIPOS_REFEICAO, type AlimentoResumo, type Composicao, type Dieta, type Pessoa, type PlanoRefeicao, type TipoRefeicao,
} from '../dados'
import { alvoDaRefeicao, desvio, escalarParaKcal, kcalDe, letra, modeloDoDia, naFaixa, opcoesDe, resumoDieta, sugerirOpcoes } from '../dietas'
import { carregarFavoritas, carregarMetasDia, carregarReceitas, diaDaSemana, gramasParaFechar, porcaoDe, receitasDoPlano, type Favorita, type Receita } from '../semana'
import FavoritasSemana from './FavoritasSemana'

interface ItemEd { alimento: { id: string; nome: string }; gramas: string }
interface OpcaoEd { chave: number; nome: string | null; itens: ItemEd[] }
interface RefEd {
  chave: number
  id: string | null
  tipo: TipoRefeicao
  hora: string
  nome: string
  avisar: boolean
  alvo: string
  /** Fração do dia do modelo, para recalcular o alvo quando o alvo do dia muda (até a pessoa mexer no alvo). */
  fracao: number | null
  opcoes: OpcaoEd[]
}

let seq = 1
const chave = () => seq++
const TODOS_OS_DIAS = [0, 1, 2, 3, 4, 5, 6]

const itensDe = (o: OpcaoEd) => o.itens.map((i) => ({ quantidade_g: lerNumero(i.gramas), alimento: i.alimento }))
const kcalOpcao = (o: OpcaoEd, comp: Map<string, Composicao>) => kcalDe(itensDe(o), comp)

function Desvio({ kcal, alvo }: { kcal: number; alvo: number }) {
  const d = desvio(kcal, alvo)
  if (d == null) return null
  const ok = naFaixa(kcal, alvo)
  return <span className={'selo' + (ok ? '' : ' alto')}>{ok ? 'na faixa' : (d > 0 ? '+' : '') + fmt(d * 100) + '%'}</span>
}

/** Editor de uma dieta: nome, alvo do dia, dias da semana e as refeições com as opções A, B, C… */
function EditorDieta({ pessoa, original, refeicoesOriginais, metaKcal, onFim }: {
  pessoa: Pessoa
  original: Dieta | null
  refeicoesOriginais: PlanoRefeicao[]
  metaKcal: number | null
  onFim: (salvou: boolean) => void
}) {
  const [nome, setNome] = useState(original?.nome ?? '')
  const [kcal, setKcal] = useState(original?.kcal_alvo != null ? String(original.kcal_alvo) : metaKcal ? String(Math.round(metaKcal)) : '')
  const [dias, setDias] = useState<number[]>(original?.dias ?? [])
  const [refs, setRefs] = useState<RefEd[]>(() => refeicoesOriginais.map((p) => ({
    chave: chave(), id: p.id, tipo: p.tipo, hora: p.hora.slice(0, 5), nome: p.nome ?? '', avisar: p.avisar,
    alvo: p.kcal_alvo != null ? String(p.kcal_alvo) : '', fracao: null,
    opcoes: opcoesDe(p).map((o) => ({ chave: chave(), nome: o.nome, itens: o.itens.map((i) => ({ alimento: i.alimento, gramas: String(i.quantidade_g) })) })),
  })))
  const [removidas, setRemovidas] = useState<string[]>([])
  const [comp, setComp] = useState<Map<string, Composicao>>(new Map())
  const [receitas, setReceitas] = useState<Receita[]>([])
  const [favs, setFavs] = useState<Favorita[]>([])
  const [alimentos, setAlimentos] = useState<AlimentoResumo[]>([])
  const [adicionando, setAdicionando] = useState<{ ref: number; modo: 'favoritas' | 'alimento'; opcao: number | null } | null>(null)
  const [termo, setTermo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const kcalDia = lerNumero(kcal)

  useEffect(() => {
    ;(async () => {
      try {
        const [rs, fs, as] = await Promise.all([carregarReceitas(), carregarFavoritas([pessoa.id]), carregarAlimentos()])
        setReceitas(rs); setFavs(fs); setAlimentos(as)
        const ids = [
          ...receitasDoPlano(rs, fs, [pessoa.id]).map((r) => r.alimento_id),
          ...refeicoesOriginais.flatMap((p) => opcoesDe(p).flatMap((o) => o.itens.map((i) => i.alimento.id))),
        ]
        setComp(await carregarComposicao(ids))
      } catch (e) {
        setErro(erroTexto(e))
      }
    })()
  }, [pessoa.id])

  async function garantirComp(id: string) {
    if (comp.has(id)) return comp
    const c = await carregarComposicao([...comp.keys(), id])
    setComp(c)
    return c
  }

  const mudarRef = (k: number, f: (r: RefEd) => RefEd) => setRefs((xs) => xs.map((r) => (r.chave === k ? f(r) : r)))
  const mudarOpcao = (k: number, ko: number, f: (o: OpcaoEd) => OpcaoEd) =>
    mudarRef(k, (r) => ({ ...r, opcoes: r.opcoes.map((o) => (o.chave === ko ? f(o) : o)) }))

  function montarDia(n: number) {
    setRefs(modeloDoDia(n).map((m) => ({
      chave: chave(), id: null, tipo: m.tipo, hora: m.hora, nome: '', avisar: true,
      alvo: kcalDia ? String(alvoDaRefeicao(kcalDia, m.fracao)) : '', fracao: m.fracao, opcoes: [],
    })))
  }

  function mudarKcalDia(v: string) {
    setKcal(v)
    const dia = lerNumero(v)
    if (dia) setRefs((xs) => xs.map((r) => (r.fracao ? { ...r, alvo: String(alvoDaRefeicao(dia, r.fracao)) } : r)))
  }

  function novaRefeicao() {
    setRefs((xs) => [...xs, { chave: chave(), id: null, tipo: 'lanche_tarde', hora: '16:00', nome: '', avisar: true, alvo: '', fracao: null, opcoes: [] }])
  }

  function tirarRefeicao(r: RefEd) {
    setRefs((xs) => xs.filter((x) => x.chave !== r.chave))
    if (r.id) setRemovidas((xs) => [...xs, r.id!])
  }

  async function opcaoDaReceita(r: RefEd, rec: Receita) {
    const c = await garantirComp(rec.alimento_id)
    const alvo = lerNumero(r.alvo)
    const por100 = c.get(rec.alimento_id)?.energia ?? 0
    const gramas = alvo ? gramasParaFechar(alvo, por100, porcaoDe(rec)) : porcaoDe(rec)
    mudarRef(r.chave, (x) => ({ ...x, opcoes: [...x.opcoes, { chave: chave(), nome: null, itens: [{ alimento: { id: rec.alimento_id, nome: rec.nome }, gramas: String(gramas) }] }] }))
    setAdicionando(null)
  }

  async function alimentoNaOpcao(r: RefEd, a: AlimentoResumo, ko: number | null) {
    await garantirComp(a.id)
    const item: ItemEd = { alimento: { id: a.id, nome: a.nome }, gramas: '100' }
    if (ko == null) mudarRef(r.chave, (x) => ({ ...x, opcoes: [...x.opcoes, { chave: chave(), nome: null, itens: [item] }] }))
    else mudarOpcao(r.chave, ko, (o) => ({ ...o, itens: [...o.itens, item] }))
    setTermo('')
    setAdicionando(null)
  }

  function sugerir(r: RefEd) {
    const alvo = lerNumero(r.alvo)
    if (!alvo) return setErro('Dê um alvo de kcal à refeição para eu sugerir opções.')
    const usados = new Set(r.opcoes.flatMap((o) => o.itens.map((i) => i.alimento.id)))
    const vagas = Math.max(1, 3 - r.opcoes.length)
    const s = sugerirOpcoes(receitas, favs, pessoa.id, r.tipo, alvo, comp, usados, vagas)
    if (!s.length) return setErro(`Nenhuma favorita sua serve para ${nomeTipo(r.tipo).toLowerCase()}. Guarde receitas com o ♥ na aba Receitas.`)
    setErro(null)
    mudarRef(r.chave, (x) => ({
      ...x,
      opcoes: [...x.opcoes, ...s.map((y) => ({ chave: chave(), nome: null, itens: [{ alimento: { id: y.receita.alimento_id, nome: y.receita.nome }, gramas: String(y.gramas) }] }))],
    }))
  }

  function ajustar(r: RefEd, o: OpcaoEd) {
    const alvo = lerNumero(r.alvo)
    if (!alvo) return
    const novos = escalarParaKcal(itensDe(o), comp, alvo)
    mudarOpcao(r.chave, o.chave, (x) => ({ ...x, itens: x.itens.map((i, idx) => ({ ...i, gramas: String(novos[idx].quantidade_g) })) }))
  }

  async function salvar() {
    setErro(null)
    if (!nome.trim()) return setErro('Dê um nome à dieta (ex.: Dia de treino).')
    if (!refs.length) return setErro('Escolha quantas refeições tem o dia.')
    for (const r of refs) {
      const validas = r.opcoes.filter((o) => o.itens.some((i) => lerNumero(i.gramas) > 0))
      if (!validas.length) return setErro(`${nomeTipo(r.tipo)} ${r.hora} está sem opção: ponha pelo menos uma receita ou alimento com as gramas.`)
    }
    setSalvando(true)
    try {
      const id = await salvarDieta({ id: original?.id ?? null, pessoa_id: pessoa.id, nome, kcal_alvo: kcalDia || null, dias })
      for (const r of refs) {
        const validas = r.opcoes.filter((o) => o.itens.some((i) => lerNumero(i.gramas) > 0))
        const itens = (o: OpcaoEd) => o.itens.filter((i) => lerNumero(i.gramas) > 0).map((i) => ({ alimento_id: i.alimento.id, quantidade_g: lerNumero(i.gramas) }))
        await salvarPlanoRefeicao({
          id: r.id, pessoa_id: pessoa.id, tipo: r.tipo, nome: r.nome, hora: r.hora, dias: dias.length ? dias : TODOS_OS_DIAS, avisar: r.avisar,
          itens: itens(validas[0]), dieta_id: id, kcal_alvo: lerNumero(r.alvo) || null,
          opcoes: validas.slice(1).map((o) => ({ nome: o.nome, itens: itens(o) })),
        })
      }
      for (const id of removidas) await apagarPlanoRefeicao(id)
      onFim(true)
    } catch (e) {
      setErro(erroTexto(e))
    } finally {
      setSalvando(false)
    }
  }

  const resultados = useMemo(() => buscarAlimentos(alimentos, termo), [alimentos, termo])
  const totalA = refs.reduce((s, r) => s + (r.opcoes[0] ? kcalOpcao(r.opcoes[0], comp) : 0), 0)
  const somaAlvos = refs.reduce((s, r) => s + lerNumero(r.alvo), 0)

  return (
    <>
      <section className="cartao editor">
        <h2>{original ? 'Editar dieta' : 'Nova dieta'} de {pessoa.nome}</h2>
        <label>Nome<input value={nome} placeholder="ex.: Dia de treino" onChange={(e) => setNome(e.target.value)} /></label>
        <label>
          Alvo do dia
          <span className="com-unidade"><input inputMode="numeric" value={kcal} onChange={(e) => mudarKcalDia(e.target.value)} /> kcal</span>
        </label>
        <p className="dica">
          {metaKcal ? `Sua meta de sempre é ${fmt(metaKcal)} kcal; ` : ''}nos dias com treino a meta do dia sobe, e a Semana mostra a diferença.
          As refeições dividem este alvo, e cada opção fica a até 10% do alvo da refeição.
        </p>
        <fieldset className="quem">
          <legend>Vale nos dias</legend>
          <div className="dias">
            {DIAS_SEMANA.map((d, i) => (
              <button key={d} type="button" className={dias.includes(i) ? 'ativa' : ''} onClick={() => setDias((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i]))}>{d}</button>
            ))}
          </div>
          <small className="dica">{dias.length ? descreverDias(dias) + ' · um dia tem uma dieta só; estes dias saem das outras.' : 'Sem dia marcado a dieta fica guardada e não aparece em Hoje.'}</small>
        </fieldset>
      </section>

      {!refs.length && (
        <section className="cartao">
          <h2>Quantas refeições tem o dia?</h2>
          <div className="chips">
            {[3, 4, 5, 6].map((n) => <button key={n} type="button" onClick={() => montarDia(n)}>{n} refeições</button>)}
          </div>
          <p className="dica">Eu monto os horários e divido o alvo de kcal entre elas; depois é só pôr as opções.</p>
        </section>
      )}

      {refs.map((r) => {
        const alvo = lerNumero(r.alvo)
        return (
          <section key={r.chave} className="cartao refeicao-dieta">
            <div className="linha">
              <select aria-label="Tipo da refeição" value={r.tipo} onChange={(e) => mudarRef(r.chave, (x) => ({ ...x, tipo: e.target.value as TipoRefeicao }))}>
                {TIPOS_REFEICAO.map((t) => <option key={t.valor} value={t.valor}>{t.nome}</option>)}
              </select>
              <input type="time" aria-label="Horário" value={r.hora} onChange={(e) => mudarRef(r.chave, (x) => ({ ...x, hora: e.target.value }))} />
            </div>
            <div className="linha">
              <label className="alvo">
                Alvo
                <span className="com-unidade">
                  <input inputMode="numeric" aria-label={`Alvo de kcal de ${nomeTipo(r.tipo)}`} value={r.alvo} onChange={(e) => mudarRef(r.chave, (x) => ({ ...x, alvo: e.target.value, fracao: null }))} /> kcal
                </span>
              </label>
              <button type="button" className="link perigo" onClick={() => tirarRefeicao(r)}>Tirar refeição</button>
            </div>

            {r.opcoes.map((o, i) => {
              const k = kcalOpcao(o, comp)
              return (
                <div key={o.chave} className="opcao-editor">
                  <div className="linha">
                    <strong>Opção {letra(i)}</strong>
                    <small>{fmt(k)} kcal</small>
                    {alvo > 0 && <Desvio kcal={k} alvo={alvo} />}
                    {alvo > 0 && !naFaixa(k, alvo) && k > 0 && <button type="button" className="link inline" onClick={() => ajustar(r, o)}>Ajustar para {fmt(alvo)}</button>}
                    <button type="button" className="apagar" aria-label={`Tirar a opção ${letra(i)}`} onClick={() => mudarRef(r.chave, (x) => ({ ...x, opcoes: x.opcoes.filter((y) => y.chave !== o.chave) }))}>×</button>
                  </div>
                  {o.itens.map((it, idx) => {
                    const c = comp.get(it.alimento.id)
                    return (
                      <div key={idx} className="item-plano">
                        <span className="nome">{it.alimento.nome}<small className="por100">{c?.energia != null ? ` · ${fmt(c.energia)} kcal/100 g` : ''}</small></span>
                        <span className="com-unidade">
                          <input inputMode="decimal" aria-label={`Gramas de ${it.alimento.nome} na opção ${letra(i)}`} value={it.gramas}
                            onChange={(e) => mudarOpcao(r.chave, o.chave, (x) => ({ ...x, itens: x.itens.map((y, j) => (j === idx ? { ...y, gramas: e.target.value } : y)) }))} />
                          g
                        </span>
                        <small>{fmt(((c?.energia ?? 0) * lerNumero(it.gramas)) / 100)} kcal</small>
                        <button type="button" className="apagar" aria-label="Remover" onClick={() => mudarOpcao(r.chave, o.chave, (x) => ({ ...x, itens: x.itens.filter((_, j) => j !== idx) }))}>×</button>
                      </div>
                    )
                  })}
                  <button type="button" className="link inline" onClick={() => { setTermo(''); setAdicionando({ ref: r.chave, modo: 'alimento', opcao: o.chave }) }}>＋ alimento nesta opção</button>
                </div>
              )
            })}

            <div className="chips quebra">
              <button type="button" onClick={() => setAdicionando(adicionando?.ref === r.chave && adicionando.modo === 'favoritas' ? null : { ref: r.chave, modo: 'favoritas', opcao: null })}>＋ Opção das favoritas</button>
              <button type="button" onClick={() => { setTermo(''); setAdicionando({ ref: r.chave, modo: 'alimento', opcao: null }) }}>＋ Opção com alimentos</button>
              <button type="button" onClick={() => sugerir(r)}>Sugerir opções</button>
            </div>
            {adicionando?.ref === r.chave && adicionando.modo === 'favoritas' && (
              <FavoritasSemana pessoas={[pessoa]} tipo={r.tipo} onEscolher={(rec) => opcaoDaReceita(r, rec)} />
            )}
            {adicionando?.ref === r.chave && adicionando.modo === 'alimento' && (
              <>
                <input className="busca" type="search" autoFocus placeholder="Buscar alimento: arroz, ovo, frango…" value={termo} onChange={(e) => setTermo(e.target.value)} />
                {termo && (
                  <ul className="resultados">
                    {resultados.map((a) => (
                      <li key={a.id}><button type="button" onClick={() => alimentoNaOpcao(r, a, adicionando.opcao)}>{a.nome}<small>{a.familia_id ? `${a.fonte} · da família` : a.categoria}</small></button></li>
                    ))}
                    {!resultados.length && <li className="dica">Nada encontrado. Cadastre pelo rótulo em Perfil.</li>}
                  </ul>
                )}
              </>
            )}
          </section>
        )
      })}

      {!!refs.length && (
        <>
          <button type="button" className="link" onClick={novaRefeicao}>＋ Refeição</button>
          <p className="total-plano">
            {refs.length} {refs.length === 1 ? 'refeição' : 'refeições'} · alvos somam <strong>{fmt(somaAlvos)} kcal</strong>
            {kcalDia ? ` de ${fmt(kcalDia)}` : ''} · opção A de cada uma soma {fmt(totalA)} kcal
          </p>
        </>
      )}
      {erro && <p className="erro">{erro}</p>}
      <div className="linha">
        <button type="button" onClick={() => onFim(false)}>Cancelar</button>
        <button type="button" className="primario" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar dieta'}</button>
      </div>
    </>
  )
}

/** Plano › Dietas: as dietas da pessoa, em que dias valem e como fecham contra a meta desses dias. */
export default function Dietas({ ctx, sel }: { ctx: Contexto; sel: string }) {
  const [dietas, setDietas] = useState<Dieta[] | null>(null)
  const [refeicoes, setRefeicoes] = useState<Map<string, PlanoRefeicao[]>>(new Map())
  const [comp, setComp] = useState<Map<string, Composicao>>(new Map())
  const [metaPorDia, setMetaPorDia] = useState<Map<number, number>>(new Map())
  const [metaKcal, setMetaKcal] = useState<number | null>(null)
  const [editando, setEditando] = useState<Dieta | 'nova' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const pessoa = ctx.pessoas.find((p) => p.id === sel)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const hoje = hojeISO()
        const [ds, metas, md] = await Promise.all([carregarDietas([sel]), carregarMetasVigentes([sel]), carregarMetasDia([sel], hoje, somarDias(hoje, 6))])
        const rs = await Promise.all(ds.map((d) => carregarRefeicoesDaDieta(d.id)))
        const mapa = new Map(ds.map((d, i) => [d.id, rs[i]]))
        const c = await carregarComposicao([...new Set(rs.flat().flatMap((p) => opcoesDe(p).flatMap((o) => o.itens.map((i) => i.alimento.id))))])
        if (!vivo) return
        setDietas(ds); setRefeicoes(mapa); setComp(c)
        setMetaKcal(metas[sel]?.kcal ?? null)
        setMetaPorDia(new Map(md.filter((m) => m.kcal != null).map((m) => [diaDaSemana(m.data), m.kcal!])))
        setErro(null)
      } catch (e) {
        if (vivo) setErro(erroTexto(e))
      }
    })()
    return () => { vivo = false }
  }, [sel, tick])

  async function mudarDias(d: Dieta, dia: number) {
    const dias = d.dias.includes(dia) ? d.dias.filter((x) => x !== dia) : [...d.dias, dia].sort()
    try {
      await salvarDieta({ ...d, dias })
      setTick((t) => t + 1)
    } catch (e) {
      setErro(erroTexto(e))
    }
  }

  async function apagar(d: Dieta) {
    if (!confirm(`Apagar a dieta "${d.nome}" e as refeições dela? O que já foi comido fica registrado.`)) return
    try {
      await apagarDieta(d.id)
      setTick((t) => t + 1)
    } catch (e) {
      setErro(erroTexto(e))
    }
  }

  if (!pessoa) return null
  if (editando) {
    return (
      <EditorDieta
        pessoa={pessoa}
        original={editando === 'nova' ? null : editando}
        refeicoesOriginais={editando === 'nova' ? [] : refeicoes.get(editando.id) ?? []}
        metaKcal={metaKcal}
        onFim={(salvou) => { setEditando(null); if (salvou) setTick((t) => t + 1) }}
      />
    )
  }

  return (
    <>
      <p className="dica">
        Uma dieta é o dia inteiro: você escolhe quantas refeições tem, o que vai em cada uma e as gramas. Cada refeição pode ter
        opções A, B e C com as mesmas calorias; em Hoje você toca na que comeu. Marque em que dias cada dieta vale.
      </p>
      {erro && <p className="erro">{erro}</p>}
      {dietas === null && !erro && <p className="dica">Carregando…</p>}
      {dietas?.map((d) => {
        const rs = refeicoes.get(d.id) ?? []
        const resumo = resumoDieta(rs, comp)
        const metas = d.dias.map((x) => metaPorDia.get(x)).filter((x): x is number => x != null)
        const metaMedia = metas.length ? metas.reduce((s, x) => s + x, 0) / metas.length : null
        const alvo = d.kcal_alvo ?? metaMedia
        const dif = alvo ? (resumo.kcalA - alvo) / alvo : null
        const fecha = dif != null && Math.abs(dif) <= 0.05
        return (
          <section key={d.id} className="cartao dieta">
            <div className="refeicao-topo">
              <strong>{d.nome}</strong>
              {d.kcal_alvo != null && <span className="kcal">alvo {fmt(d.kcal_alvo)} kcal</span>}
            </div>
            <div className="dias" role="group" aria-label={`Dias da dieta ${d.nome}`}>
              {DIAS_SEMANA.map((nome, i) => (
                <button key={nome} type="button" className={d.dias.includes(i) ? 'ativa' : ''} aria-pressed={d.dias.includes(i)} onClick={() => mudarDias(d, i)}>{nome}</button>
              ))}
            </div>
            <p className="dica">
              {rs.length} {rs.length === 1 ? 'refeição' : 'refeições'} · a opção A de cada uma soma <strong>{fmt(resumo.kcalA)} kcal</strong>
              {metaMedia != null && d.dias.length > 0 && <> · meta média nesses dias {fmt(metaMedia)} kcal</>}
              {dif != null && <> · <span className={'selo' + (fecha ? '' : dif > 0 ? ' alto' : ' baixo')}>{fecha ? 'fecha o dia' : (dif > 0 ? 'passa ' : 'falta ') + fmt(Math.abs(dif) * 100) + '%'}</span></>}
              {!d.dias.length && ' · guardada, sem dia marcado'}
            </p>
            <ul className="itens">
              {resumo.refeicoes.map((r) => (
                <li key={r.plano.id}>
                  <span className="hora">{r.plano.hora.slice(0, 5)}</span> {r.plano.nome ?? nomeTipo(r.plano.tipo)}
                  {r.alvo != null && <small> · alvo {fmt(r.alvo)}</small>}
                  <span className="opcoes-resumo">
                    {r.opcoes.map((o) => <span key={o.letra} className={'selo' + (o.naFaixa ? '' : ' alto')}>{o.letra} {fmt(o.kcal)}</span>)}
                  </span>
                </li>
              ))}
            </ul>
            {!resumo.todasNaFaixa && <p className="dica">Alguma opção está longe do alvo da refeição: abra Editar e toque em "Ajustar".</p>}
            <div className="acoes">
              <button className="link" onClick={() => setEditando(d)}>Editar</button>
              <button className="link perigo" onClick={() => apagar(d)}>Apagar</button>
            </div>
          </section>
        )
      })}
      {dietas && !dietas.length && <p className="dica">Nenhuma dieta ainda. Crie a primeira com o número de refeições do seu dia.</p>}
      <button className="primario" onClick={() => setEditando('nova')}>＋ Nova dieta</button>
    </>
  )
}
