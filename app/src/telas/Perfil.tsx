import { useEffect, useState, type FormEvent } from 'react'
import type { Contexto } from '../App'
import { supabase } from '../supabase'
import {
  calcular, idadeEm, NOMES_ATIVIDADE, NOMES_OBJETIVO,
  type Atividade, type Objetivo, type Sexo,
} from '../calc'
import {
  carregarAlimentos, carregarMetasVigentes, erroTexto, esquecerComposicao, fmt, hojeISO, salvarMeta,
  type Meta, type Pessoa,
} from '../dados'
import Exames from './Exames'
import Familia, { Avatar } from './Familia'

function DadosPessoa({ ctx, p }: { ctx: Contexto; p: Pessoa }) {
  const [nome, setNome] = useState(p.nome)
  const [sexo, setSexo] = useState<Sexo | ''>(p.sexo ?? '')
  const [nasc, setNasc] = useState(p.data_nascimento ?? '')
  const [altura, setAltura] = useState(p.altura_cm?.toString() ?? '')
  const [atividade, setAtividade] = useState<Atividade | ''>(p.nivel_atividade ?? '')
  const [objetivo, setObjetivo] = useState<Objetivo | ''>(p.objetivo ?? '')
  const [peso, setPeso] = useState('')
  const [gordura, setGordura] = useState('')
  const [meta, setMeta] = useState<Meta | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const souEu = p.user_id === ctx.session.user.id
  const [compartilha, setCompartilha] = useState(p.compartilha_exames)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('medida_corporal')
        .select('peso_kg, gordura_pct')
        .eq('pessoa_id', p.id)
        .order('data', { ascending: false })
        .limit(1)
      if (data?.[0]) {
        setPeso(data[0].peso_kg?.toString() ?? '')
        setGordura(data[0].gordura_pct?.toString() ?? '')
      }
      setMeta((await carregarMetasVigentes([p.id]))[p.id] ?? null)
    })()
  }, [p.id])

  const n = (s: string) => parseFloat(s.replace(',', '.'))
  const podeCalcular = sexo && nasc && n(altura) > 0 && n(peso) > 0 && atividade && objetivo
  const calc = podeCalcular
    ? calcular({
        sexo: sexo as Sexo,
        idade: idadeEm(nasc),
        pesoKg: n(peso),
        alturaCm: n(altura),
        atividade: atividade as Atividade,
        objetivo: objetivo as Objetivo,
        gorduraPct: n(gordura) > 0 ? n(gordura) : null,
      })
    : null

  async function salvarDados(ev: FormEvent) {
    ev.preventDefault()
    setErro(null)
    setMsg(null)
    const { error } = await supabase
      .from('pessoa')
      .update({
        nome,
        sexo: sexo || null,
        data_nascimento: nasc || null,
        altura_cm: n(altura) > 0 ? n(altura) : null,
        nivel_atividade: atividade || null,
        objetivo: objetivo || null,
      })
      .eq('id', p.id)
    if (error) return setErro(erroTexto(error))
    if (n(peso) > 0) {
      const { error: e2 } = await supabase.from('medida_corporal').upsert(
        { pessoa_id: p.id, data: hojeISO(), peso_kg: n(peso), gordura_pct: n(gordura) > 0 ? n(gordura) : null },
        { onConflict: 'pessoa_id,data' },
      )
      if (e2) return setErro(erroTexto(e2))
    }
    await ctx.recarregarPessoas()
    setMsg('Dados salvos.')
  }

  async function usarMeta() {
    if (!calc) return
    setErro(null)
    try {
      await salvarMeta(p.id, calc, meta)
    } catch (e) {
      return setErro(erroTexto(e))
    }
    setMeta((await carregarMetasVigentes([p.id]))[p.id] ?? null)
    setMsg('Meta atualizada.')
  }

  async function alternarCompartilhar(v: boolean) {
    setCompartilha(v)
    const { error } = await supabase.from('pessoa').update({ compartilha_exames: v }).eq('id', p.id)
    if (error) {
      setCompartilha(!v)
      setErro(erroTexto(error))
    } else await ctx.recarregarPessoas()
  }

  return (
    <>
      <form className="cartao" onSubmit={salvarDados}>
        <h2>Dados de {p.nome}</h2>
        <label>Nome<input value={nome} required onChange={(e) => setNome(e.target.value)} /></label>
        <div className="linha">
          <label>
            Sexo
            <select value={sexo} onChange={(e) => setSexo(e.target.value as Sexo)}>
              <option value="">–</option><option value="M">Masculino</option><option value="F">Feminino</option>
            </select>
          </label>
          <label>Nascimento<input type="date" value={nasc} onChange={(e) => setNasc(e.target.value)} /></label>
        </div>
        <div className="linha">
          <label>Altura (cm)<input inputMode="decimal" value={altura} onChange={(e) => setAltura(e.target.value)} /></label>
          <label>Peso hoje (kg)<input inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} /></label>
          <label>Gordura (%)<input inputMode="decimal" placeholder="opcional" value={gordura} onChange={(e) => setGordura(e.target.value)} /></label>
        </div>
        <label>
          Atividade física
          <select value={atividade} onChange={(e) => setAtividade(e.target.value as Atividade)}>
            <option value="">–</option>
            {Object.entries(NOMES_ATIVIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          Objetivo
          <select value={objetivo} onChange={(e) => setObjetivo(e.target.value as Objetivo)}>
            <option value="">–</option>
            {Object.entries(NOMES_OBJETIVO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button className="primario">Salvar dados</button>
      </form>

      <section className="cartao">
        <h2>Meta diária</h2>
        {meta ? (
          <p>
            Atual (desde {new Date(meta.inicio + 'T12:00:00').toLocaleDateString('pt-BR')}): <strong>{fmt(meta.kcal)} kcal</strong>,
            proteína {fmt(meta.proteina_g)} g, carboidrato {fmt(meta.carboidrato_g)} g, gordura {fmt(meta.gordura_g)} g,
            fibra {fmt(meta.fibra_g)} g, água {fmt(meta.agua_ml)} mL.
          </p>
        ) : (
          <p className="dica">Ainda sem meta.</p>
        )}
        {calc ? (
          <>
            <p className="formula">
              {calc.metodo === 'katch-mcardle'
                ? `TMB (Katch-McArdle) = 370 + 21,6 × massa magra = ${fmt(calc.tmbKcal)} kcal`
                : `TMB (Mifflin-St Jeor) = 10 × peso + 6,25 × altura − 5 × idade ${sexo === 'M' ? '+ 5' : '− 161'} = ${fmt(calc.tmbKcal)} kcal`}
              <br />
              Gasto total = TMB × {fmt(calc.fatorAtividade, 3)} = {fmt(calc.tdeeKcal)} kcal · objetivo{' '}
              {calc.ajusteObjetivo >= 0 ? '+' : ''}{fmt(calc.ajusteObjetivo * 100)}%
            </p>
            <p>
              Sugestão: <strong>{fmt(calc.kcal)} kcal</strong>, proteína {fmt(calc.proteinaG)} g ({fmt(calc.proteinaGkg, 2)} g/kg),
              carboidrato {fmt(calc.carboidratoG)} g, gordura {fmt(calc.gorduraG)} g, fibra {fmt(calc.fibraG)} g, água{' '}
              {fmt(calc.aguaMl)} mL.
            </p>
            {calc.avisos.map((a) => <p key={a} className="aviso">{a}</p>)}
            <button onClick={usarMeta}>Usar como meta de {p.nome}</button>
          </>
        ) : (
          <p className="dica">Preencha sexo, nascimento, altura, peso, atividade e objetivo para calcular.</p>
        )}
      </section>

      {souEu && (
        <section className="cartao">
          <h2>Privacidade dos exames</h2>
          <label className="check">
            <input type="checkbox" checked={compartilha} onChange={(e) => alternarCompartilhar(e.target.checked)} />
            Compartilhar meus exames com a família
          </label>
          <p className="dica">Desligado, só você vê seus exames. Só você pode mudar isso.</p>
        </section>
      )}
      {erro && <p className="erro">{erro}</p>}
      {msg && <p className="ok">{msg}</p>}
    </>
  )
}

const CAMPOS_ROTULO = [
  { cod: 'energia', nome: 'Energia', un: 'kcal' },
  { cod: 'proteina', nome: 'Proteína', un: 'g' },
  { cod: 'carboidrato', nome: 'Carboidrato', un: 'g' },
  { cod: 'acucar', nome: 'Açúcares', un: 'g' },
  { cod: 'gordura', nome: 'Gordura total', un: 'g' },
  { cod: 'gordura_saturada', nome: 'Gordura saturada', un: 'g' },
  { cod: 'fibra', nome: 'Fibra', un: 'g' },
  { cod: 'sodio', nome: 'Sódio', un: 'mg' },
  { cod: 'calcio', nome: 'Cálcio', un: 'mg' },
  { cod: 'ferro', nome: 'Ferro', un: 'mg' },
]

function AlimentoRotulo({ ctx }: { ctx: Contexto }) {
  const [nome, setNome] = useState('')
  const [marca, setMarca] = useState('')
  const [porcao, setPorcao] = useState('')
  const [valores, setValores] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar(ev: FormEvent) {
    ev.preventDefault()
    setErro(null)
    setMsg(null)
    const g = parseFloat(porcao.replace(',', '.'))
    if (!(g > 0)) return setErro('Informe a porção do rótulo em gramas (ou mL).')
    const { data: nuts, error: e0 } = await supabase.from('nutriente').select('id, codigo').in('codigo', CAMPOS_ROTULO.map((c) => c.cod))
    if (e0) return setErro(erroTexto(e0))
    const { data: a, error } = await supabase
      .from('alimento')
      .insert({ familia_id: ctx.familiaId, nome, marca: marca || null, fonte: 'rotulo', porcao_referencia_g: g })
      .select('id')
      .single()
    if (error) return setErro(erroTexto(error))
    // O rótulo informa por porção; o banco guarda por 100 g.
    const linhas = nuts!
      .map((nu) => ({ nu, v: parseFloat((valores[nu.codigo] ?? '').replace(',', '.')) }))
      .filter((x) => Number.isFinite(x.v))
      .map((x) => ({ alimento_id: a.id, nutriente_id: x.nu.id, valor_por_100g: Math.round((x.v * 10000) / g) / 100 }))
    if (linhas.length) {
      const { error: e2 } = await supabase.from('alimento_nutriente').insert(linhas)
      if (e2) return setErro(erroTexto(e2))
    }
    esquecerComposicao(a.id)
    await carregarAlimentos(true)
    setNome('')
    setMarca('')
    setPorcao('')
    setValores({})
    setMsg('Alimento cadastrado. Já aparece na busca ao registrar.')
  }

  return (
    <form className="cartao" onSubmit={salvar}>
      <h2>Alimento pelo rótulo</h2>
      <p className="dica">Para industrializados ou o que faltar na TACO (o leite de vaca, por exemplo, está sem calorias na TACO). Copie a tabela nutricional da embalagem.</p>
      <div className="linha">
        <label>Nome<input required value={nome} onChange={(e) => setNome(e.target.value)} /></label>
        <label>Marca<input value={marca} onChange={(e) => setMarca(e.target.value)} /></label>
      </div>
      <label>Porção do rótulo (g ou mL)<input inputMode="decimal" required value={porcao} onChange={(e) => setPorcao(e.target.value)} /></label>
      <div className="grade">
        {CAMPOS_ROTULO.map((c) => (
          <label key={c.cod}>
            {c.nome} ({c.un})
            <input inputMode="decimal" value={valores[c.cod] ?? ''} onChange={(e) => setValores({ ...valores, [c.cod]: e.target.value })} />
          </label>
        ))}
      </div>
      <button>Cadastrar alimento</button>
      {erro && <p className="erro">{erro}</p>}
      {msg && <p className="ok">{msg}</p>}
    </form>
  )
}

export default function Perfil({ ctx }: { ctx: Contexto }) {
  const [sel, setSel] = useState(ctx.eu?.id ?? ctx.pessoas[0]?.id)
  const [verFamilia, setVerFamilia] = useState(false)
  const [verExames, setVerExames] = useState(false)
  const p = ctx.pessoas.find((x) => x.id === sel)

  if (verFamilia) return <Familia ctx={ctx} onVoltar={() => setVerFamilia(false)} />
  if (verExames) return <Exames ctx={ctx} onVoltar={() => setVerExames(false)} />

  return (
    <div className="tela">
      <h1>Perfil</h1>
      <button className="cartao entrada-familia" onClick={() => setVerFamilia(true)}>
        <span className="avatares" aria-hidden>
          {ctx.pessoas.slice(0, 4).map((x) => <Avatar key={x.id} id={x.id} nome={x.nome} />)}
        </span>
        <span className="membro-texto">
          <strong>Família</strong>
          <small>{ctx.pessoas.map((x) => x.nome).join(', ')} · convites e papéis</small>
        </span>
        <span className="seta" aria-hidden>›</span>
      </button>
      <button className="cartao entrada-familia" onClick={() => setVerExames(true)}>
        <span className="icone-entrada" aria-hidden>⚗</span>
        <span className="membro-texto">
          <strong>Exames</strong>
          <small>Resultados de laboratório e a relação com a dieta</small>
        </span>
        <span className="seta" aria-hidden>›</span>
      </button>
      <div className="chips">
        {ctx.pessoas.map((x) => (
          <button key={x.id} className={x.id === sel ? 'ativa' : ''} onClick={() => setSel(x.id)}>{x.nome}</button>
        ))}
      </div>
      {p && (
        <button className="primario" onClick={() => ctx.abrirCadastro(p.id)}>
          {p.user_id === ctx.session.user.id ? 'Refazer meu cadastro guiado' : `Cadastro guiado de ${p.nome}`}
        </button>
      )}
      {p && <DadosPessoa key={p.id} ctx={ctx} p={p} />}
      <AlimentoRotulo ctx={ctx} />
      <button className="link" onClick={() => supabase.auth.signOut()}>Sair ({ctx.session.user.email})</button>
    </div>
  )
}
