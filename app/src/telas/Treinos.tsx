import { useEffect, useState } from 'react'
import type { Contexto } from '../App'
import { supabase } from '../supabase'
import { FATORES, NOMES_ATIVIDADE } from '../calc'
import {
  carregarMetasVigentes, DIAS_SEMANA, descreverDias, erroTexto, fmt, hojeISO, lerNumero, somarDias, type Meta,
} from '../dados'
import {
  apagarTreino, ATIVIDADES, carregarMetasDia, carregarTreinos, inicioSemana, kcalTreino, rotuloDia, salvarTreino, ultimoPeso,
  type MetaDia, type Treino,
} from '../semana'
import Folha from './Folha'

const ROTINAS: { fator: number; nome: string }[] = [
  { fator: 1.2, nome: 'Sentado quase o dia todo' },
  { fator: 1.3, nome: 'Anda um pouco no dia' },
  { fator: 1.4, nome: 'Em pé boa parte do dia' },
  { fator: 1.5, nome: 'Trabalho em pé ou andando' },
]

const OUTRA = 'Outra atividade'

function EditorTreino({ pessoaId, original, peso, onFim }: {
  pessoaId: string
  original: Treino | null
  peso: number | null
  onFim: (salvou: boolean) => void
}) {
  const conhecida = ATIVIDADES.find((a) => a.nome === original?.atividade)
  const [escolha, setEscolha] = useState(original ? (conhecida ? conhecida.nome : OUTRA) : ATIVIDADES[0].nome)
  const [nome, setNome] = useState(original && !conhecida ? original.atividade : '')
  const [met, setMet] = useState(original?.met ? String(original.met) : String(ATIVIDADES[0].met))
  const [minutos, setMinutos] = useState(String(original?.minutos ?? 60))
  const [dias, setDias] = useState<number[]>(original?.dias ?? [1, 3, 5])
  const [relogio, setRelogio] = useState(original?.kcal_informada ? String(original.kcal_informada) : '')
  const [erro, setErro] = useState<string | null>(null)

  function escolher(v: string) {
    setEscolha(v)
    const a = ATIVIDADES.find((x) => x.nome === v)
    if (a) setMet(String(a.met))
  }

  const t = { met: lerNumero(met) || null, minutos: Math.round(lerNumero(minutos)), kcal_informada: lerNumero(relogio) || null }
  const kcal = kcalTreino(t, peso)

  async function salvar() {
    setErro(null)
    const atividade = escolha === OUTRA ? nome.trim() : escolha
    if (!atividade) return setErro('Dê um nome para a atividade.')
    if (t.minutos < 5) return setErro('Informe os minutos.')
    if (!dias.length) return setErro('Escolha pelo menos um dia.')
    if (!t.kcal_informada && !(t.met && t.met > 1)) return setErro('Informe o MET (acima de 1) ou as calorias do relógio.')
    try {
      await salvarTreino({ id: original?.id ?? null, pessoa_id: pessoaId, atividade, ...t, dias: [...dias].sort() })
      onFim(true)
    } catch (e) {
      setErro(erroTexto(e))
    }
  }

  async function apagar() {
    if (!original || !confirm(`Apagar ${original.atividade}?`)) return
    try {
      await apagarTreino(original.id)
      onFim(true)
    } catch (e) {
      setErro(erroTexto(e))
    }
  }

  return (
    <Folha titulo={original ? 'Editar treino' : 'Novo treino'} onFechar={() => onFim(false)}>
      <label>
        Atividade
        <select value={escolha} onChange={(e) => escolher(e.target.value)}>
          {ATIVIDADES.map((a) => <option key={a.nome} value={a.nome}>{a.nome} ({fmt(a.met, 1)} MET)</option>)}
          <option value={OUTRA}>{OUTRA}</option>
        </select>
      </label>
      {escolha === OUTRA && <label>Nome<input value={nome} placeholder="ex.: beach tennis" onChange={(e) => setNome(e.target.value)} /></label>}
      <div className="linha">
        <label>
          Duração
          <span className="com-unidade"><input inputMode="numeric" value={minutos} onChange={(e) => setMinutos(e.target.value)} />min</span>
        </label>
        <label>
          MET
          <input inputMode="decimal" value={met} onChange={(e) => setMet(e.target.value)} />
        </label>
      </div>
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
      <label>
        Calorias ativas do relógio por sessão (opcional)
        <span className="com-unidade"><input inputMode="numeric" value={relogio} onChange={(e) => setRelogio(e.target.value)} />kcal</span>
      </label>
      <p className="formula">
        {t.kcal_informada
          ? <>≈ <strong>{fmt(kcal)} kcal</strong> por sessão, pelo relógio.</>
          : kcal != null
            ? <>≈ <strong>{fmt(kcal)} kcal</strong> por sessão: (MET {fmt(t.met, 1)} − 1) × {fmt(peso, 1)} kg × {fmt(t.minutos / 60, 2)} h. O 1 MET de repouso já está na TMB.</>
            : <>Sem peso registrado: anote o peso em Perfil para estimar pelo MET, ou use as calorias do relógio.</>}
      </p>
      <p className="dica">MET do Compendium of Physical Activities. Se o relógio mostra as calorias ativas do treino, elas valem mais que a estimativa.</p>
      {erro && <p className="erro">{erro}</p>}
      <button className="primario" onClick={salvar}>Salvar treino</button>
      {original && <button className="link perigo" onClick={apagar}>Apagar treino</button>}
    </Folha>
  )
}

export default function Treinos({ ctx, sel }: { ctx: Contexto; sel: string }) {
  const pessoa = ctx.pessoas.find((p) => p.id === sel)
  const [treinos, setTreinos] = useState<Treino[]>([])
  const [peso, setPeso] = useState<number | null>(null)
  const [meta, setMeta] = useState<Meta | undefined>(undefined)
  const [semana, setSemana] = useState<MetaDia[]>([])
  const [editando, setEditando] = useState<Treino | 'novo' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const de = inicioSemana(hojeISO())

  useEffect(() => {
    ;(async () => {
      try {
        const [ts, p, ms, sem] = await Promise.all([
          carregarTreinos([sel]), ultimoPeso(sel), carregarMetasVigentes([sel]), carregarMetasDia([sel], de, somarDias(de, 6)),
        ])
        setTreinos(ts)
        setPeso(p)
        setMeta(ms[sel])
        setSemana(sem)
        setErro(null)
      } catch (e) {
        setErro(erroTexto(e))
      }
    })()
  }, [sel, tick, de, pessoa?.meta_pelo_treino, pessoa?.fator_rotina])

  async function mudar(valores: { meta_pelo_treino?: boolean; fator_rotina?: number }) {
    const { error } = await supabase.from('pessoa').update(valores).eq('id', sel)
    if (error) setErro(erroTexto(error))
    else await ctx.recarregarPessoas()
  }

  if (!pessoa) return null
  const totalSemana = treinos.reduce((s, t) => s + (kcalTreino(t, peso) ?? 0) * t.dias.length, 0)
  const sessoes = treinos.reduce((s, t) => s + t.dias.length, 0)
  const podeAcompanhar = !!(meta?.tmb_kcal && meta?.tdee_kcal)
  const mediaMeta = semana.length ? semana.reduce((s, m) => s + (m.kcal ?? 0), 0) / semana.length : 0
  const fatorCadastro = pessoa.nivel_atividade ? FATORES[pessoa.nivel_atividade] : null
  const desvio = meta && mediaMeta ? mediaMeta / meta.kcal - 1 : 0

  return (
    <>
      <p className="dica">
        Os treinos de {pessoa.nome} na semana. O gasto entra no saldo da Semana; com a meta acompanhando o treino, o dia de treino
        tem mais comida e o de descanso, menos.
      </p>
      {erro && <p className="erro">{erro}</p>}
      {treinos.map((t) => {
        const k = kcalTreino(t, peso)
        return (
          <button key={t.id} className="cartao receita" onClick={() => setEditando(t)}>
            <span className="refeicao-topo">
              <strong>{t.atividade}</strong>
              <span className="kcal">{k != null ? `≈ ${fmt(k)} kcal` : '–'}</span>
            </span>
            <small>
              {t.minutos} min · {descreverDias(t.dias)} · {t.kcal_informada ? 'calorias do relógio' : `${fmt(t.met, 1)} MET`}
            </small>
          </button>
        )
      })}
      {treinos.length > 0 && (
        <p className="total-plano">
          {sessoes} {sessoes === 1 ? 'sessão' : 'sessões'} por semana · <strong>≈ {fmt(totalSemana)} kcal</strong> de treino
        </p>
      )}
      {!treinos.length && <p className="dica">Nenhum treino ainda.</p>}
      <button className="primario" onClick={() => setEditando('novo')}>＋ Adicionar treino</button>

      <section className="cartao">
        <h2>Meta do dia</h2>
        <fieldset className="opcoes duas">
          <button className={!pessoa.meta_pelo_treino ? 'ativa' : ''} onClick={() => mudar({ meta_pelo_treino: false })}>
            Fixa
            <small>{meta ? `${fmt(meta.kcal)} kcal todo dia` : 'A mesma todo dia'}</small>
          </button>
          <button
            className={pessoa.meta_pelo_treino ? 'ativa' : ''}
            disabled={!podeAcompanhar}
            onClick={() => mudar({ meta_pelo_treino: true })}
          >
            Acompanha o treino
            <small>Mais no dia de treino</small>
          </button>
        </fieldset>
        {!podeAcompanhar && <p className="dica">Faça o cadastro em Perfil para o app ter a TMB e o gasto de {pessoa.nome}.</p>}
        {pessoa.meta_pelo_treino && podeAcompanhar && (
          <>
            <label>
              Rotina fora do treino
              <select value={String(pessoa.fator_rotina)} onChange={(e) => mudar({ fator_rotina: Number(e.target.value) })}>
                {ROTINAS.map((r) => <option key={r.fator} value={String(r.fator)}>{r.nome} (× {fmt(r.fator, 2)})</option>)}
              </select>
            </label>
            <p className="formula">
              Gasto do dia = TMB {fmt(meta!.tmb_kcal)} kcal × {fmt(pessoa.fator_rotina, 2)} + treino do dia. Meta do dia = gasto do dia ×{' '}
              {fmt((meta!.kcal / meta!.tdee_kcal!) * 100)}% (a meta de {fmt(meta!.kcal)} kcal sobre o gasto de {fmt(meta!.tdee_kcal)} kcal do
              cadastro), nunca abaixo da TMB. A diferença vai para o carboidrato; proteína e gordura ficam iguais.
            </p>
          </>
        )}
        <table className="tabela">
          <thead><tr><th>Dia</th><th>Treino</th><th>Gasto</th><th>Meta</th></tr></thead>
          <tbody>
            {semana.map((m) => (
              <tr key={m.data}>
                <td>{rotuloDia(m.data)}</td>
                <td>{m.treino_kcal ? `${fmt(m.treino_kcal)} kcal` : '–'}</td>
                <td>{m.gasto_kcal ? `${fmt(m.gasto_kcal)} kcal` : '–'}</td>
                <td>{m.kcal ? `${fmt(m.kcal)} kcal` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {pessoa.meta_pelo_treino && meta && mediaMeta > 0 && (
          <p className="dica">
            Média da semana: {fmt(mediaMeta)} kcal por dia, contra {fmt(meta.kcal)} kcal da meta fixa.
            {Math.abs(desvio) > 0.1 && fatorCadastro && pessoa.nivel_atividade && (
              <> O nível do cadastro ({NOMES_ATIVIDADE[pessoa.nivel_atividade].toLowerCase()}, × {fmt(fatorCadastro, 2)}) não bate com os
                treinos lançados. Confira a rotina acima ou refaça o cadastro em Perfil.</>
            )}
          </p>
        )}
      </section>

      {editando && (
        <EditorTreino
          pessoaId={sel}
          original={editando === 'novo' ? null : editando}
          peso={peso}
          onFim={(salvou) => { setEditando(null); if (salvou) setTick((x) => x + 1) }}
        />
      )}
    </>
  )
}
