import { useEffect, useState } from 'react'
import type { Contexto } from '../App'
import { supabase } from '../supabase'
import { erroTexto, fmt, hojeISO } from '../dados'

interface Marcador {
  id: number
  codigo: string
  nome: string
  unidade_padrao: string | null
  grupo: string | null
  janela_dias: number | null
  orientacao_coleta: string | null
}

interface Resultado {
  id: string
  valor: number
  unidade: string | null
  ref_min: number | null
  ref_max: number | null
  flag: 'baixo' | 'alto' | 'normal'
  marcador: Marcador
}

interface Exame {
  id: string
  data: string
  laboratorio: string | null
  jejum_horas: number | null
  resultado_exame: Resultado[]
}

interface Influencia {
  nutriente: string
  nome: string
  unidade: string
  dias_registrados: number
  efeito: 'aumenta' | 'reduz' | 'necessario'
  media_dia: number | null
  rda: number | null
  pct_rda: number | null
}

interface LinhaNova { marcadorId: string; valor: string; unidade: string; min: string; max: string }

const EFEITO: Record<Influencia['efeito'], string> = {
  aumenta: 'comer mais tende a subir',
  reduz: 'comer mais tende a baixar',
  necessario: 'precisa estar em dia',
}

const num = (s: string) => {
  const n = parseFloat(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function NovoExame({ pessoaId, marcadores, onSalvo }: { pessoaId: string; marcadores: Marcador[]; onSalvo: () => void }) {
  const [data, setData] = useState(hojeISO())
  const [lab, setLab] = useState('')
  const [jejum, setJejum] = useState('')
  const [linhas, setLinhas] = useState<LinhaNova[]>([{ marcadorId: '', valor: '', unidade: '', min: '', max: '' }])
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  function mudar(i: number, campo: keyof LinhaNova, v: string) {
    setLinhas((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l
        const nova = { ...l, [campo]: v }
        if (campo === 'marcadorId') nova.unidade = marcadores.find((m) => String(m.id) === v)?.unidade_padrao ?? ''
        return nova
      }),
    )
  }

  async function salvar() {
    setErro(null)
    const validas = linhas.filter((l) => l.marcadorId && num(l.valor) != null)
    if (!validas.length) return setErro('Informe pelo menos um resultado.')
    setSalvando(true)
    const { data: ex, error } = await supabase
      .from('exame')
      .insert({ pessoa_id: pessoaId, data, laboratorio: lab || null, jejum_horas: num(jejum) })
      .select('id')
      .single()
    if (error) {
      setSalvando(false)
      return setErro(erroTexto(error))
    }
    const { error: e2 } = await supabase.from('resultado_exame').insert(
      validas.map((l) => ({
        exame_id: ex.id,
        marcador_id: Number(l.marcadorId),
        valor: num(l.valor),
        unidade: l.unidade || null,
        ref_min: num(l.min),
        ref_max: num(l.max),
      })),
    )
    setSalvando(false)
    if (e2) return setErro(erroTexto(e2))
    onSalvo()
  }

  const grupos = [...new Set(marcadores.map((m) => m.grupo ?? 'outros'))]

  return (
    <section className="cartao">
      <h2>Novo exame</h2>
      <div className="linha">
        <label>Data da coleta<input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
        <label>Jejum (h)<input inputMode="decimal" value={jejum} onChange={(e) => setJejum(e.target.value)} /></label>
      </div>
      <label>Laboratório<input value={lab} onChange={(e) => setLab(e.target.value)} /></label>
      <p className="dica">Use a faixa de referência impressa no laudo: ela varia entre laboratórios.</p>
      {linhas.map((l, i) => {
        const m = marcadores.find((x) => String(x.id) === l.marcadorId)
        return (
          <div key={i} className="item">
            <label>
              Marcador
              <select value={l.marcadorId} onChange={(e) => mudar(i, 'marcadorId', e.target.value)}>
                <option value="">Escolha…</option>
                {grupos.map((g) => (
                  <optgroup key={g} label={g}>
                    {marcadores.filter((x) => (x.grupo ?? 'outros') === g).map((x) => (
                      <option key={x.id} value={x.id}>{x.nome}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {m?.orientacao_coleta && <p className="dica">Coleta: {m.orientacao_coleta}</p>}
            <div className="linha">
              <label>Valor<input inputMode="decimal" value={l.valor} onChange={(e) => mudar(i, 'valor', e.target.value)} /></label>
              <label>Unidade<input value={l.unidade} onChange={(e) => mudar(i, 'unidade', e.target.value)} /></label>
            </div>
            <div className="linha">
              <label>Ref. mín.<input inputMode="decimal" value={l.min} onChange={(e) => mudar(i, 'min', e.target.value)} /></label>
              <label>Ref. máx.<input inputMode="decimal" value={l.max} onChange={(e) => mudar(i, 'max', e.target.value)} /></label>
            </div>
          </div>
        )
      })}
      <button className="link" onClick={() => setLinhas([...linhas, { marcadorId: '', valor: '', unidade: '', min: '', max: '' }])}>
        ＋ outro resultado
      </button>
      {erro && <p className="erro">{erro}</p>}
      <button className="primario" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar exame'}</button>
    </section>
  )
}

export default function Exames({ ctx, onVoltar }: { ctx: Contexto; onVoltar?: () => void }) {
  const meuId = ctx.session.user.id
  const visiveis = ctx.pessoas.filter((p) => p.user_id === meuId || p.user_id === null || p.compartilha_exames)
  const [sel, setSel] = useState(ctx.eu?.id ?? visiveis[0]?.id)
  const [exames, setExames] = useState<Exame[]>([])
  const [marcadores, setMarcadores] = useState<Marcador[]>([])
  const [novo, setNovo] = useState(false)
  const [aberto, setAberto] = useState<string | null>(null)
  const [influencias, setInfluencias] = useState<Influencia[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    supabase.from('marcador').select('*').order('grupo').order('nome').then(({ data }) => setMarcadores((data ?? []) as Marcador[]))
  }, [])

  useEffect(() => {
    if (!sel) return
    supabase
      .from('exame')
      .select('id, data, laboratorio, jejum_horas, resultado_exame(id, valor, unidade, ref_min, ref_max, flag, marcador:marcador_id(*))')
      .eq('pessoa_id', sel)
      .order('data', { ascending: false })
      .then(({ data, error }) => {
        if (error) setErro(erroTexto(error))
        else setExames((data ?? []) as unknown as Exame[])
      })
  }, [sel, tick])

  async function abrir(r: Resultado) {
    if (aberto === r.id) return setAberto(null)
    setAberto(r.id)
    setInfluencias([])
    const { data, error } = await supabase.rpc('ingestao_antes_exame_detalhe', { p_resultado: r.id })
    if (error) setErro(erroTexto(error))
    else setInfluencias((data ?? []) as Influencia[])
  }

  async function apagar(ex: Exame) {
    if (!confirm(`Apagar o exame de ${new Date(ex.data + 'T12:00:00').toLocaleDateString('pt-BR')}?`)) return
    const { error } = await supabase.from('exame').delete().eq('id', ex.id)
    if (error) setErro(erroTexto(error))
    else setTick((t) => t + 1)
  }

  const ocultos = ctx.pessoas.filter((p) => !visiveis.includes(p))

  return (
    <div className="tela">
      {onVoltar && <button className="link voltar" onClick={onVoltar}>‹ Perfil</button>}
      <h1>Exames</h1>
      <div className="chips">
        {visiveis.map((p) => (
          <button key={p.id} className={p.id === sel ? 'ativa' : ''} onClick={() => { setSel(p.id); setNovo(false) }}>{p.nome}</button>
        ))}
      </div>
      {ocultos.length > 0 && (
        <p className="dica">{ocultos.map((p) => p.nome).join(', ')} não compartilha os exames. Cada um decide isso no próprio Perfil.</p>
      )}
      <p className="dica">Exame não é diagnóstico. Aqui você registra e vê o que na alimentação mexe em cada marcador; a conduta é do médico.</p>

      {sel && (novo ? (
        <NovoExame pessoaId={sel} marcadores={marcadores} onSalvo={() => { setNovo(false); setTick((t) => t + 1) }} />
      ) : (
        <button className="primario" onClick={() => setNovo(true)}>＋ Novo exame</button>
      ))}
      {erro && <p className="erro">{erro}</p>}

      {exames.map((ex) => (
        <section key={ex.id} className="cartao">
          <div className="refeicao-topo">
            <strong>{new Date(ex.data + 'T12:00:00').toLocaleDateString('pt-BR')}</strong>
            {ex.laboratorio && <span className="hora">{ex.laboratorio}</span>}
            <button className="apagar" onClick={() => apagar(ex)} aria-label="Apagar">×</button>
          </div>
          <ul className="resultados-exame">
            {ex.resultado_exame.map((r) => (
              <li key={r.id}>
                <button className={'resultado ' + r.flag} onClick={() => abrir(r)}>
                  <span>{r.marcador.nome}</span>
                  <span>
                    {fmt(r.valor, 2)} {r.unidade}{' '}
                    {r.flag !== 'normal' && <span className={'selo ' + r.flag}>{r.flag}</span>}
                  </span>
                </button>
                {(r.ref_min != null || r.ref_max != null) && (
                  <small className="ref">Referência do laudo: {r.ref_min ?? '–'} a {r.ref_max ?? '–'} {r.unidade}</small>
                )}
                {aberto === r.id && (
                  <div className="influencia">
                    <p>
                      Ingestão média nos {r.marcador.janela_dias ?? 30} dias antes da coleta (só o que foi registrado no app):
                    </p>
                    {influencias.length ? (
                      <table className="tabela">
                        <thead><tr><th>Nutriente</th><th>Efeito</th><th>Média/dia</th><th>% rec.</th></tr></thead>
                        <tbody>
                          {influencias.map((i) => (
                            <tr key={i.nutriente}>
                              <td>{i.nome}</td>
                              <td>{EFEITO[i.efeito]}</td>
                              <td>
                                {i.media_dia != null ? `${fmt(i.media_dia, 1)} ${i.unidade}` : 'sem dado'}
                                {i.dias_registrados > 0 && <small> ({i.dias_registrados} d)</small>}
                              </td>
                              <td>{i.pct_rda != null ? `${fmt(i.pct_rda)}%` : '–'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="dica">Sem vínculos com nutrientes para este marcador.</p>
                    )}
                    <p className="dica">“Sem dado” aparece quando a TACO não mede o nutriente (vitamina D, B12, selênio) ou não há refeições no período.</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!exames.length && <p className="dica">Nenhum exame registrado.</p>}
    </div>
  )
}
