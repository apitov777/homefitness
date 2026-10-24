import { useEffect, useMemo, useState } from 'react'
import type { Contexto } from '../App'
import { carregarComposicao, carregarMetasVigentes, erroTexto, fmt, nomeTipo, semAcento, type Composicao, type Meta, type Pessoa } from '../dados'
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

function Detalhe({ r, pessoa, meta, comp, favorita, nutrientes, recs, onFavoritar, onRegistrar, onEditar, onAdaptar, onVoltar }: {
  r: Receita
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

  return (
    <>
      <button className="link voltar" onClick={onVoltar}>‹ Receitas</button>
      <div className="receita-topo">
        <h1>{r.nome}</h1>
        <Coracao ativa={favorita} nome={r.nome} onClick={onFavoritar} />
      </div>
      {r.descricao && <p>{r.descricao}</p>}
      <p className="etiquetas">
        {r.tipos.map((t) => <span key={t} className="selo">{nomeTipo(t)}</span>)}
        {r.tags.map((t) => <span key={t} className="selo neutro">{t}</span>)}
        {r.familia_id ? <span className="selo neutro">da família</span> : <span className="selo neutro">catálogo</span>}
      </p>

      <section className="cartao">
        <h2>Por porção de {formatarPeso(porcao)}</h2>
        <div className="numeros">
          <span><small>Energia</small><strong>{fmt(naPorcao('energia'))}</strong>kcal</span>
          <span><small>Proteína</small><strong>{fmt(naPorcao('proteina'))}</strong>g</span>
          <span><small>Carboidrato</small><strong>{fmt(naPorcao('carboidrato'))}</strong>g</span>
          <span><small>Gordura</small><strong>{fmt(naPorcao('gordura'))}</strong>g</span>
        </div>
        <p className="dica">
          {fmt(comp.energia)} kcal por 100 g
          {!avulso && <> · a receita inteira rende {formatarPeso(r.rendimento_g)}{porcoes > 1.05 ? ` (≈ ${fmt(porcoes, 1)} porções)` : ''}</>}
        </p>
      </section>

      <section className="cartao">
        <h2>{avulso ? 'Alimento' : 'Ingredientes'}</h2>
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
        {r.modo_preparo && (
          <>
            <h2>Modo de preparo</h2>
            <p className="preparo">{r.modo_preparo}</p>
          </>
        )}
      </section>

      <section className="cartao">
        <h2>Nutrientes por porção</h2>
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
      </section>

      <button className="primario" onClick={onFavoritar}>{favorita ? '♥ Nas favoritas (tirar)' : '♡ Favoritar para o plano'}</button>
      <div className="linha">
        <button onClick={() => onRegistrar({ alimento: { id: r.alimento_id, nome: r.nome }, gramas: porcao })}>
          Registrar agora
        </button>
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
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [termo, setTermo] = useState('')
  const [aberta, setAberta] = useState<string | null>(null)
  const [editando, setEditando] = useState<{ original: Receita | null; base?: Receita } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const pessoa = ctx.pessoas.find((p) => p.id === sel)
  const ids = useMemo(() => ctx.pessoas.map((p) => p.id), [ctx.pessoas])

  useEffect(() => {
    ;(async () => {
      try {
        const [rs, fs, ns, rc, ms] = await Promise.all([
          carregarReceitas(), carregarFavoritas(ids), carregarNutrientes(), carregarRecomendacoes(), carregarMetasVigentes(ids),
        ])
        const ativas = rs.filter((r) => r.ativa)
        setComp(await carregarComposicao([...new Set(ativas.map((r) => r.alimento_id))]))
        setReceitas(ativas)
        setFavs(fs)
        setNutrientes(ns)
        setRecs(rc)
        setMetas(ms)
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
          pessoa={pessoa}
          meta={pessoa ? metas[pessoa.id] : undefined}
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
      {ctx.pessoas.length > 1 && (
        <div className="chips">
          {ctx.pessoas.map((x) => (
            <button key={x.id} className={x.id === sel ? 'ativa' : ''} onClick={() => setSel(x.id)}>{x.nome}</button>
          ))}
        </div>
      )}
      <p className="dica">
        Toque no ♡ das que {pessoa?.nome ?? 'você'} gosta: as favoritas são as que entram na Semana do plano.
        {nFav > 0 ? ` ${nFav} ${nFav === 1 ? 'favorita' : 'favoritas'}.` : ''}
      </p>
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
        const fav = !!sel && ehFavorita(favs, sel, x.id)
        return (
          <div key={x.id} className={'cartao receita-item' + (fav ? ' favorita' : '')}>
            <button className="abrir" onClick={() => setAberta(x.id)}>
              <span className="refeicao-topo">
                <strong>{x.nome}</strong>
                <span className="kcal">{fmt(((c.energia ?? 0) * porcao) / 100)} kcal</span>
              </span>
              <small>
                {formatarPeso(porcao)} · proteína {fmt(((c.proteina ?? 0) * porcao) / 100)} g · carboidrato {fmt(((c.carboidrato ?? 0) * porcao) / 100)} g ·
                gordura {fmt(((c.gordura ?? 0) * porcao) / 100)} g
              </small>
              <small>{x.familia_id ? 'da família · ' : ''}{x.tags.filter((t) => t !== 'avulso').join(' · ')}</small>
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
