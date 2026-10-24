import { useEffect, useMemo, useState } from 'react'
import type { Contexto } from '../App'
import { supabase } from '../supabase'
import { compartilhar } from '../plataforma'
import {
  buscarAlimentos, carregarAlimentos, carregarComposicao, carregarPlanos, DIAS_SEMANA, erroTexto, fmt, hojeISO, lerNumero,
  nomeTipo, somarDias, TIPOS_REFEICAO,
  type AlimentoResumo, type Composicao, type Pessoa, type PlanoItem, type PlanoRefeicao, type TipoRefeicao,
} from '../dados'
import {
  carregarDias, carregarFavoritas, ehFavorita, carregarMetasDia, carregarReceitas, carregarTreinos, definirDias, diaDaSemana, diasEntre,
  formatarPeso, gramasParaFechar, inicioSemana, kcalItens, mesDe, montarCompras, montarSemana, porcaoDe, receitasDoPlano,
  refeicoesDoDia, rotuloDia, rotuloMes, rotuloSemana, situacaoDia,
  type DiaDefinido, type DiaPlano, type Favorita, type MetaDia, type Receita, type RefeicaoDoDia, type Treino,
} from '../semana'
import Folha from './Folha'

interface Dados {
  de: string
  ate: string
  planos: PlanoRefeicao[]
  dias: DiaPlano[]
  metas: MetaDia[]
  receitas: Receita[]
  favoritas: Favorita[]
  treinos: Treino[]
  comidos: { pessoa_id: string; data: string; kcal: number | null }[]
  comp: Map<string, Composicao>
}

const metaDe = (d: Dados, pessoaId: string, data: string) => d.metas.find((m) => m.pessoa_id === pessoaId && m.data === data)

function resumoItens(itens: PlanoItem[]): string {
  return itens.map((i) => `${i.alimento.nome.split(',')[0]} ${fmt(i.quantidade_g)} g`).join(', ')
}

function textoSituacao(planejado: number, meta: number | null | undefined): string {
  if (!meta) return 'Sem meta'
  const s = situacaoDia(planejado, meta)
  if (s === 'ok') return `Fecha a meta (${fmt((planejado / meta) * 100)}%)`
  if (s === 'falta') return `Faltam ${fmt(meta - planejado)} kcal`
  return `Passa ${fmt(planejado - meta)} kcal`
}

/** Totais do período para uma pessoa: o que está planejado contra a meta e o gasto de cada dia. */
function balanco(d: Dados, pessoaId: string, datas: string[]) {
  let meta = 0, planejado = 0, gasto = 0, fechados = 0, comMeta = 0
  for (const data of datas) {
    const p = refeicoesDoDia(d.planos, d.dias, pessoaId, data).reduce((s, r) => s + kcalItens(r.itens, d.comp), 0)
    const m = metaDe(d, pessoaId, data)
    planejado += p
    if (m?.kcal) {
      comMeta++
      meta += m.kcal
      if (situacaoDia(p, m.kcal) === 'ok') fechados++
    }
    if (m?.gasto_kcal) gasto += m.gasto_kcal
  }
  return { meta, planejado, gasto, fechados, comMeta }
}

// ---------------------------------------------------------------------------
// Uma refeição num dia: trocar por receita, ajustar gramas, mesma panela para a família
// ---------------------------------------------------------------------------

interface ItemEditado { alimento: { id: string; nome: string }; gramas: string }

function EditorDia({ pessoa, refeicao, data, dados, pessoas, onFim }: {
  pessoa: Pessoa
  refeicao: RefeicaoDoDia
  data: string
  dados: Dados
  pessoas: Pessoa[]
  onFim: (salvou: boolean) => void
}) {
  // Primeiro as favoritas da pessoa e as da família que servem para esta refeição; o resto do catálogo depois.
  const minhas = receitasDoPlano(dados.receitas, dados.favoritas, [pessoa.id])
  const doTipo = minhas.filter((r) => r.tipos.includes(refeicao.plano.tipo))
  const outrasReceitas = dados.receitas.filter((r) => r.ativa && !doTipo.includes(r))
  const ehReceita = (id: string) => dados.receitas.some((r) => r.alimento_id === id)
  const [itens, setItens] = useState<ItemEditado[]>(refeicao.itens.map((i) => ({ alimento: i.alimento, gramas: String(i.quantidade_g) })))
  const [receitaId, setReceitaId] = useState<string | null>(refeicao.dia?.receita_id ?? null)
  const [juntos, setJuntos] = useState<Set<string>>(new Set())
  const [termo, setTermo] = useState('')
  const [alimentos, setAlimentos] = useState<AlimentoResumo[]>([])
  const [comp, setComp] = useState(dados.comp)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    carregarAlimentos().then(setAlimentos).catch((e) => setErro(erroTexto(e)))
  }, [])
  useEffect(() => {
    carregarComposicao(itens.map((i) => i.alimento.id)).then((c) => setComp((x) => new Map([...x, ...c]))).catch(() => {})
  }, [itens.length])

  const resultados = useMemo(() => buscarAlimentos(alimentos, termo), [alimentos, termo])
  const lista = itens.map((i, idx) => ({ id: String(idx), ordem: idx, alimento: i.alimento, quantidade_g: lerNumero(i.gramas) }))
  const kcalRefeicao = kcalItens(lista, comp)
  const outrasDoDia = (pessoaId: string) =>
    refeicoesDoDia(dados.planos, dados.dias, pessoaId, data)
      .filter((r) => r.plano.id !== refeicao.plano.id && !(pessoaId !== pessoa.id && r.plano.tipo === refeicao.plano.tipo))
      .reduce((s, r) => s + kcalItens(r.itens, comp), 0)
  const meta = metaDe(dados, pessoa.id, data)?.kcal ?? null
  const outras = outrasDoDia(pessoa.id)
  const receita = dados.receitas.find((r) => r.id === receitaId) ?? null
  const k100 = receita ? (comp.get(receita.alimento_id)?.energia ?? 0) : 0

  // Quem mais tem esta refeição no plano neste dia e pode comer da mesma panela.
  const familia = receita
    ? pessoas
        .filter((p) => p.id !== pessoa.id)
        .map((p) => {
          const slot = refeicoesDoDia(dados.planos, dados.dias, p.id, data).find((r) => r.plano.tipo === refeicao.plano.tipo)
          const m = metaDe(dados, p.id, data)?.kcal
          if (!slot || !m) return null
          return { pessoa: p, plano: slot.plano.id, gramas: gramasParaFechar(m - outrasDoDia(p.id), k100, receita.porcao_g) }
        })
        .filter((x): x is { pessoa: Pessoa; plano: string; gramas: number } => !!x)
    : []

  function usarReceita(id: string) {
    const r = dados.receitas.find((x) => x.id === id)
    if (!r) return
    const resto = itens.filter((i) => !ehReceita(i.alimento.id))
    const kResto = kcalItens(resto.map((i, idx) => ({ id: String(idx), ordem: idx, alimento: i.alimento, quantidade_g: lerNumero(i.gramas) })), comp)
    const g = meta ? gramasParaFechar(meta - outras - kResto, comp.get(r.alimento_id)?.energia ?? 0, r.porcao_g) : porcaoDe(r)
    setReceitaId(r.id)
    setItens([{ alimento: { id: r.alimento_id, nome: r.nome }, gramas: String(g) }, ...resto])
  }

  async function salvar() {
    setErro(null)
    const validos = lista.filter((i) => i.quantidade_g > 0)
    if (!validos.length) return setErro('A refeição ficou sem nenhum alimento.')
    const ficouReceita = receita && validos.some((i) => i.alimento.id === receita.alimento_id) ? receita.id : null
    const pedido: DiaDefinido[] = [{
      plano: refeicao.plano.id, data, receita: ficouReceita,
      itens: validos.map((i) => ({ alimento_id: i.alimento.id, quantidade_g: i.quantidade_g })),
    }]
    if (ficouReceita) {
      for (const f of familia.filter((x) => juntos.has(x.pessoa.id))) {
        pedido.push({ plano: f.plano, data, receita: ficouReceita, itens: [{ alimento_id: receita!.alimento_id, quantidade_g: f.gramas }] })
      }
    }
    setSalvando(true)
    try {
      await definirDias(pedido)
      onFim(true)
    } catch (e) {
      setErro(erroTexto(e))
      setSalvando(false)
    }
  }

  async function voltarAoPlano() {
    try {
      await definirDias([{ plano: refeicao.plano.id, data, receita: null, itens: [] }])
      onFim(true)
    } catch (e) {
      setErro(erroTexto(e))
    }
  }

  const titulo = `${refeicao.plano.nome ?? nomeTipo(refeicao.plano.tipo)} · ${rotuloDia(data)}`
  return (
    <Folha titulo={titulo} onFechar={() => onFim(false)}>
      <p className="dica">
        {pessoa.nome}
        {meta != null && <> · meta do dia {fmt(meta)} kcal · outras refeições {fmt(outras)} kcal · sobram {fmt(meta - outras)} kcal</>}
      </p>
      <label>
        Receita
        <select value={receitaId ?? ''} onChange={(e) => (e.target.value ? usarReceita(e.target.value) : setReceitaId(null))}>
          <option value="">Sem receita</option>
          {doTipo.map((r) => <option key={r.id} value={r.id}>{r.nome} ({fmt(comp.get(r.alimento_id)?.energia)} kcal/100 g)</option>)}
          {outrasReceitas.length > 0 && (
            <optgroup label="Outras receitas">
              {outrasReceitas.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
            </optgroup>
          )}
        </select>
      </label>
      {!minhas.length && <p className="dica">Favorite receitas na aba Receitas (ou crie as suas) para elas aparecerem primeiro aqui.</p>}

      {itens.map((it, idx) => (
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
          <small>{fmt(((comp.get(it.alimento.id)?.energia ?? 0) * lerNumero(it.gramas)) / 100)} kcal</small>
          <button className="apagar" onClick={() => setItens((xs) => xs.filter((_, i) => i !== idx))} aria-label="Remover">×</button>
        </div>
      ))}
      <input className="busca" type="search" placeholder="Adicionar: salada, fruta…" value={termo} onChange={(e) => setTermo(e.target.value)} />
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
          {!resultados.length && <li className="dica">Nada encontrado.</li>}
        </ul>
      )}
      <p className="total-plano">
        <strong>{fmt(kcalRefeicao)} kcal</strong> nesta refeição
        {meta != null && <> · o dia fica em {fmt(outras + kcalRefeicao)} de {fmt(meta)} kcal ({textoSituacao(outras + kcalRefeicao, meta).toLowerCase()})</>}
      </p>

      {familia.length > 0 && (
        <fieldset className="quem">
          <legend>Mesma panela, gramas pela meta de cada um</legend>
          {familia.map((f) => (
            <label key={f.pessoa.id} className="check">
              <input
                type="checkbox"
                checked={juntos.has(f.pessoa.id)}
                onChange={(e) => setJuntos((s) => {
                  const n = new Set(s)
                  if (e.target.checked) n.add(f.pessoa.id)
                  else n.delete(f.pessoa.id)
                  return n
                })}
              />
              Também para {f.pessoa.nome}: {fmt(f.gramas)} g
            </label>
          ))}
        </fieldset>
      )}
      {erro && <p className="erro">{erro}</p>}
      <button className="primario" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar o dia'}</button>
      {refeicao.dia && <button className="link" onClick={voltarAoPlano}>Voltar ao plano de sempre</button>}
    </Folha>
  )
}

// ---------------------------------------------------------------------------
// Montar a semana (ou o mês) revezando as receitas
// ---------------------------------------------------------------------------

function Montar({ datas, dados, pessoas, onFim }: {
  datas: string[]
  dados: Dados
  pessoas: Pessoa[]
  onFim: (salvou: boolean) => void
}) {
  const tiposNoPlano = TIPOS_REFEICAO.filter((t) => dados.planos.some((p) => p.tipo === t.valor))
  const [tipos, setTipos] = useState<TipoRefeicao[]>(tiposNoPlano.some((t) => t.valor === 'almoco') ? ['almoco'] : tiposNoPlano.slice(0, 1).map((t) => t.valor))
  const [quem, setQuem] = useState<Set<string>>(new Set(pessoas.map((p) => p.id)))
  // Só as receitas da própria família e as favoritas de cada pessoa; o catálogo inteiro não.
  const ativas = receitasDoPlano(dados.receitas, dados.favoritas, pessoas.map((p) => p.id))
  const favoritaDe = (r: Receita) => pessoas.filter((p) => ehFavorita(dados.favoritas, p.id, r.id))
  const deQuem = (r: Receita) => (r.familia_id ? 'da família' : favoritaDe(r).map((p) => `♥ ${p.nome}`).join(' '))
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set(ativas.map((r) => r.id)))
  const [semanais, setSemanais] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const hoje = hojeISO()
  const alvo = datas.filter((d) => d >= hoje && semanais.includes(diaDaSemana(d)))
  // Entram as da família e as favoritas de quem está marcado; quem está junto come da mesma panela.
  const candidatas = ativas.filter((r) => r.tipos.some((t) => tipos.includes(t)) && (r.familia_id || favoritaDe(r).some((p) => quem.has(p.id))))
  const resultado = montarSemana(
    { datas: alvo, pessoas: pessoas.filter((p) => quem.has(p.id)).map((p) => p.id), tipos, receitas: candidatas.filter((r) => escolhidas.has(r.id)) },
    dados.planos, dados.dias, dados.metas, dados.comp,
  )
  const nome = (id: string) => pessoas.find((p) => p.id === id)?.nome ?? ''
  const porDia = alvo
    .map((d) => ({ data: d, itens: resultado.dias.filter((x) => x.data === d) }))
    .filter((x) => x.itens.length)

  const alternar = <T,>(s: Set<T>, v: T) => {
    const n = new Set(s)
    if (n.has(v)) n.delete(v)
    else n.add(v)
    return n
  }

  async function montar() {
    setSalvando(true)
    setErro(null)
    try {
      await definirDias(resultado.dias)
      onFim(true)
    } catch (e) {
      setErro(erroTexto(e))
      setSalvando(false)
    }
  }

  return (
    <Folha titulo="Montar com receitas" onFechar={() => onFim(false)}>
      {!ativas.length ? (
        <p className="dica">Favorite receitas na aba Receitas (toque no ♡), ou crie as suas, para montar a semana com elas.</p>
      ) : (
        <>
          <fieldset className="quem">
            <legend>Refeições</legend>
            <div className="chips quebra">
              {tiposNoPlano.map((t) => (
                <button key={t.valor} className={tipos.includes(t.valor) ? 'ativa' : ''} onClick={() => setTipos((xs) => (xs.includes(t.valor) ? xs.filter((x) => x !== t.valor) : [...xs, t.valor]))}>
                  {t.nome}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="quem">
            <legend>Para quem (mesma panela, gramas de cada um)</legend>
            {pessoas.map((p) => (
              <label key={p.id} className="check">
                <input type="checkbox" checked={quem.has(p.id)} onChange={() => setQuem((s) => alternar(s, p.id))} />
                {p.nome}
              </label>
            ))}
          </fieldset>
          <fieldset className="quem">
            <legend>Receitas que se revezam (da família e favoritas de quem está marcado)</legend>
            {candidatas.map((r) => (
              <label key={r.id} className="check">
                <input type="checkbox" checked={escolhidas.has(r.id)} onChange={() => setEscolhidas((s) => alternar(s, r.id))} />
                {r.nome} <small className="dica">({r.tipos.map(nomeTipo).join(', ').toLowerCase()}) · {deQuem(r)}</small>
              </label>
            ))}
            {!candidatas.length && <p className="dica">Nenhuma receita da família ou favorita de quem está marcado entra nessas refeições.</p>}
          </fieldset>
          <fieldset className="quem">
            <legend>Dias da semana</legend>
            <div className="dias">
              {DIAS_SEMANA.map((d, i) => (
                <button key={d} className={semanais.includes(i) ? 'ativa' : ''} onClick={() => setSemanais((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i]))}>
                  {d}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="dica">
            {alvo.length} {alvo.length === 1 ? 'dia' : 'dias'} de hoje em diante. As gramas fecham a meta de cada dia de cada um, contando
            as outras refeições. Substitui o que já estava montado nessas refeições.
          </p>
          <ul className="previa">
            {porDia.map((x) => (
              <li key={x.data}>
                <strong>{rotuloDia(x.data)}</strong>
                {x.itens.map((i) => {
                  const p = dados.planos.find((pl) => pl.id === i.plano)!
                  const r = dados.receitas.find((rr) => rr.id === i.receita)!
                  return <span key={i.plano}>{nome(p.pessoa_id)} · {nomeTipo(p.tipo)}: {r.nome} {fmt(i.itens[0].quantidade_g)} g</span>
                })}
              </li>
            ))}
          </ul>
          {[...resultado.semMeta].map((id) => <p key={id} className="aviso">{nome(id)} está sem meta: faça o cadastro em Perfil.</p>)}
          {[...resultado.semRefeicao].map((id) => (
            <p key={id} className="aviso">{nome(id)} não tem {tipos.map(nomeTipo).join(' nem ').toLowerCase()} no plano em alguns desses dias (veja em Refeições).</p>
          ))}
          {[...resultado.semReceita].map((t) => <p key={t} className="aviso">Nenhuma receita escolhida serve para {nomeTipo(t).toLowerCase()}.</p>)}
          {erro && <p className="erro">{erro}</p>}
          <button className="primario" disabled={salvando || !resultado.dias.length} onClick={montar}>
            {salvando ? 'Montando…' : `Montar ${resultado.dias.length} ${resultado.dias.length === 1 ? 'refeição' : 'refeições'}`}
          </button>
        </>
      )}
    </Folha>
  )
}

// ---------------------------------------------------------------------------
// Quanto cozinhar e lista de compras
// ---------------------------------------------------------------------------

function Compras({ de, ate, rotulo, dados, pessoas, onVoltar }: {
  de: string
  ate: string
  rotulo: string
  dados: Dados
  pessoas: Pessoa[]
  onVoltar: () => void
}) {
  const hoje = hojeISO()
  const [soFuturo, setSoFuturo] = useState(de <= hoje)
  const [quem, setQuem] = useState<Set<string>>(new Set(pessoas.map((p) => p.id)))
  const [alimentos, setAlimentos] = useState<AlimentoResumo[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    carregarAlimentos().then(setAlimentos).catch(() => {})
  }, [])

  const datas = diasEntre(de, ate).filter((d) => !soFuturo || d >= hoje)
  const refeicoes = pessoas
    .filter((p) => quem.has(p.id))
    .flatMap((p) => datas.flatMap((data) => refeicoesDoDia(dados.planos, dados.dias, p.id, data).map((r) => ({ data, pessoaId: p.id, itens: r.itens }))))
  const categoria = useMemo(() => new Map(alimentos.map((a) => [a.id, a.categoria])), [alimentos])
  const c = montarCompras(refeicoes, dados.receitas, (id) => categoria.get(id) ?? null)
  const nome = (id: string) => pessoas.find((p) => p.id === id)?.nome ?? ''

  async function enviar() {
    const texto = [
      `Lista de compras · ${rotulo}`,
      ...c.categorias.flatMap(([cat, ls]) => ['', cat, ...ls.map((l) => `- ${l.nome}: ${formatarPeso(l.gramas)}`)]),
    ].join('\n')
    const r = await compartilhar('Lista de compras', texto)
    setMsg(r === 'copiado' ? 'Lista copiada.' : null)
  }

  return (
    <>
      <button className="link voltar" onClick={onVoltar}>‹ Semana</button>
      <h2>Compras · {rotulo}</h2>
      <section className="cartao">
        <label className="check">
          <input type="checkbox" checked={soFuturo} onChange={(e) => setSoFuturo(e.target.checked)} />
          Só de hoje em diante
        </label>
        {pessoas.map((p) => (
          <label key={p.id} className="check">
            <input
              type="checkbox"
              checked={quem.has(p.id)}
              onChange={() => setQuem((s) => {
                const n = new Set(s)
                if (n.has(p.id)) n.delete(p.id)
                else n.add(p.id)
                return n
              })}
            />
            {p.nome}
          </label>
        ))}
      </section>

      <section className="cartao">
        <h2>Quanto cozinhar</h2>
        {!c.panelas.length && <p className="dica">Nenhuma receita no período. Monte a semana com receitas para ver as panelas.</p>}
        {c.panelas.map((p) => (
          <div key={p.receita.id} className="panela">
            <div className="refeicao-topo">
              <strong>{p.receita.nome}</strong>
              <span className="kcal">{formatarPeso(p.gramas)}</span>
            </div>
            <small className="dica">
              ≈ {fmt(p.vezes, 1)} {p.vezes > 0 && p.vezes <= 1 ? 'receita' : 'receitas'} (cada uma rende {formatarPeso(p.receita.rendimento_g)}).
              Ingredientes: {p.receita.item_receita.map((i) => `${i.alimento.nome.split(',')[0].toLowerCase()} ${formatarPeso((i.quantidade_g * p.gramas) / p.receita.rendimento_g)}`).join(', ')}.
            </small>
            <details>
              <summary>Por dia</summary>
              <ul className="itens">
                {datas.map((d) => {
                  const doDia = p.porDia.filter((x) => x.data === d)
                  if (!doDia.length) return null
                  return <li key={d}>{rotuloDia(d)}: {doDia.map((x) => `${nome(x.pessoaId)} ${fmt(x.gramas)} g`).join(', ')}</li>
                })}
              </ul>
            </details>
          </div>
        ))}
      </section>

      <section className="cartao">
        <div className="instalar-topo">
          <h2>Lista de compras</h2>
          {c.categorias.length > 0 && <button className="link" onClick={enviar}>Enviar</button>}
        </div>
        {!c.categorias.length && <p className="dica">Nada planejado no período.</p>}
        {c.categorias.map(([cat, ls]) => (
          <div key={cat} className="categoria-compra">
            <h3>{cat}</h3>
            <ul className="itens">
              {ls.map((l) => <li key={l.id}><span>{l.nome}</span><span>{formatarPeso(l.gramas)}</span></li>)}
            </ul>
          </div>
        ))}
        <p className="dica">Os pesos são os do cadastro de cada alimento: o que está cozido na tabela aparece com o peso pronto.</p>
        {msg && <p className="ok">{msg}</p>}
      </section>
    </>
  )
}

// ---------------------------------------------------------------------------
// Semana e mês
// ---------------------------------------------------------------------------

export default function Semana({ ctx, sel, onIrPara }: { ctx: Contexto; sel: string; onIrPara: (p: 'refeicoes' | 'treinos') => void }) {
  const hoje = hojeISO()
  const [modo, setModo] = useState<'semana' | 'mes'>('semana')
  const [ancora, setAncora] = useState(hoje)
  const [carregados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [editando, setEditando] = useState<{ refeicao: RefeicaoDoDia; data: string } | null>(null)
  const [montando, setMontando] = useState(false)
  const [compras, setCompras] = useState(false)
  const pessoa = ctx.pessoas.find((p) => p.id === sel)
  const ids = useMemo(() => ctx.pessoas.map((p) => p.id), [ctx.pessoas])

  const { de, ate } = modo === 'semana' ? { de: inicioSemana(ancora), ate: somarDias(inicioSemana(ancora), 6) } : mesDe(ancora)
  const datas = diasEntre(de, ate)
  const rotulo = modo === 'semana' ? rotuloSemana(de, ate) : rotuloMes(de)
  // Ao trocar de período, não mostra os números do anterior enquanto carrega.
  const dados = carregados?.de === de && carregados.ate === ate ? carregados : null

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const planos = await carregarPlanos(ids)
        const [dias, metas, receitas, favoritas, treinos, { data: comidos, error }] = await Promise.all([
          carregarDias(planos.map((p) => p.id), de, ate),
          carregarMetasDia(ids, de, ate),
          carregarReceitas(),
          carregarFavoritas(ids),
          carregarTreinos(ids),
          supabase.from('v_dia_vs_meta').select('pessoa_id, data, kcal').in('pessoa_id', ids).gte('data', de).lte('data', ate),
        ])
        if (error) throw error
        const comp = await carregarComposicao([...new Set([
          ...planos.flatMap((p) => p.plano_item.map((i) => i.alimento.id)),
          ...dias.flatMap((d) => d.plano_dia_item.map((i) => i.alimento.id)),
          ...receitas.map((r) => r.alimento_id),
        ])])
        if (!vivo) return
        setDados({ de, ate, planos, dias, metas, receitas, favoritas, treinos, comidos: comidos ?? [], comp })
        setErro(null)
      } catch (e) {
        if (vivo) setErro(erroTexto(e))
      }
    })()
    return () => { vivo = false }
  }, [ids, de, ate, tick])

  function navegar(passo: number) {
    if (modo === 'semana') setAncora(somarDias(ancora, 7 * passo))
    else {
      const [a, m] = ancora.split('-').map(Number)
      const d = new Date(a, m - 1 + passo, 1)
      setAncora(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
    }
  }

  if (!pessoa) return null
  if (compras && dados)
    return <Compras de={de} ate={ate} rotulo={rotulo} dados={dados} pessoas={ctx.pessoas} onVoltar={() => setCompras(false)} />

  const b = dados ? balanco(dados, sel, datas) : null
  const saldo = b ? b.planejado - b.gasto : 0
  const treinosDe = (data: string) => dados?.treinos.filter((t) => t.pessoa_id === sel && t.dias.includes(diaDaSemana(data))) ?? []

  return (
    <>
      <div className="segmentos pequeno">
        <button className={modo === 'semana' ? 'ativa' : ''} onClick={() => setModo('semana')}>Semana</button>
        <button className={modo === 'mes' ? 'ativa' : ''} onClick={() => setModo('mes')}>Mês</button>
      </div>
      <div className="cabecalho-data">
        <button onClick={() => navegar(-1)} aria-label="Anterior">‹</button>
        <strong className="periodo">{rotulo}</strong>
        <button onClick={() => navegar(1)} aria-label="Próximo">›</button>
      </div>
      {!datas.includes(hoje) && <button className="link" onClick={() => setAncora(hoje)}>Voltar para hoje</button>}
      {erro && <p className="erro">{erro}</p>}
      {!dados && !erro && <p className="dica">Carregando…</p>}

      {dados && b && (
        <section className="cartao saldo">
          <h2>Saldo {modo === 'semana' ? 'da semana' : 'do mês'} de {pessoa.nome}</h2>
          {b.comMeta ? (
            <>
              <div className="numeros">
                <span><small>Planejado</small><strong>{fmt(b.planejado)}</strong>kcal</span>
                <span><small>Meta</small><strong>{fmt(b.meta)}</strong>kcal</span>
                <span><small>Gasto</small><strong>{fmt(b.gasto)}</strong>kcal</span>
              </div>
              {/* Verde quando o planejado bate com a meta da pessoa (déficit para quem perde, superávit para quem ganha). */}
              <p className={situacaoDia(b.planejado, b.meta) === 'ok' ? 'ok' : 'aviso-caixa'}>
                {saldo < 0 ? 'Déficit' : 'Superávit'} de {fmt(Math.abs(saldo))} kcal no período, ≈ {fmt(Math.abs(saldo) / 7700, 2)} kg
                {saldo < 0 ? ' a menos' : ' a mais'} (estimativa de 7.700 kcal por kg de gordura; a balança confirma).
              </p>
              {b.planejado < b.meta * 0.9 && (
                <p className="dica">O plano está abaixo da meta: use Montar com receitas para fechar os dias.</p>
              )}
              <p className="dica">
                {b.fechados} de {b.comMeta} dias fecham a meta em ±5%. {pessoa.meta_pelo_treino ? 'A meta acompanha os treinos.' : 'Meta fixa.'}{' '}
                <button className="link inline" onClick={() => onIrPara('treinos')}>Treinos e meta</button>
              </p>
            </>
          ) : (
            <p className="dica">{pessoa.nome} está sem meta. Faça o cadastro em Perfil para ver o saldo.</p>
          )}
          <div className="linha">
            <button onClick={() => setMontando(true)}>Montar com receitas</button>
            <button onClick={() => setCompras(true)}>Compras</button>
          </div>
        </section>
      )}

      {dados && modo === 'mes' && (
        <section className="cartao">
          <div className="calendario">
            {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d) => <span key={d} className="cab">{d}</span>)}
            {Array.from({ length: (diaDaSemana(de) + 6) % 7 }, (_, i) => <span key={'v' + i} />)}
            {datas.map((d) => {
              const p = refeicoesDoDia(dados.planos, dados.dias, sel, d).reduce((s, r) => s + kcalItens(r.itens, dados.comp), 0)
              const m = metaDe(dados, sel, d)?.kcal
              const s = situacaoDia(p, m ?? null) ?? 'sem'
              return (
                <button
                  key={d}
                  className={`dia-mes s-${s}${d === hoje ? ' hoje' : ''}`}
                  aria-label={`${rotuloDia(d)}: ${fmt(p)} de ${fmt(m)} kcal`}
                  onClick={() => { setAncora(d); setModo('semana') }}
                >
                  <span className="num">{Number(d.slice(8))}</span>
                  <small>{p ? fmt(p) : ''}</small>
                  {treinosDe(d).length > 0 && <span className="ponto" aria-hidden />}
                </button>
              )
            })}
          </div>
          <p className="dica legenda">
            <span className="cor s-ok" /> fecha em ±5% <span className="cor s-falta" /> falta ou passa <span className="ponto" /> treino
          </p>
        </section>
      )}

      {dados && modo === 'semana' && datas.map((d) => {
        const refs = refeicoesDoDia(dados.planos, dados.dias, sel, d)
        const p = refs.reduce((s, r) => s + kcalItens(r.itens, dados.comp), 0)
        const m = metaDe(dados, sel, d)
        const s = situacaoDia(p, m?.kcal ?? null)
        const comido = dados.comidos.find((c) => c.pessoa_id === sel && c.data === d)?.kcal
        return (
          <section key={d} className={'cartao dia-semana' + (d < hoje ? ' passado' : '')}>
            <div className="refeicao-topo">
              <strong>{rotuloDia(d)}</strong>
              {d === hoje && <span className="selo">hoje</span>}
              <span className={'kcal s-' + (s ?? 'sem')}>{fmt(p)}{m?.kcal ? ` / ${fmt(m.kcal)}` : ''} kcal</span>
            </div>
            {treinosDe(d).map((t) => (
              <small key={t.id} className="treino-dia">🏋 {t.atividade} · {t.minutos} min</small>
            ))}
            <ul className="refeicoes-dia">
              {refs.map((r) => (
                <li key={r.plano.id}>
                  <button className="refeicao-dia" onClick={() => setEditando({ refeicao: r, data: d })}>
                    <span className="hora">{r.plano.hora.slice(0, 5)}</span>
                    <span className="texto">
                      <strong>{r.plano.nome ?? nomeTipo(r.plano.tipo)}</strong>
                      <small>{resumoItens(r.itens)}</small>
                    </span>
                    {r.dia && <span className="selo">{r.dia.receita_id ? 'receita' : 'do dia'}</span>}
                    <span className="kcal">{fmt(kcalItens(r.itens, dados.comp))}</span>
                  </button>
                </li>
              ))}
            </ul>
            {!refs.length && (
              <p className="dica">
                Sem refeições no plano neste dia. <button className="link inline" onClick={() => onIrPara('refeicoes')}>Montar em Refeições</button>
              </p>
            )}
            <small className={'situacao-dia s-' + (s ?? 'sem')}>
              {textoSituacao(p, m?.kcal)}
              {m?.gasto_kcal ? ` · gasto ${fmt(m.gasto_kcal)} kcal${m.treino_kcal ? ` (treino ${fmt(m.treino_kcal)})` : ''} · saldo ${p - m.gasto_kcal > 0 ? '+' : '−'}${fmt(Math.abs(p - m.gasto_kcal))} kcal` : ''}
              {comido != null && d <= hoje ? ` · comeu ${fmt(comido)} kcal` : ''}
            </small>
          </section>
        )
      })}

      {editando && dados && (
        <EditorDia
          pessoa={pessoa}
          refeicao={editando.refeicao}
          data={editando.data}
          dados={dados}
          pessoas={ctx.pessoas}
          onFim={(salvou) => { setEditando(null); if (salvou) setTick((t) => t + 1) }}
        />
      )}
      {montando && dados && (
        <Montar
          datas={datas}
          dados={dados}
          pessoas={ctx.pessoas}
          onFim={(salvou) => { setMontando(false); if (salvou) setTick((t) => t + 1) }}
        />
      )}
    </>
  )
}
