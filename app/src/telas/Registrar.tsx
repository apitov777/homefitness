import { useEffect, useMemo, useState } from 'react'
import type { Contexto } from '../App'
import { supabase } from '../supabase'
import {
  buscarAlimentos, carregarAlimentos, carregarComposicao, erroTexto, fmt, hojeISO, TIPOS_REFEICAO,
  type AlimentoResumo, type Composicao, type TipoRefeicao,
} from '../dados'
import { porcaoDe, type Receita } from '../semana'
import FavoritasSemana from './FavoritasSemana'

interface Item {
  alimento: { id: string; nome: string }
  gramas: Record<string, string> // por pessoa_id; texto para aceitar vírgula enquanto digita
}

/** Item com que a tela abre (ex.: "Registrar agora" numa receita), nas gramas da porção para cada pessoa. */
export interface ItemInicial { alimento: { id: string; nome: string }; gramas: number }

function tipoPelaHora(h: number): TipoRefeicao {
  if (h < 10) return 'cafe'
  if (h < 12) return 'lanche_manha'
  if (h < 15) return 'almoco'
  if (h < 18) return 'lanche_tarde'
  if (h < 22) return 'jantar'
  return 'ceia'
}

function numero(s: string | undefined): number {
  const n = parseFloat((s ?? '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export default function Registrar({ ctx, inicial, onSalvo }: { ctx: Contexto; inicial?: ItemInicial | null; onSalvo: () => void }) {
  const agora = new Date()
  const [data, setData] = useState(hojeISO())
  const [hora, setHora] = useState(agora.toTimeString().slice(0, 5))
  const [tipo, setTipo] = useState<TipoRefeicao>(tipoPelaHora(agora.getHours()))
  const [descricao, setDescricao] = useState('')
  const [quem, setQuem] = useState<string[]>(ctx.pessoas.map((p) => p.id))
  const [itens, setItens] = useState<Item[]>(
    inicial ? [{ alimento: inicial.alimento, gramas: Object.fromEntries(ctx.pessoas.map((p) => [p.id, String(inicial.gramas)])) }] : [],
  )
  const [termo, setTermo] = useState('')
  const [alimentos, setAlimentos] = useState<AlimentoResumo[]>([])
  const [comp, setComp] = useState<Map<string, Composicao>>(new Map())
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    carregarAlimentos().then(setAlimentos).catch((e) => setErro(erroTexto(e)))
    if (inicial) carregarComposicao([inicial.alimento.id]).then(setComp).catch((e) => setErro(erroTexto(e)))
  }, [])

  const resultados = useMemo(() => buscarAlimentos(alimentos, termo), [alimentos, termo])
  const pessoasSel = ctx.pessoas.filter((p) => quem.includes(p.id))

  async function incluir(alimento: { id: string; nome: string }, gramas: number) {
    setTermo('')
    const g = Object.fromEntries(ctx.pessoas.map((p) => [p.id, String(gramas)]))
    setItens((xs) => [...xs, { alimento, gramas: g }])
    try {
      const c = await carregarComposicao([...itens.map((i) => i.alimento.id), alimento.id])
      setComp(c)
    } catch (e) {
      setErro(erroTexto(e))
    }
  }
  const adicionar = (a: AlimentoResumo) => incluir(a, 100)
  // Receita da semana: entra na porção dela para cada pessoa (ajusta-se depois, se quiser).
  const adicionarReceita = (r: Receita) => incluir({ id: r.alimento_id, nome: r.nome }, porcaoDe(r))

  function mudarGramas(idx: number, pessoaId: string, valor: string) {
    setItens((xs) => xs.map((it, i) => (i === idx ? { ...it, gramas: { ...it.gramas, [pessoaId]: valor } } : it)))
  }

  function totais(pessoaId: string): Composicao {
    const t: Composicao = {}
    for (const it of itens) {
      const g = numero(it.gramas[pessoaId])
      for (const [k, v] of Object.entries(comp.get(it.alimento.id) ?? {})) t[k] = (t[k] ?? 0) + (v * g) / 100
    }
    return t
  }

  async function salvar() {
    setErro(null)
    if (!pessoasSel.length) return setErro('Escolha quem comeu.')
    if (!itens.length) return setErro('Adicione pelo menos um alimento.')
    setSalvando(true)
    const porcoes = pessoasSel.map((p) => ({
      pessoa_id: p.id,
      itens: itens
        .map((it) => ({ alimento_id: it.alimento.id, quantidade_g: numero(it.gramas[p.id]) }))
        .filter((x) => x.quantidade_g > 0),
    }))
    const { error } = await supabase.rpc('registrar_refeicao', {
      p_familia: ctx.familiaId,
      p_data: data,
      p_tipo: tipo,
      p_hora: hora || null,
      p_descricao: descricao || null,
      p_porcoes: porcoes,
    })
    setSalvando(false)
    if (error) setErro(erroTexto(error))
    else onSalvo()
  }

  return (
    <div className="tela">
      <h1>Registrar refeição</h1>
      <section className="cartao">
        <div className="linha">
          <label>
            Refeição
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoRefeicao)}>
              {TIPOS_REFEICAO.map((t) => <option key={t.valor} value={t.valor}>{t.nome}</option>)}
            </select>
          </label>
        </div>
        <div className="linha">
          <label>
            Dia
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
          <label>
            Hora
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </label>
        </div>
        <fieldset className="quem">
          <legend>Quem comeu</legend>
          {ctx.pessoas.map((p) => (
            <label key={p.id} className="check">
              <input
                type="checkbox"
                checked={quem.includes(p.id)}
                onChange={(e) => setQuem((q) => (e.target.checked ? [...q, p.id] : q.filter((x) => x !== p.id)))}
              />
              {p.nome}
            </label>
          ))}
        </fieldset>
        <label>
          Descrição (opcional)
          <input value={descricao} placeholder="ex.: strogonoff de domingo" onChange={(e) => setDescricao(e.target.value)} />
        </label>
      </section>

      <section className="cartao">
        <h2>Alimentos</h2>
        <FavoritasSemana pessoas={pessoasSel} tipo={tipo} onEscolher={adicionarReceita} />
        <input
          className="busca"
          type="search"
          placeholder="Buscar outro alimento: arroz, feijão, frango…"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
        />
        {termo && (
          <ul className="resultados">
            {resultados.map((a) => (
              <li key={a.id}>
                <button onClick={() => adicionar(a)}>
                  {a.nome}
                  <small>{a.familia_id ? `${a.fonte} · da família` : a.categoria}</small>
                </button>
              </li>
            ))}
            {!resultados.length && <li className="dica">Nada encontrado. Cadastre pelo rótulo em Perfil › Alimentos.</li>}
          </ul>
        )}

        {itens.map((it, idx) => {
          const c = comp.get(it.alimento.id)
          const semEnergia = c && c.energia == null
          return (
            <div key={idx} className="item">
              <div className="item-topo">
                <strong>{it.alimento.nome}</strong>
                <button className="apagar" onClick={() => setItens((xs) => xs.filter((_, i) => i !== idx))} aria-label="Remover">×</button>
              </div>
              {semEnergia && <p className="aviso">A TACO não traz energia/macros deste alimento; ele não vai somar calorias.</p>}
              <div className="gramas">
                {pessoasSel.map((p) => (
                  <label key={p.id}>
                    {p.nome}
                    <span className="com-unidade">
                      <input
                        inputMode="decimal"
                        value={it.gramas[p.id] ?? ''}
                        onChange={(e) => mudarGramas(idx, p.id, e.target.value)}
                      />
                      g
                    </span>
                    <small>{fmt(((c?.energia ?? 0) * numero(it.gramas[p.id])) / 100)} kcal</small>
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </section>

      {itens.length > 0 && (
        <section className="cartao">
          <h2>Total desta refeição</h2>
          <table className="tabela">
            <thead>
              <tr><th></th><th>kcal</th><th>Prot.</th><th>Carb.</th><th>Gord.</th></tr>
            </thead>
            <tbody>
              {pessoasSel.map((p) => {
                const t = totais(p.id)
                return (
                  <tr key={p.id}>
                    <td>{p.nome}</td>
                    <td>{fmt(t.energia)}</td>
                    <td>{fmt(t.proteina, 1)} g</td>
                    <td>{fmt(t.carboidrato, 1)} g</td>
                    <td>{fmt(t.gordura, 1)} g</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {erro && <p className="erro">{erro}</p>}
      <button className="primario" disabled={salvando} onClick={salvar}>
        {salvando ? 'Salvando…' : pessoasSel.length === 2 ? 'Salvar para os dois' : pessoasSel.length > 2 ? 'Salvar para todos' : 'Salvar'}
      </button>
    </div>
  )
}
