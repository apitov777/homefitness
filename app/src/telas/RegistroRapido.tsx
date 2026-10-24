import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import {
  buscarAlimentos, carregarAlimentos, carregarComposicao, erroTexto, fmt, hojeISO, lerNumero, nomeTipo, somarItens, TIPOS_REFEICAO,
  type AlimentoResumo, type Checagem, type Composicao, type Dieta, type ItemGramas, type Pessoa, type PlanoRefeicao, type TipoRefeicao,
} from '../dados'
import { opcoesDe } from '../dietas'
import { A_MAIS, tipoPelaHora } from '../hoje'
import { porcaoDe, type Receita } from '../semana'
import FavoritasSemana from './FavoritasSemana'
import Medidas from './Medidas'

interface Escolhido { chave: number; alimento: { id: string; nome: string }; gramas: string }

/**
 * Escolher o que comeu, rápido: as favoritas da semana entram com um toque na porção, qualquer outro alimento
 * pela busca (100 g); as gramas de cada item ajustam-se ali mesmo.
 */
export function EscolherComida({ pessoa, tipo, acao, ocupado, onConfirmar, onCancelar }: {
  pessoa: Pessoa
  tipo: TipoRefeicao
  /** Texto do botão que confirma (ex.: "Registrar no lugar"). */
  acao: string
  ocupado: boolean
  onConfirmar: (itens: ItemGramas[]) => void
  onCancelar: () => void
}) {
  const [itens, setItens] = useState<Escolhido[]>([])
  const [termo, setTermo] = useState('')
  const [alimentos, setAlimentos] = useState<AlimentoResumo[]>([])
  const [comp, setComp] = useState<Map<string, Composicao>>(new Map())
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    carregarAlimentos().then(setAlimentos).catch((e) => setErro(erroTexto(e)))
  }, [])

  const resultados = useMemo(() => buscarAlimentos(alimentos, termo), [alimentos, termo])

  async function incluir(alimento: { id: string; nome: string }, gramas: number) {
    setTermo('')
    setItens((xs) => [...xs, { chave: Date.now() + xs.length, alimento, gramas: String(gramas) }])
    try {
      setComp(await carregarComposicao([...itens.map((i) => i.alimento.id), alimento.id]))
    } catch (e) {
      setErro(erroTexto(e))
    }
  }
  const daReceita = (r: Receita) => incluir({ id: r.alimento_id, nome: r.nome }, porcaoDe(r))
  const kcalDe = (it: Escolhido) => ((comp.get(it.alimento.id)?.energia ?? 0) * lerNumero(it.gramas)) / 100
  const total = itens.reduce((s, it) => s + kcalDe(it), 0)
  const validos = () => itens.map((it) => ({ alimento_id: it.alimento.id, quantidade_g: lerNumero(it.gramas) })).filter((x) => x.quantidade_g > 0)

  return (
    <div className="escolher">
      <FavoritasSemana pessoas={[pessoa]} tipo={tipo} onEscolher={daReceita} />
      <input
        className="busca"
        type="search"
        aria-label="Buscar alimento"
        placeholder="Buscar outro alimento: pão, banana, pizza…"
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
      />
      {termo && (
        <ul className="resultados">
          {resultados.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => incluir(a, a.medidas_caseiras?.[0]?.g ?? 100)}>
                {a.nome}
                <small>{a.familia_id ? `${a.fonte} · da família` : a.categoria}{a.medidas_caseiras?.[0] ? ` · ${a.medidas_caseiras[0].nome.toLowerCase()} = ${fmt(a.medidas_caseiras[0].g)} g` : ''}</small>
              </button>
            </li>
          ))}
          {!resultados.length && <li className="dica">Nada encontrado. Cadastre pelo rótulo em Perfil › Alimentos.</li>}
        </ul>
      )}
      {itens.map((it) => (
        <div key={it.chave}>
        <label className="item-plano">
          <span className="nome">{it.alimento.nome}</span>
          <span className="com-unidade">
            <input inputMode="decimal" aria-label={`Gramas de ${it.alimento.nome}`} value={it.gramas}
              onChange={(e) => setItens((xs) => xs.map((x) => (x.chave === it.chave ? { ...x, gramas: e.target.value } : x)))} />
            g
          </span>
          <small>{fmt(kcalDe(it))} kcal</small>
          <button type="button" className="apagar" aria-label={`Tirar ${it.alimento.nome}`} onClick={() => setItens((xs) => xs.filter((x) => x.chave !== it.chave))}>×</button>
        </label>
        <Medidas
          medidas={alimentos.find((a) => a.id === it.alimento.id)?.medidas_caseiras}
          gramas={lerNumero(it.gramas)}
          onEscolher={(g) => setItens((xs) => xs.map((x) => (x.chave === it.chave ? { ...x, gramas: String(g) } : x)))}
        />
        </div>
      ))}
      {itens.length > 0 && <p className="total"><span>Total</span><strong>{fmt(total)} kcal</strong></p>}
      {!itens.length && <p className="dica">Toque numa favorita ou busque o alimento.</p>}
      {erro && <p className="erro">{erro}</p>}
      <div className="linha">
        <button type="button" onClick={onCancelar}>Cancelar</button>
        <button type="button" className="primario" disabled={ocupado || !validos().length} onClick={() => onConfirmar(validos())}>{acao}</button>
      </div>
    </div>
  )
}

/**
 * Registro rápido do dia de uma pessoa: cada refeição do plano (da dieta do dia) com as opções A/B/C para marcar
 * "Fiz", "Comi outra coisa" (registra o que comeu no lugar) ou "Não fiz"; e "Comi algo a mais" para o que entrou
 * fora do plano.
 */
export default function RegistroRapido({ pessoa, familiaId, planos, checagens, kcalRegistrada, comp, data, dieta, onMudou }: {
  pessoa: Pessoa
  familiaId: string
  /** Refeições do plano desta pessoa que valem neste dia. */
  planos: PlanoRefeicao[]
  checagens: Checagem[]
  /** kcal de cada refeição registrada no dia (por id), para mostrar o que comeu de fato quando já marcou. */
  kcalRegistrada: Map<string, number>
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
  const [trocando, setTrocando] = useState<string | null>(null)
  const [extra, setExtra] = useState(false)
  const [extraTipo, setExtraTipo] = useState<TipoRefeicao>(tipoPelaHora(new Date().getHours()))
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const agora = new Date().toTimeString().slice(0, 5)
  const ehHoje = data === hojeISO()

  async function marcar(p: PlanoRefeicao, status: 'feita' | 'pulada' | 'trocada', itens?: ItemGramas[], opcao: string | null = null) {
    setOcupado(p.id)
    setErro(null)
    const { error } = await supabase.rpc('marcar_plano', { p_plano: p.id, p_data: data, p_status: status, p_itens: itens ?? null, p_opcao: opcao })
    setOcupado(null)
    if (error) return setErro(erroTexto(error))
    setAjustando(null)
    setTrocando(null)
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
    setTrocando(null)
    setAjustando(p.id)
    setGramas(Object.fromEntries(opcaoDe(p).itens.map((i) => [i.id, String(i.quantidade_g)])))
  }

  async function registrarExtra(itens: ItemGramas[]) {
    setOcupado('extra')
    setErro(null)
    const { error } = await supabase.rpc('registrar_refeicao', {
      p_familia: familiaId, p_data: data, p_tipo: extraTipo, p_hora: ehHoje ? agora : null, p_descricao: A_MAIS,
      p_porcoes: [{ pessoa_id: pessoa.id, itens }],
    })
    setOcupado(null)
    if (error) return setErro(erroTexto(error))
    setExtra(false)
    onMudou()
  }

  return (
    <>
      {planos.length > 0 && (
        <div className="checklist">
          <h3>Plano do dia</h3>
          <p className="dica dieta-hoje">
            {dieta ? <>Dieta: <strong>{dieta.nome}</strong>{dieta.kcal_alvo != null && <> · alvo {fmt(dieta.kcal_alvo)} kcal</>} · </> : null}
            Toque na opção que comeu e em Fiz; comeu outra coisa no lugar, registre ali mesmo.
          </p>
          <ul>
            {planos.map((p) => {
              const c = checagens.find((x) => x.plano_refeicao_id === p.id)
              const ops = opcoesDe(p)
              const op = opcaoDe(p)
              const kcalPlano = somarItens(op.itens, comp).energia ?? 0
              // Depois de marcada, vale o que comeu de fato (gramas ajustadas ou outra coisa no lugar).
              const kcal = c?.refeicao_id != null && kcalRegistrada.has(c.refeicao_id) ? (kcalRegistrada.get(c.refeicao_id) as number) : kcalPlano
              const atrasada = !c && ehHoje && p.hora.slice(0, 5) < agora
              const comida = c?.status === 'feita' ? ops.find((o) => o.id === (c.opcao_id ?? null)) : undefined
              const nome = p.nome ?? nomeTipo(p.tipo)
              return (
                <li key={p.id} className={c ? c.status : atrasada ? 'atrasada' : ''}>
                  <div className="refeicao-topo">
                    <span className="hora">{p.hora.slice(0, 5)}</span>
                    <strong>{nome}</strong>
                    {atrasada && <span className="selo alto">atrasada</span>}
                    <span className="kcal">{fmt(kcal)} kcal{p.kcal_alvo != null ? ` · alvo ${fmt(p.kcal_alvo)}` : ''}</span>
                  </div>
                  {!c && ops.length > 1 && (
                    <div className="chips opcoes" role="group" aria-label={`Opções de ${nome}`}>
                      {ops.map((o) => (
                        <button key={o.letra} type="button" className={o === op ? 'ativa' : ''} aria-pressed={o === op}
                          onClick={() => setOpcaoSel((xs) => ({ ...xs, [p.id]: o.id }))}>
                          {o.letra} · {fmt(somarItens(o.itens, comp).energia ?? 0)} kcal
                        </button>
                      ))}
                    </div>
                  )}
                  {!c && ajustando !== p.id && (
                    <ul className="itens">
                      {op.itens.map((i) => <li key={i.id}>{i.alimento.nome} · {fmt(i.quantidade_g)} g</li>)}
                      {trocando !== p.id && (
                        <li><button type="button" className="link" disabled={ocupado === p.id} onClick={() => abrirAjuste(p)}>Ajustar gramas</button></li>
                      )}
                    </ul>
                  )}
                  {c ? (
                    <div className="acoes">
                      <span>
                        {c.status === 'feita' ? `✓ Feita${comida && ops.length > 1 ? ` (opção ${comida.letra})` : ''}`
                          : c.status === 'trocada' ? '↷ Comeu outra coisa no lugar' : '✗ Não fez'}
                      </span>
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
                      <p className="dica">Coloque 0 no que não comeu.</p>
                      <div className="linha">
                        <button onClick={() => setAjustando(null)}>Cancelar</button>
                        <button
                          className="primario"
                          disabled={ocupado === p.id}
                          onClick={() => marcar(p, 'feita', op.itens.map((i) => ({
                            alimento_id: i.alimento.id,
                            quantidade_g: lerNumero(gramas[i.id] ?? '0'),
                          })), op.id)}
                        >
                          Confirmar
                        </button>
                      </div>
                    </div>
                  ) : trocando === p.id ? (
                    <EscolherComida
                      pessoa={pessoa}
                      tipo={p.tipo}
                      acao="Registrar no lugar"
                      ocupado={ocupado === p.id}
                      onConfirmar={(itens) => marcar(p, 'trocada', itens)}
                      onCancelar={() => setTrocando(null)}
                    />
                  ) : (
                    <div className="botoes-marcar">
                      <button className="fiz" disabled={ocupado === p.id} onClick={() => marcar(p, 'feita', undefined, op.id)}>{ops.length > 1 ? `Fiz a ${op.letra}` : 'Fiz'}</button>
                      <button disabled={ocupado === p.id} onClick={() => { setAjustando(null); setTrocando(p.id) }}>Comi outra coisa</button>
                      <button disabled={ocupado === p.id} onClick={() => marcar(p, 'pulada')}>Não fiz</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {extra ? (
        <div className="extra">
          <h3>Comi algo a mais</h3>
          <label>
            Em que refeição
            <select aria-label="Refeição do que comeu a mais" value={extraTipo} onChange={(e) => setExtraTipo(e.target.value as TipoRefeicao)}>
              {TIPOS_REFEICAO.map((t) => <option key={t.valor} value={t.valor}>{t.nome}</option>)}
            </select>
          </label>
          <EscolherComida
            pessoa={pessoa}
            tipo={extraTipo}
            acao="Registrar a mais"
            ocupado={ocupado === 'extra'}
            onConfirmar={registrarExtra}
            onCancelar={() => setExtra(false)}
          />
        </div>
      ) : (
        <button type="button" className="link" onClick={() => { setExtra(true); setTrocando(null) }}>＋ Comi algo a mais</button>
      )}
      {erro && <p className="erro">{erro}</p>}
    </>
  )
}
