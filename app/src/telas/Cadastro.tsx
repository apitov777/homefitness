import { useEffect, useState } from 'react'
import type { Contexto } from '../App'
import { supabase } from '../supabase'
import { calcular, idadeEm, type Atividade, type Objetivo, type Sexo } from '../calc'
import { carregarMetasVigentes, erroTexto, fmt, hojeISO, salvarMeta, type Pessoa } from '../dados'

const ATIVIDADES: { valor: Atividade; nome: string; desc: string }[] = [
  { valor: 'sedentario', nome: 'Sedentário', desc: 'Trabalho sentado e quase nenhum exercício.' },
  { valor: 'leve', nome: 'Leve', desc: 'Exercício 1 a 3 vezes por semana.' },
  { valor: 'moderado', nome: 'Moderado', desc: 'Exercício 3 a 5 vezes por semana.' },
  { valor: 'ativo', nome: 'Ativo', desc: 'Exercício 6 a 7 vezes por semana.' },
  { valor: 'muito_ativo', nome: 'Muito ativo', desc: 'Treino pesado todo dia ou trabalho físico.' },
]

const OBJETIVOS: { valor: Objetivo; nome: string; desc: string }[] = [
  { valor: 'perder', nome: 'Perder gordura', desc: '18% abaixo do gasto diário.' },
  { valor: 'perder_lento', nome: 'Perder devagar', desc: '10% abaixo do gasto diário.' },
  { valor: 'manter', nome: 'Manter o peso', desc: 'Comer o mesmo que gasta.' },
  { valor: 'ganhar', nome: 'Ganhar massa', desc: '12% acima do gasto diário.' },
  { valor: 'saude', nome: 'Saúde geral', desc: '5% abaixo do gasto, foco em qualidade.' },
]

const RESTRICOES: { valor: string; nome: string }[] = [
  { valor: 'lactose', nome: 'Lactose' },
  { valor: 'gluten', nome: 'Glúten' },
  { valor: 'vegetariano', nome: 'Vegetariano' },
  { valor: 'vegano', nome: 'Vegano' },
  { valor: 'sem_carne_vermelha', nome: 'Sem carne vermelha' },
  { valor: 'frutos_do_mar', nome: 'Frutos do mar' },
  { valor: 'amendoim', nome: 'Amendoim' },
  { valor: 'oleaginosas', nome: 'Castanhas' },
  { valor: 'ovo', nome: 'Ovo' },
  { valor: 'soja', nome: 'Soja' },
]

const UNIDADES = ['mg', 'µg', 'UI', 'g', 'cápsula']

interface Suplemento { id?: string; nome: string; dose: string; unidade: string }

const n = (s: string) => parseFloat(s.replace(',', '.'))

export default function Cadastro({ ctx, p, onFim }: { ctx: Contexto; p: Pessoa; onFim: () => void }) {
  const souEu = p.user_id === ctx.session.user.id
  const passos = ['Você', 'Corpo', 'Rotina', 'Alimentação', 'Suplementos', ...(souEu ? ['Privacidade'] : []), 'Meta']
  const [passo, setPasso] = useState(0)
  const [nome, setNome] = useState(p.nome)
  const [sexo, setSexo] = useState<Sexo | ''>(p.sexo ?? '')
  const [nasc, setNasc] = useState(p.data_nascimento ?? '')
  const [altura, setAltura] = useState(p.altura_cm?.toString() ?? '')
  const [peso, setPeso] = useState('')
  const [gordura, setGordura] = useState('')
  const [cintura, setCintura] = useState('')
  const [atividade, setAtividade] = useState<Atividade | ''>(p.nivel_atividade ?? '')
  const [objetivo, setObjetivo] = useState<Objetivo | ''>(p.objetivo ?? '')
  const conhecidas = RESTRICOES.map((r) => r.valor)
  const [restricoes, setRestricoes] = useState<string[]>((p.restricoes ?? []).filter((r) => conhecidas.includes(r)))
  const [outras, setOutras] = useState((p.restricoes ?? []).filter((r) => !conhecidas.includes(r)).join(', '))
  const [preferencias, setPreferencias] = useState(p.preferencias ?? '')
  const [suplementos, setSuplementos] = useState<Suplemento[]>([])
  const [removidos, setRemovidos] = useState<string[]>([])
  const [compartilha, setCompartilha] = useState(p.compartilha_exames)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    ;(async () => {
      const [{ data: med }, { data: sup }] = await Promise.all([
        supabase.from('medida_corporal').select('peso_kg, gordura_pct, cintura_cm').eq('pessoa_id', p.id)
          .order('data', { ascending: false }).limit(1),
        supabase.from('suplemento_uso').select('id, nome, dose, unidade').eq('pessoa_id', p.id).is('fim', null).order('created_at'),
      ])
      if (med?.[0]) {
        setPeso(med[0].peso_kg?.toString() ?? '')
        setGordura(med[0].gordura_pct?.toString() ?? '')
        setCintura(med[0].cintura_cm?.toString() ?? '')
      }
      setSuplementos((sup ?? []).map((s) => ({ id: s.id, nome: s.nome, dose: s.dose?.toString() ?? '', unidade: s.unidade ?? 'mg' })))
    })()
  }, [p.id])

  const nomePasso = passos[passo]
  const idade = nasc ? idadeEm(nasc) : null
  const calc =
    sexo && idade != null && n(altura) > 0 && n(peso) > 0 && atividade && objetivo
      ? calcular({
          sexo, idade, pesoKg: n(peso), alturaCm: n(altura), atividade, objetivo,
          gorduraPct: n(gordura) > 0 ? n(gordura) : null,
        })
      : null

  function validar(): string | null {
    switch (nomePasso) {
      case 'Você':
        if (!nome.trim()) return 'Informe o nome.'
        if (!sexo) return 'Escolha o sexo biológico: ele muda a fórmula do gasto e as recomendações.'
        if (!nasc || idade == null || idade < 14 || idade > 110) return 'Informe uma data de nascimento válida.'
        return null
      case 'Corpo':
        if (!(n(altura) >= 100 && n(altura) <= 250)) return 'Altura entre 100 cm e 250 cm.'
        if (!(n(peso) >= 30 && n(peso) <= 350)) return 'Peso entre 30 kg e 350 kg.'
        if (gordura && !(n(gordura) >= 3 && n(gordura) <= 70)) return 'Gordura corporal entre 3% e 70%, ou deixe em branco.'
        return null
      case 'Rotina':
        if (!atividade) return 'Escolha o nível de atividade.'
        if (!objetivo) return 'Escolha o objetivo.'
        return null
      case 'Suplementos':
        if (suplementos.some((s) => !s.nome.trim())) return 'Dê um nome a cada suplemento ou remova a linha.'
        return null
      default:
        return null
    }
  }

  async function gravarPasso() {
    switch (nomePasso) {
      case 'Você': {
        const { error } = await supabase.from('pessoa').update({ nome: nome.trim(), sexo, data_nascimento: nasc }).eq('id', p.id)
        if (error) throw error
        break
      }
      case 'Corpo': {
        const { error } = await supabase.from('pessoa').update({ altura_cm: n(altura) }).eq('id', p.id)
        if (error) throw error
        const { error: e2 } = await supabase.from('medida_corporal').upsert(
          {
            pessoa_id: p.id, data: hojeISO(), peso_kg: n(peso),
            gordura_pct: n(gordura) > 0 ? n(gordura) : null, cintura_cm: n(cintura) > 0 ? n(cintura) : null,
          },
          { onConflict: 'pessoa_id,data' },
        )
        if (e2) throw e2
        break
      }
      case 'Rotina': {
        const { error } = await supabase.from('pessoa').update({ nivel_atividade: atividade, objetivo }).eq('id', p.id)
        if (error) throw error
        break
      }
      case 'Alimentação': {
        const extras = outras.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
        const todas = [...new Set([...restricoes, ...extras])]
        const { error } = await supabase
          .from('pessoa')
          .update({ restricoes: todas.length ? todas : null, preferencias: preferencias.trim() || null })
          .eq('id', p.id)
        if (error) throw error
        break
      }
      case 'Suplementos': {
        // Remover um suplemento encerra o uso ontem, sem apagar o histórico.
        if (removidos.length) {
          const ontem = new Date(Date.now() - 86400000)
          const { error } = await supabase.from('suplemento_uso').update({ fim: hojeISO(ontem) }).in('id', removidos)
          if (error) throw error
        }
        for (const s of suplementos) {
          const linha = { nome: s.nome.trim(), dose: n(s.dose) > 0 ? n(s.dose) : null, unidade: s.unidade }
          const { error } = s.id
            ? await supabase.from('suplemento_uso').update(linha).eq('id', s.id)
            : await supabase.from('suplemento_uso').insert({ pessoa_id: p.id, inicio: hojeISO(), ...linha })
          if (error) throw error
        }
        setRemovidos([])
        const { data } = await supabase.from('suplemento_uso').select('id, nome, dose, unidade').eq('pessoa_id', p.id).is('fim', null).order('created_at')
        setSuplementos((data ?? []).map((s) => ({ id: s.id, nome: s.nome, dose: s.dose?.toString() ?? '', unidade: s.unidade ?? 'mg' })))
        break
      }
      case 'Privacidade': {
        const { error } = await supabase.from('pessoa').update({ compartilha_exames: compartilha }).eq('id', p.id)
        if (error) throw error
        break
      }
      case 'Meta': {
        if (!calc) throw new Error('Faltam dados para calcular a meta.')
        await salvarMeta(p.id, calc, (await carregarMetasVigentes([p.id]))[p.id] ?? null)
        break
      }
    }
  }

  async function avancar() {
    setErro(null)
    const msg = validar()
    if (msg) return setErro(msg)
    setSalvando(true)
    try {
      await gravarPasso()
    } catch (e) {
      setSalvando(false)
      return setErro(erroTexto(e))
    }
    setSalvando(false)
    if (passo < passos.length - 1) {
      setPasso(passo + 1)
      window.scrollTo(0, 0)
    } else {
      await ctx.recarregarPessoas()
      onFim()
    }
  }

  function mudarSuplemento(i: number, campo: keyof Suplemento, v: string) {
    setSuplementos((xs) => xs.map((s, j) => (j === i ? { ...s, [campo]: v } : s)))
  }

  function tirarSuplemento(i: number) {
    const s = suplementos[i]
    if (s.id) setRemovidos((r) => [...r, s.id!])
    setSuplementos((xs) => xs.filter((_, j) => j !== i))
  }

  return (
    <div className="tela cadastro">
      <div className="cadastro-topo">
        <span className="dica">Passo {passo + 1} de {passos.length}</span>
        <button className="link" onClick={async () => { await ctx.recarregarPessoas(); onFim() }}>Fazer depois</button>
      </div>
      <div className="trilho"><div className="enchimento" style={{ width: `${((passo + 1) / passos.length) * 100}%` }} /></div>

      {nomePasso === 'Você' && (
        <section>
          <h1>{souEu ? 'Vamos começar por você' : `Dados de ${p.nome}`}</h1>
          <p className="dica">Com estes dados o app calcula o gasto diário e as recomendações de vitaminas e minerais.</p>
          <label>Nome<input value={nome} onChange={(e) => setNome(e.target.value)} /></label>
          <fieldset className="opcoes duas">
            <legend>Sexo biológico</legend>
            {(['M', 'F'] as Sexo[]).map((s) => (
              <button key={s} type="button" className={sexo === s ? 'ativa' : ''} onClick={() => setSexo(s)}>
                {s === 'M' ? 'Masculino' : 'Feminino'}
              </button>
            ))}
          </fieldset>
          <label>Data de nascimento<input type="date" value={nasc} max={hojeISO()} onChange={(e) => setNasc(e.target.value)} /></label>
          {idade != null && idade > 50 && (
            <p className="dica">As recomendações de nutrientes do app são para 19 a 50 anos; acima disso algumas mudam. Confira com o médico.</p>
          )}
        </section>
      )}

      {nomePasso === 'Corpo' && (
        <section>
          <h1>Medidas</h1>
          <p className="dica">Use a balança de manhã, em jejum, se puder. Dá para atualizar o peso depois no Perfil.</p>
          <div className="linha">
            <label>Altura<span className="com-unidade"><input inputMode="decimal" value={altura} onChange={(e) => setAltura(e.target.value)} />cm</span></label>
            <label>Peso<span className="com-unidade"><input inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} />kg</span></label>
          </div>
          <div className="linha">
            <label>Gordura corporal<span className="com-unidade"><input inputMode="decimal" placeholder="opcional" value={gordura} onChange={(e) => setGordura(e.target.value)} />%</span></label>
            <label>Cintura<span className="com-unidade"><input inputMode="decimal" placeholder="opcional" value={cintura} onChange={(e) => setCintura(e.target.value)} />cm</span></label>
          </div>
          <p className="dica">Com a gordura corporal (de bioimpedância ou DEXA), o cálculo usa a massa magra e fica mais preciso.</p>
        </section>
      )}

      {nomePasso === 'Rotina' && (
        <section>
          <h1>Rotina e objetivo</h1>
          <fieldset className="opcoes">
            <legend>Atividade física</legend>
            {ATIVIDADES.map((a) => (
              <button key={a.valor} type="button" className={atividade === a.valor ? 'ativa' : ''} onClick={() => setAtividade(a.valor)}>
                <strong>{a.nome}</strong><small>{a.desc}</small>
              </button>
            ))}
          </fieldset>
          <fieldset className="opcoes">
            <legend>Objetivo</legend>
            {OBJETIVOS.map((o) => (
              <button key={o.valor} type="button" className={objetivo === o.valor ? 'ativa' : ''} onClick={() => setObjetivo(o.valor)}>
                <strong>{o.nome}</strong><small>{o.desc}</small>
              </button>
            ))}
          </fieldset>
        </section>
      )}

      {nomePasso === 'Alimentação' && (
        <section>
          <h1>Alimentação</h1>
          <fieldset className="quem">
            <legend>Restrições, alergias ou o que não come</legend>
            <div className="chips quebra">
              {RESTRICOES.map((r) => (
                <button
                  key={r.valor}
                  type="button"
                  className={restricoes.includes(r.valor) ? 'ativa' : ''}
                  onClick={() => setRestricoes((xs) => (xs.includes(r.valor) ? xs.filter((x) => x !== r.valor) : [...xs, r.valor]))}
                >
                  {r.nome}
                </button>
              ))}
            </div>
          </fieldset>
          <label>Outras<input placeholder="separe por vírgula" value={outras} onChange={(e) => setOutras(e.target.value)} /></label>
          <label>
            Preferências
            <textarea rows={3} placeholder="ex.: não gosta de peixe, prefere jantar leve" value={preferencias} onChange={(e) => setPreferencias(e.target.value)} />
          </label>
        </section>
      )}

      {nomePasso === 'Suplementos' && (
        <section>
          <h1>Suplementos em uso</h1>
          <p className="dica">Registre só o que já toma hoje. Dose e reposição são decisões do médico; o app usa isso para ler os exames.</p>
          {suplementos.map((s, i) => (
            <div key={s.id ?? `novo-${i}`} className="item">
              <div className="item-topo">
                <label>Nome<input placeholder="ex.: vitamina D3" value={s.nome} onChange={(e) => mudarSuplemento(i, 'nome', e.target.value)} /></label>
                <button className="apagar" onClick={() => tirarSuplemento(i)} aria-label="Remover">×</button>
              </div>
              <div className="linha">
                <label>Dose<input inputMode="decimal" value={s.dose} onChange={(e) => mudarSuplemento(i, 'dose', e.target.value)} /></label>
                <label>
                  Unidade
                  <select value={s.unidade} onChange={(e) => mudarSuplemento(i, 'unidade', e.target.value)}>
                    {UNIDADES.map((u) => <option key={u}>{u}</option>)}
                  </select>
                </label>
              </div>
            </div>
          ))}
          <button className="link" onClick={() => setSuplementos([...suplementos, { nome: '', dose: '', unidade: 'mg' }])}>＋ adicionar suplemento</button>
          {!suplementos.length && <p className="dica">Não toma nenhum? É só seguir.</p>}
        </section>
      )}

      {nomePasso === 'Privacidade' && (
        <section>
          <h1>Seus exames</h1>
          <p>Quem da família pode ver os exames que você registrar?</p>
          <fieldset className="opcoes">
            <button type="button" className={!compartilha ? 'ativa' : ''} onClick={() => setCompartilha(false)}>
              <strong>Só eu</strong><small>Ninguém mais vê seus resultados.</small>
            </button>
            <button type="button" className={compartilha ? 'ativa' : ''} onClick={() => setCompartilha(true)}>
              <strong>Compartilhar com a família</strong><small>Quem está na família vê e pode comparar com a dieta.</small>
            </button>
          </fieldset>
          <p className="dica">Dá para mudar quando quiser no Perfil. Só você pode mudar isso.</p>
        </section>
      )}

      {nomePasso === 'Meta' && (
        <section>
          <h1>Sua meta diária</h1>
          {calc ? (
            <>
              <div className="cartao destaque">
                <span className="numero">{fmt(calc.kcal)} kcal</span>
                <div className="macros">
                  <span><strong>{fmt(calc.proteinaG)} g</strong> proteína</span>
                  <span><strong>{fmt(calc.carboidratoG)} g</strong> carboidrato</span>
                  <span><strong>{fmt(calc.gorduraG)} g</strong> gordura</span>
                  <span><strong>{fmt(calc.fibraG)} g</strong> fibra</span>
                  <span><strong>{fmt(calc.aguaMl)} mL</strong> água</span>
                </div>
              </div>
              <p className="formula">
                {calc.metodo === 'katch-mcardle'
                  ? `Gasto em repouso (Katch-McArdle, pela massa magra): ${fmt(calc.tmbKcal)} kcal`
                  : `Gasto em repouso (Mifflin-St Jeor): ${fmt(calc.tmbKcal)} kcal`}
                <br />
                Gasto total com a atividade: {fmt(calc.tmbKcal)} × {fmt(calc.fatorAtividade, 3)} = {fmt(calc.tdeeKcal)} kcal
                <br />
                Objetivo: {calc.ajusteObjetivo >= 0 ? '+' : ''}{fmt(calc.ajusteObjetivo * 100)}% = {fmt(calc.kcal)} kcal
                · proteína {fmt(calc.proteinaGkg, 2)} g/kg
              </p>
              {calc.avisos.map((a) => <p key={a} className="aviso">{a}</p>)}
              <p className="dica">A meta é só de {nome}. Dá para recalcular quando o peso mudar, no Perfil.</p>
            </>
          ) : (
            <p className="erro">Faltam dados dos passos anteriores para calcular.</p>
          )}
        </section>
      )}

      {erro && <p className="erro">{erro}</p>}
      <div className="cadastro-acoes">
        {passo > 0 && <button onClick={() => { setErro(null); setPasso(passo - 1) }}>Voltar</button>}
        <button className="primario" disabled={salvando} onClick={avancar}>
          {salvando ? 'Salvando…' : nomePasso === 'Meta' ? 'Usar esta meta e começar' : 'Continuar'}
        </button>
      </div>
    </div>
  )
}
