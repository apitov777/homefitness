import { useEffect, useMemo, useState } from 'react'
import {
  buscarAlimentos, carregarAlimentos, carregarComposicao, erroTexto, fmt, lerNumero, nomeTipo, somarItens, TIPOS_REFEICAO,
  type AlimentoResumo, type Composicao, type TipoRefeicao,
} from '../dados'
import { arquivarReceita, carregarReceitas, formatarPeso, salvarReceita, type Receita } from '../semana'

interface Ingrediente { alimento: { id: string; nome: string }; gramas: string }

function Editor({ original, onFim }: { original: Receita | null; onFim: (salvou: boolean) => void }) {
  const [nome, setNome] = useState(original?.nome ?? '')
  const [tipos, setTipos] = useState<TipoRefeicao[]>(original?.tipos ?? ['almoco'])
  const [itens, setItens] = useState<Ingrediente[]>(
    original?.item_receita.map((i) => ({ alimento: i.alimento, gramas: String(i.quantidade_g) })) ?? [],
  )
  const [rendimento, setRendimento] = useState(original ? String(original.rendimento_g) : '')
  const [preparo, setPreparo] = useState(original?.modo_preparo ?? '')
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

  const resultados = useMemo(
    () => buscarAlimentos(alimentos.filter((a) => a.id !== original?.alimento_id), termo),
    [alimentos, termo, original],
  )
  const lista = itens.map((i) => ({ alimento: i.alimento, quantidade_g: lerNumero(i.gramas) }))
  const soma = lista.reduce((s, i) => s + i.quantidade_g, 0)
  const pronto = lerNumero(rendimento)
  const tot = somarItens(lista, comp)
  const por100 = (k: string) => (pronto ? ((tot[k] ?? 0) / pronto) * 100 : 0)

  async function salvar() {
    setErro(null)
    if (!nome.trim()) return setErro('Dê um nome para a receita.')
    if (!tipos.length) return setErro('Escolha em que refeição ela entra.')
    if (!lista.some((i) => i.quantidade_g > 0)) return setErro('Adicione os ingredientes com as gramas.')
    if (!pronto) return setErro('Informe o peso da receita pronta.')
    setSalvando(true)
    try {
      await salvarReceita({
        id: original?.id ?? null,
        alimentoAntigo: original?.alimento_id ?? null,
        nome,
        tipos,
        rendimento_g: pronto,
        modo_preparo: preparo,
        itens: lista.map((i) => ({ alimento_id: i.alimento.id, quantidade_g: i.quantidade_g })),
      })
      onFim(true)
    } catch (e) {
      setErro(erroTexto(e))
      setSalvando(false)
    }
  }

  async function arquivar() {
    if (!original || !confirm(`Arquivar ${original.nome}? Ela sai das listas; o que já foi comido continua no histórico.`)) return
    try {
      await arquivarReceita(original.id)
      onFim(true)
    } catch (e) {
      setErro(erroTexto(e))
    }
  }

  return (
    <section className="cartao editor">
      <h2>{original ? 'Editar receita' : 'Nova receita'}</h2>
      <label>Nome<input value={nome} placeholder="ex.: frango com arroz e feijão" onChange={(e) => setNome(e.target.value)} /></label>
      <fieldset className="quem">
        <legend>Entra em</legend>
        <div className="chips quebra">
          {TIPOS_REFEICAO.filter((t) => t.valor !== 'outro').map((t) => (
            <button
              key={t.valor}
              type="button"
              className={tipos.includes(t.valor) ? 'ativa' : ''}
              onClick={() => setTipos((xs) => (xs.includes(t.valor) ? xs.filter((x) => x !== t.valor) : [...xs, t.valor]))}
            >
              {t.nome}
            </button>
          ))}
        </div>
      </fieldset>

      <h2>Ingredientes</h2>
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
      <input className="busca" type="search" placeholder="Adicionar ingrediente: arroz, frango…" value={termo} onChange={(e) => setTermo(e.target.value)} />
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

      <label>
        Peso da receita pronta
        <span className="com-unidade">
          <input inputMode="decimal" value={rendimento} placeholder={soma ? String(soma) : ''} onChange={(e) => setRendimento(e.target.value)} />
          g
        </span>
      </label>
      <p className="dica">
        Pese a panela pronta e desconte o peso da panela. O cozimento muda o peso (a carne perde água, o arroz cru ganha).
        Se os ingredientes já estão no peso cozido, a soma serve.
        {soma > 0 && !pronto && (
          <> <button className="link inline" onClick={() => setRendimento(String(soma))}>Usar a soma ({formatarPeso(soma)})</button></>
        )}
      </p>
      <label>Modo de preparo (opcional)<textarea rows={3} value={preparo} onChange={(e) => setPreparo(e.target.value)} /></label>

      {pronto > 0 && soma > 0 && (
        <div className="formula">
          <strong>{fmt(por100('energia'))} kcal por 100 g</strong> · proteína {fmt(por100('proteina'), 1)} g · carboidrato{' '}
          {fmt(por100('carboidrato'), 1)} g · gordura {fmt(por100('gordura'), 1)} g
          <br />
          Soma dos ingredientes ({fmt(tot.energia)} kcal) ÷ peso pronto ({formatarPeso(pronto)}) × 100.
        </div>
      )}
      {erro && <p className="erro">{erro}</p>}
      <div className="linha">
        <button onClick={() => onFim(false)}>Cancelar</button>
        <button className="primario" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar receita'}</button>
      </div>
      {original && <button className="link perigo" onClick={arquivar}>Arquivar receita</button>}
    </section>
  )
}

export default function Receitas() {
  const [receitas, setReceitas] = useState<Receita[] | null>(null)
  const [comp, setComp] = useState<Map<string, Composicao>>(new Map())
  const [editando, setEditando] = useState<Receita | 'nova' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    ;(async () => {
      try {
        const rs = (await carregarReceitas()).filter((r) => r.ativa)
        setComp(await carregarComposicao(rs.map((r) => r.alimento_id)))
        setReceitas(rs)
      } catch (e) {
        setErro(erroTexto(e))
      }
    })()
  }, [tick])

  if (editando)
    return <Editor original={editando === 'nova' ? null : editando} onFim={(salvou) => { setEditando(null); if (salvou) setTick((t) => t + 1) }} />

  return (
    <>
      <p className="dica">
        O que você sabe cozinhar, com os ingredientes em gramas e o peso da panela pronta. O app calcula 100 g de cada receita
        e usa na Semana para fechar a meta de cada um com a mesma panela.
      </p>
      {erro && <p className="erro">{erro}</p>}
      {receitas === null && !erro && <p className="dica">Carregando…</p>}
      {receitas?.map((r) => {
        const c = comp.get(r.alimento_id) ?? {}
        return (
          <button key={r.id} className="cartao receita" onClick={() => setEditando(r)}>
            <span className="refeicao-topo">
              <strong>{r.nome}</strong>
              <span className="kcal">{fmt(c.energia)} kcal/100 g</span>
            </span>
            <small>
              {r.tipos.map(nomeTipo).join(', ')} · rende {formatarPeso(r.rendimento_g)} · {r.item_receita.length}{' '}
              {r.item_receita.length === 1 ? 'ingrediente' : 'ingredientes'}
            </small>
            <small>Em 100 g: proteína {fmt(c.proteina, 1)} g · carboidrato {fmt(c.carboidrato, 1)} g · gordura {fmt(c.gordura, 1)} g</small>
          </button>
        )
      })}
      {receitas?.length === 0 && (
        <p className="dica">Nenhuma receita ainda. Comece pelos almoços que você faz toda semana.</p>
      )}
      <button className="primario" onClick={() => setEditando('nova')}>＋ Nova receita</button>
    </>
  )
}
