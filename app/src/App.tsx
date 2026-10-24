import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { cadastroIncompleto, carregarPessoas, erroTexto, type Pessoa } from './dados'
import Login from './telas/Login'
import Onboarding from './telas/Onboarding'
import Cadastro from './telas/Cadastro'
import Hoje from './telas/Hoje'
import Plano from './telas/Plano'
import Registrar from './telas/Registrar'
import Exames from './telas/Exames'
import Perfil from './telas/Perfil'

export interface Contexto {
  session: Session
  familiaId: string
  pessoas: Pessoa[]
  eu: Pessoa | undefined
  recarregarPessoas: () => Promise<void>
  abrirCadastro: (pessoaId: string) => void
}

type Aba = 'hoje' | 'plano' | 'registrar' | 'exames' | 'perfil'

const ABAS: { id: Aba; nome: string; icone: string }[] = [
  { id: 'hoje', nome: 'Hoje', icone: '◔' },
  { id: 'plano', nome: 'Plano', icone: '☷' },
  { id: 'registrar', nome: 'Registrar', icone: '＋' },
  { id: 'exames', nome: 'Exames', icone: '⚗' },
  { id: 'perfil', nome: 'Perfil', icone: '☺' },
]

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [familiaId, setFamiliaId] = useState<string | null | undefined>(undefined)
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [aba, setAba] = useState<Aba>('hoje')
  const [erro, setErro] = useState<string | null>(null)
  const [versaoHoje, setVersaoHoje] = useState(0)
  // Pessoa em cadastro guiado; abre sozinho no primeiro acesso enquanto faltarem dados.
  const [cadastro, setCadastro] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_ev, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const carregarFamilia = useCallback(async () => {
    if (!session) return
    try {
      await supabase.rpc('aceitar_convites')
      const { data, error } = await supabase
        .from('familia_membro')
        .select('familia_id')
        .eq('user_id', session.user.id)
        .order('created_at')
        .limit(1)
      if (error) throw error
      const id = data[0]?.familia_id ?? null
      const lista = id ? await carregarPessoas(id) : []
      setFamiliaId(id)
      setPessoas(lista)
      const eu = lista.find((p) => p.user_id === session.user.id)
      if (eu && cadastroIncompleto(eu)) setCadastro(eu.id)
    } catch (e) {
      setErro(erroTexto(e))
    }
  }, [session])

  useEffect(() => {
    if (session) carregarFamilia()
    else setFamiliaId(undefined)
  }, [session, carregarFamilia])

  if (session === undefined) return <div className="carregando">Carregando…</div>
  if (!session) return <Login />
  if (erro)
    return (
      <div className="tela">
        <p className="erro">{erro}</p>
        <button onClick={() => { setErro(null); carregarFamilia() }}>Tentar de novo</button>
      </div>
    )
  if (familiaId === undefined) return <div className="carregando">Carregando…</div>
  if (familiaId === null) return <Onboarding onPronto={carregarFamilia} />

  const ctx: Contexto = {
    session,
    familiaId,
    pessoas,
    eu: pessoas.find((p) => p.user_id === session.user.id),
    recarregarPessoas: async () => setPessoas(await carregarPessoas(familiaId)),
    abrirCadastro: setCadastro,
  }

  const emCadastro = pessoas.find((p) => p.id === cadastro)
  if (emCadastro)
    return (
      <Cadastro
        key={emCadastro.id}
        ctx={ctx}
        p={emCadastro}
        onFim={() => {
          setCadastro(null)
          setVersaoHoje((v) => v + 1)
        }}
      />
    )

  return (
    <div className="app">
      <main className="conteudo">
        {aba === 'hoje' && <Hoje ctx={ctx} versao={versaoHoje} onRegistrar={() => setAba('registrar')} />}
        {aba === 'registrar' && (
          <Registrar ctx={ctx} onSalvo={() => { setVersaoHoje((v) => v + 1); setAba('hoje') }} />
        )}
        {aba === 'plano' && <Plano ctx={ctx} />}
        {aba === 'exames' && <Exames ctx={ctx} />}
        {aba === 'perfil' && <Perfil ctx={ctx} />}
      </main>
      <nav className="abas">
        {ABAS.map((a) => (
          <button key={a.id} className={aba === a.id ? 'ativa' : ''} onClick={() => setAba(a.id)}>
            <span className="icone" aria-hidden>{a.icone}</span>
            {a.nome}
          </button>
        ))}
      </nav>
    </div>
  )
}
