import { useEffect, useMemo, useState } from 'react'
import {
  buscarAlimentos, carregarAlimentos, carregarComposicao, erroTexto, fmt, lerNumero, somarItens, TIPOS_REFEICAO,
  type AlimentoResumo, type Composicao, type TipoRefeicao,
} from '../dados'
import { definirFoto, enviarFotoReceita, removerFotoReceita } from '../fotos'
import { arquivarReceita, formatarPeso, salvarReceita, type Receita } from '../semana'

interface Ingrediente { alimento: { id: string; nome: string }; gramas: string }

/**
 * Cria ou edita uma receita da família. Com `base` de uma receita do catálogo, abre uma cópia para adaptar
 * (a do catálogo não muda).
 */
export default function EditorReceita({ original, base, familiaId, fotoAtual, onFim }: {
  original: Receita | null
  base?: Receita | null
  familiaId: string
  /** URL da foto atual (da receita editada ou da base adaptada), já assinada quando for do Storage. */
  fotoAtual?: string | null
  onFim: (salvou: boolean) => void
}) {
  const modelo = original ?? base ?? null
  const [novaFoto, setNovaFoto] = useState<File | null>(null)
  const [previa, setPrevia] = useState<string | null>(null)
  const [semFoto, setSemFoto] = useState(false)
  const fotoMostrada = semFoto ? null : previa ?? fotoAtual ?? null
  const [nome, setNome] = useState(modelo?.nome ?? '')
  const [descricao, setDescricao] = useState(modelo?.descricao ?? '')
  const [tipos, setTipos] = useState<TipoRefeicao[]>(modelo?.tipos ?? ['almoco'])
  const [itens, setItens] = useState<Ingrediente[]>(
    modelo?.item_receita.map((i) => ({ alimento: i.alimento, gramas: String(i.quantidade_g) })) ?? [],
  )
  const [rendimento, setRendimento] = useState(modelo ? String(modelo.rendimento_g) : '')
  const [porcao, setPorcao] = useState(modelo?.porcao_g ? String(modelo.porcao_g) : '')
  const [preparo, setPreparo] = useState(modelo?.modo_preparo ?? '')
  const [termo, setTermo] = useState('')
  const [alimentos, setAlimentos] = useState<AlimentoResumo[]>([])
  const [comp, setComp] = useState<Map<string, Composicao>>(new Map())
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    carregarAlimentos().then(setAlimentos).catch((e) => setErro(erroTexto(e)))
  }, [])
  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa) }, [previa])

  function escolherFoto(f: File | undefined) {
    if (!f) return
    if (!f.type.startsWith('image/')) return setErro('Escolha uma imagem.')
    setNovaFoto(f)
    setPrevia(URL.createObjectURL(f))
    setSemFoto(false)
  }
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
      const id = await salvarReceita({
        id: original?.id ?? null,
        alimentoAntigo: original?.alimento_id ?? null,
        nome,
        descricao,
        tipos,
        rendimento_g: pronto,
        porcao_g: lerNumero(porcao) || null,
        modo_preparo: preparo,
        itens: lista.map((i) => ({ alimento_id: i.alimento.id, quantidade_g: i.quantidade_g })),
      })
      // Foto: nova vai para o Storage; adaptada herda a do catálogo; "tirar foto" apaga a da família.
      if (novaFoto) await enviarFotoReceita(familiaId, id, novaFoto)
      else if (semFoto && original?.foto) await removerFotoReceita(id, original.foto)
      else if (!original && base?.foto && !semFoto) await definirFoto(id, base.foto)
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
      <h2>{original ? 'Editar receita' : base ? `Adaptar: ${base.nome}` : 'Nova receita'}</h2>
      <label>Nome<input value={nome} placeholder="ex.: frango com arroz e feijão" onChange={(e) => setNome(e.target.value)} /></label>
      <label>Descrição (opcional)<input value={descricao} placeholder="ex.: o almoço de sempre, rende 3 marmitas" onChange={(e) => setDescricao(e.target.value)} /></label>
      <div className="foto-editor">
        {fotoMostrada ? <img src={fotoMostrada} alt="Foto da receita" /> : <div className="sem-foto" aria-hidden>♨</div>}
        <div className="linha">
          <label className="botao-arquivo">
            📷 {fotoMostrada ? 'Trocar foto' : 'Tirar ou escolher foto'}
            <input type="file" accept="image/*" aria-label="Foto da receita" onChange={(e) => escolherFoto(e.target.files?.[0])} />
          </label>
          {fotoMostrada && <button className="link" onClick={() => { setNovaFoto(null); setPrevia(null); setSemFoto(true) }}>Tirar foto</button>}
        </div>
      </div>
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

      <div className="linha">
        <label>
          Peso da receita pronta
          <span className="com-unidade">
            <input inputMode="decimal" value={rendimento} placeholder={soma ? String(soma) : ''} onChange={(e) => setRendimento(e.target.value)} />
            g
          </span>
        </label>
        <label>
          Porção (opcional)
          <span className="com-unidade">
            <input inputMode="decimal" value={porcao} placeholder="por pessoa" onChange={(e) => setPorcao(e.target.value)} />
            g
          </span>
        </label>
      </div>
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
