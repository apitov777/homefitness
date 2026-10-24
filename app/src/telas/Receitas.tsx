import { useEffect, useMemo, useState } from 'react'
import type { Contexto } from '../App'
import { carregarComposicao, carregarMetasVigentes, erroTexto, fmt, nomeTipo, semAcento, type Composicao, type Meta, type Pessoa } from '../dados'
import { carregarCreditos, creditoDe, fotoEstatica, urlsDasFotos, type Credito } from '../fotos'
import { carregarNutrientes, carregarRecomendacoes, casasPara, recomendada, type Nutriente, type Recomendacao } from '../nutrientes'
import {
  carregarFavoritas, carregarReceitas, ehFavorita, favoritar, formatarPeso, porcaoDe, type Favorita, type Receita,
} from '../semana'
import EditorReceita from './EditorReceita'
import type { ItemInicial } from './Registrar'

type Filtro = 'todas' | 'favoritas' | 'cafe' | 'principal' | 'lanche' | 'doce' | 'avulso' | 'familia'

const FILTROS: { id: Filtro; nome: string }[] = [
  { id: 'todas', nome: 'Todas' },
  { id: 'favoritas', nome: '♥ Favoritas' },
  { id: 'familia', nome: 'Da família' },
  { id: 'cafe', nome: 'Café da manhã' },
  { id: 'principal', nome: 'Almoço e jantar' },
  { id: 'lanche', nome: 'Lanches' },
  { id: 'doce', nome: 'Doces' },
  { id: 'avulso', nome: 'Avulsos' },
]

const LANCHES = ['lanche_manha', 'lanche_tarde', 'ceia', 'pre_treino', 'pos_treino']

function passaFiltro(r: Receita, f: Filtro, favs: Favorita[], pessoaId: string | undefined): boolean {
  switch (f) {
    case 'favoritas': return !!pessoaId && ehFavorita(favs, pessoaId, r.id)
    case 'familia': return !!r.familia_id
    case 'cafe': return r.tipos.includes('cafe')
    case 'principal': return r.tipos.includes('almoco') || r.tipos.includes('jantar')
    case 'lanche': return r.tipos.some((t) => LANCHES.includes(t)) && !r.tags.includes('avulso')
    case 'doce': return r.tags.includes('doce')
    case 'avulso': return r.tags.includes('avulso')
    default: return true
  }
}

/** Nutrientes que valem mostrar: fora os que a TACO não traz (viriam zerados). */
const GRUPOS: { grupo: Nutriente['grupo']; nome: string }[] = [
  { grupo: 'macro', nome: 'Macronutrientes' },
  { grupo: 'mineral', nome: 'Minerais' },
  { grupo: 'vitamina', nome: 'Vitaminas' },
]

/** Cores das barras e do anel: proteína, carboidrato e gordura. */
const CORES = { p: '#3b82f6', c: '#f59e0b', g: '#a855f7' }

function Coracao({ ativa, nome, onClick }: { ativa: boolean; nome: string; onClick: () => void }) {
  return (
    <button
      className={'coracao' + (ativa ? ' ativa' : '')}
      aria-label={ativa ? `Tirar ${nome} das favoritas` : `Favoritar ${nome}`}
      aria-pressed={ativa}
      onClick={(e) => { e.stopPropagation(); onClick() }}
    >
      {ativa ? '♥' : '♡'}
    </button>
  )
}

function Foto({ src, className }: { src: string | null; className: string }) {
  return src ? <img className={className} src={src} alt="" loading="lazy" /> : <div className={className + ' sem-foto'} aria-hidden>♨</div>
}

/** Barra de um macro: o tamanho é a fração da meta do dia da pessoa (ou de 100 g sem meta). */
function Barra({ rotulo, cor, valor, alvo }: { rotulo: string; cor: 'p' | 'c' | 'g'; valor: number; alvo: number | null | undefined }) {
  const pct = Math.min(100, (valor / (alvo || 100)) * 100)
  return (
    <span className={'barra-macro ' + cor}>
      {rotulo}
      <i><b style={{ width: `${pct}%`, background: CORES[cor] }} /></i>
      <span>{fmt(valor)} g</span>
    </span>
  )
}

/** Alvo do dia: a meta da pessoa para energia e macros; RDA/AI (por sexo e idade) para o resto. */
function alvoDoDia(codigo: string, pessoa: Pessoa | undefined, meta: Meta | undefined, recs: Recomendacao[]): number | null {
  const daMeta: Record<string, number | null | undefined> = {
    energia: meta?.kcal, proteina: meta?.proteina_g, carboidrato: meta?.carboidrato_g, gordura: meta?.gordura_g, fibra: meta?.fibra_g,
  }
  if (codigo in daMeta) {
    if (daMeta[codigo]) return Number(daMeta[codigo])
    if (codigo !== 'fibra') return null
  }
  return pessoa ? recomendada(recs, pessoa, codigo) : null
}

function Detalhe({ r, foto, credito, pessoa, meta, comp, favorita, nutrientes, recs, onFavoritar, onRegistrar, onEditar, onAdaptar, onVoltar }: {
  r: Receita
  foto: string | null
  credito: Credito | null
  pessoa: Pessoa | undefined
  meta: Meta | undefined
  comp: Composicao
  favorita: boolean
  nutrientes: Nutriente[]
  recs: Recomendacao[]
  onFavoritar: () => void
  onRegistrar: (item: ItemInicial) => void
  onEditar: () => void
  onAdaptar: () => void
  onVoltar: () => void
}) {
  const porcao = porcaoDe(r)
  const naPorcao = (codigo: string) => ((comp[codigo] ?? 0) * porcao) / 100
  const porcoes = r.rendimento_g / porcao
  const avulso = !r.item_receita.length
  const [tudo, setTudo] = useState(false)
  const linhas = nutrientes.filter((n) => n.grupo !== 'outro' && comp[n.codigo] != null && (tudo || naPorcao(n.codigo) > 0))
  const macros = [
    { codigo: 'proteina', nome: 'Proteína', cor: 'p' as const, kcalPorG: 4 },
    { codigo: 'carboidrato', nome: 'Carboidrato', cor: 'c' as const, kcalPorG: 4 },
    { codigo: 'gordura', nome: 'Gordura', cor: 'g' as const, kcalPorG: 9 },
  ].map((m) => ({ ...m, g: naPorcao(m.codigo), alvo: alvoDoDia(m.codigo, pessoa, meta, recs) }))
  const kcalMacros = macros.reduce((s, m) => s + m.g * m.kcalPorG, 0)
  // Anel: a fatia de cada macro nas calorias (proteína e carboidrato 4 kcal/g, gordura 9 kcal/g).
  let acumulado = 0
  const fatias = macros.map((m) => {
    const de = acumulado
    acumulado += kcalMacros ? (m.g * m.kcalPorG / kcalMacros) * 100 : 0
    return `${CORES[m.cor]} ${de.toFixed(1)}% ${acumulado.toFixed(1)}%`
  })
  const anel = kcalMacros ? `conic-gradient(${fatias.join(', ')})` : 'conic-gradient(var(--linha) 0 100%)'
  const alvoEnergia = alvoDoDia('energia', pessoa, meta, recs)
  const destaque = (codigo: string) => {
    const n = nutrientes.find((x) => x.codigo === codigo)
    const alvo = alvoDoDia(codigo, pessoa, meta, recs)
    return n && alvo ? `${n.nome.toLowerCase()} ${fmt((naPorcao(codigo) / alvo) * 100)}%` : null
  }
  const resumoNutrientes = ['ferro', 'calcio', 'vit_c'].map(destaque).filter(Boolean).join(' · ')
  const passos = r.modo_preparo ? r.modo_preparo.split(/(?<=\.)\s+(?=[A-ZÀ-Ú])/).filter(Boolean) : []

  return (
    <>
      <div className="hero">
        <Foto src={foto} className="hero-foto" />
        <button className="voltar-flutuante" onClick={onVoltar}>‹ Receitas</button>
        <Coracao ativa={favorita} nome={r.nome} onClick={onFavoritar} />
      </div>
      <h1>{r.nome}</h1>
      <p className="dica">
        {r.descricao ? `${r.descricao} ` : ''}
        Porção de {formatarPeso(porcao)} · {fmt(comp.energia)} kcal por 100 g
        {!avulso && porcoes > 1.05 ? ` · a receita rende ${formatarPeso(r.rendimento_g)} (≈ ${fmt(porcoes, 1)} porções)` : ''}
      </p>
      <p className="etiquetas">
        {r.tipos.map((t) => <span key={t} className="selo">{nomeTipo(t)}</span>)}
        {r.tags.map((t) => <span key={t} className="selo neutro">{t}</span>)}
        <span className="selo neutro">{r.familia_id ? 'da família' : 'catálogo'}</span>
      </p>

      <section className="cartao anel-cartao">
        <div className="anel" style={{ background: anel }} role="img" aria-label={`${fmt(naPorcao('energia'))} kcal na porção`}>
          <div><b>{fmt(naPorcao('energia'))}</b>kcal{alvoEnergia ? <small>{fmt((naPorcao('energia') / alvoEnergia) * 100)}% do dia</small> : null}</div>
        </div>
        <div className="legenda">
          {macros.map((m) => (
            <div key={m.codigo}>
              <i style={{ background: CORES[m.cor] }} />
              {m.nome} <strong>{fmt(m.g, m.g < 10 ? 1 : 0)} g</strong>
              {m.alvo ? <span className="dica"> · {fmt((m.g / m.alvo) * 100)}% do dia{pessoa ? ` de ${pessoa.nome}` : ''}</span> : null}
            </div>
          ))}
        </div>
      </section>

      <details className="acordeao" open>
        <summary>{avulso ? 'Alimento' : 'Ingredientes'}{!avulso && <small>{r.item_receita.length} · {formatarPeso(r.rendimento_g)}</small>}</summary>
        <div className="corpo">
          {avulso ? (
            <p>Direto da tabela TACO: {r.nome.split(',')[0]} · {formatarPeso(porcao)}.</p>
          ) : (
            <ul className="ingredientes">
              {r.item_receita.map((i) => (
                <li key={i.id}>
                  <span>{i.alimento.nome}</span>
                  <span>{formatarPeso(i.quantidade_g)}{porcoes > 1.05 ? <small> · {formatarPeso(i.quantidade_g / porcoes)} por porção</small> : null}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      {r.modo_preparo && (
        <details className="acordeao" open>
          <summary>Modo de preparo<small>{passos.length} {passos.length === 1 ? 'passo' : 'passos'}</small></summary>
          <div className="corpo">
            <ol className="passos">{passos.map((p, i) => <li key={i}>{p}</li>)}</ol>
          </div>
        </details>
      )}

      <details className="acordeao">
        <summary>Nutrientes e vitaminas{resumoNutrientes && <small>{resumoNutrientes}</small>}</summary>
        <div className="corpo">
          {GRUPOS.map((g) => {
            const ls = linhas.filter((n) => n.grupo === g.grupo)
            if (!ls.length) return null
            return (
              <table key={g.grupo} className="tabela">
                <thead><tr><th>{g.nome}</th><th>Porção</th><th>% do dia{pessoa ? ` de ${pessoa.nome}` : ''}</th></tr></thead>
                <tbody>
                  {ls.map((n) => {
                    const v = naPorcao(n.codigo)
                    const alvo = alvoDoDia(n.codigo, pessoa, meta, recs)
                    return (
                      <tr key={n.codigo}>
                        <td>{n.nome}</td>
                        <td>{fmt(v, casasPara(v))} {n.unidade}</td>
                        <td>{alvo ? `${fmt((v / alvo) * 100)}%` : '–'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          })}
          <button className="link" onClick={() => setTudo(!tudo)}>{tudo ? 'Esconder os zerados' : 'Mostrar todos os nutrientes'}</button>
          <p className="dica">
            Valores calculados a partir dos ingredientes na TACO; vitaminas que a TACO não mede aparecem zeradas.
            {pessoa && <> O % do dia usa a meta de {pessoa.nome} para energia e macros e a recomendação diária (RDA) para o resto.</>}
          </p>
        </div>
      </details>

      {credito && (
        <p className="credito">
          Foto: {credito.autor} · {credito.licenca} · <a href={credito.pagina} target="_blank" rel="noreferrer">Wikimedia Commons</a>
        </p>
      )}
      <button className="primario" onClick={() => onRegistrar({ alimento: { id: r.alimento_id, nome: r.nome }, gramas: porcao })}>
        Registrar agora · {formatarPeso(porcao)}
      </button>
      <div className="linha">
        <button onClick={onFavoritar}>{favorita ? '♥ Tirar das favoritas' : '♡ Favoritar para o plano'}</button>
        {r.familia_id ? <button onClick={onEditar}>Editar</button> : !avulso && <button onClick={onAdaptar}>Adaptar à minha</button>}
      </div>
    </>
  )
}

export default function Receitas({ ctx, onRegistrar }: { ctx: Contexto; onRegistrar: (inicial?: ItemInicial) => void }) {
  const [sel, setSel] = useState(ctx.eu?.id ?? ctx.pessoas[0]?.id)
  const [receitas, setReceitas] = useState<Receita[] | null>(null)
  const [favs, setFavs] = useState<Favorita[]>([])
  const [comp, setComp] = useState<Map<string, Composicao>>(new Map())
  const [nutrientes, setNutrientes] = useState<Nutriente[]>([])
  const [recs, setRecs] = useState<Recomendacao[]>([])
  const [metas, setMetas] = useState<Record<string, Meta>>({})
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [creditos, setCreditos] = useState<Record<string, Credito>>({})
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [termo, setTermo] = useState('')
  const [aberta, setAberta] = useState<string | null>(null)
  const [editando, setEditando] = useState<{ original: Receita | null; base?: Receita } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const pessoa = ctx.pessoas.find((p) => p.id === sel)
  const meta = pessoa ? metas[pessoa.id] : undefined
  const ids = useMemo(() => ctx.pessoas.map((p) => p.id), [ctx.pessoas])
  const fotoDe = (r: Receita) => fotoEstatica(r.foto) ?? (r.foto ? urls.get(r.foto) ?? null : null)

  useEffect(() => {
    ;(async () => {
      try {
        const [rs, fs, ns, rc, ms, cr] = await Promise.all([
          carregarReceitas(), carregarFavoritas(ids), carregarNutrientes(), carregarRecomendacoes(), carregarMetasVigentes(ids), carregarCreditos(),
        ])
        const ativas = rs.filter((r) => r.ativa)
        const [c, u] = await Promise.all([carregarComposicao([...new Set(ativas.map((r) => r.alimento_id))]), urlsDasFotos(ativas.map((r) => r.foto))])
        setComp(c)
        setUrls(u)
        setReceitas(ativas)
        setFavs(fs)
        setNutrientes(ns)
        setRecs(rc)
        setMetas(ms)
        setCreditos(cr)
        setErro(null)
      } catch (e) {
        setErro(erroTexto(e))
      }
    })()
  }, [ids, tick])

  async function alternarFavorita(r: Receita) {
    if (!sel) return
    const sim = !ehFavorita(favs, sel, r.id)
    setFavs((fs) => (sim ? [...fs, { pessoa_id: sel, receita_id: r.id }] : fs.filter((f) => !(f.pessoa_id === sel && f.receita_id === r.id))))
    try {
      await favoritar(sel, r.id, sim)
    } catch (e) {
      setErro(erroTexto(e))
      setTick((t) => t + 1)
    }
  }

  const lista = useMemo(() => {
    const t = semAcento(termo.trim())
    return (receitas ?? [])
      .filter((r) => passaFiltro(r, filtro, favs, sel))
      .filter((r) => !t || semAcento(r.nome).includes(t) || semAcento(r.descricao ?? '').includes(t) || r.item_receita.some((i) => semAcento(i.alimento.nome).includes(t)))
  }, [receitas, filtro, favs, sel, termo])

  if (editando)
    return (
      <div className="tela">
        <EditorReceita
          original={editando.original}
          base={editando.base}
          familiaId={ctx.familiaId}
          fotoAtual={editando.original ? fotoDe(editando.original) : editando.base ? fotoDe(editando.base) : null}
          onFim={(salvou) => { setEditando(null); if (salvou) { setAberta(null); setTick((t) => t + 1) } }}
        />
      </div>
    )

  const r = receitas?.find((x) => x.id === aberta)
  if (r)
    return (
      <div className="tela">
        <Detalhe
          r={r}
          foto={fotoDe(r)}
          credito={creditoDe(r.foto, creditos)}
          pessoa={pessoa}
          meta={meta}
          comp={comp.get(r.alimento_id) ?? {}}
          favorita={!!sel && ehFavorita(favs, sel, r.id)}
          nutrientes={nutrientes}
          recs={recs}
          onFavoritar={() => alternarFavorita(r)}
          onRegistrar={(item) => onRegistrar(item)}
          onEditar={() => setEditando({ original: r })}
          onAdaptar={() => setEditando({ original: null, base: r })}
          onVoltar={() => setAberta(null)}
        />
      </div>
    )

  const nFav = sel ? favs.filter((f) => f.pessoa_id === sel).length : 0
  return (
    <div className="tela">
      <div className="instalar-topo">
        <h1>Receitas</h1>
        <button className="link" onClick={() => onRegistrar()}>Registrar à mão</button>
      </div>
      <p className="dica">
        {nFav} {nFav === 1 ? 'favorita' : 'favoritas'} de {pessoa?.nome ?? 'você'} · {receitas?.length ?? '…'} receitas.
        Toque no ♡: as favoritas entram na Semana do plano.
      </p>
      {ctx.pessoas.length > 1 && (
        <div className="chips">
          {ctx.pessoas.map((x) => (
            <button key={x.id} className={x.id === sel ? 'ativa' : ''} onClick={() => setSel(x.id)}>{x.nome}</button>
          ))}
        </div>
      )}
      <input className="busca" type="search" placeholder="Buscar receita ou ingrediente" value={termo} onChange={(e) => setTermo(e.target.value)} />
      <div className="chips">
        {FILTROS.map((f) => (
          <button key={f.id} className={filtro === f.id ? 'ativa' : ''} onClick={() => setFiltro(f.id)}>{f.nome}</button>
        ))}
      </div>
      {erro && <p className="erro">{erro}</p>}
      {receitas === null && !erro && <p className="dica">Carregando…</p>}
      {lista.map((x) => {
        const c = comp.get(x.alimento_id) ?? {}
        const porcao = porcaoDe(x)
        const na = (k: string) => ((c[k] ?? 0) * porcao) / 100
        const fav = !!sel && ehFavorita(favs, sel, x.id)
        return (
          <div key={x.id} className={'cartao receita-item' + (fav ? ' favorita' : '')}>
            <button className="abrir" onClick={() => setAberta(x.id)}>
              <Foto src={fotoDe(x)} className="miniatura" />
              <span className="texto">
                <strong>{x.nome}</strong>
                <span className="kcal-linha"><b>{fmt(na('energia'))}</b> kcal · {formatarPeso(porcao)}{x.familia_id ? ' · da família' : ''}</span>
                <span className="barras">
                  <Barra rotulo="P" cor="p" valor={na('proteina')} alvo={meta?.proteina_g} />
                  <Barra rotulo="C" cor="c" valor={na('carboidrato')} alvo={meta?.carboidrato_g} />
                  <Barra rotulo="G" cor="g" valor={na('gordura')} alvo={meta?.gordura_g} />
                </span>
              </span>
            </button>
            <Coracao ativa={fav} nome={x.nome} onClick={() => alternarFavorita(x)} />
          </div>
        )
      })}
      {receitas && !lista.length && (
        <p className="dica">{filtro === 'favoritas' ? 'Nenhuma favorita ainda. Toque no ♡ das receitas que gosta.' : 'Nada encontrado.'}</p>
      )}
      <button className="primario" onClick={() => setEditando({ original: null })}>＋ Minha receita</button>
    </div>
  )
}
