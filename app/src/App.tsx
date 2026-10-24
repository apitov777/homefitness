import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { cadastroIncompleto, carregarPessoas, erroTexto, type Pessoa } from './dados'
import { convitePendente, guardarConvitePendente } from './familia'
import Login from './telas/Login'
import Onboarding from './telas/Onboarding'
import Cadastro from './telas/Cadastro'
import TelaConvite from './telas/Convite'
import Hoje from './telas/Hoje'
import Plano from './telas/Plano'
import Registrar, { type ItemInicial } from './telas/Registrar'
import Receitas from './telas/Receitas'
import Exames from './telas/Exames'
import Perfil from './telas/Perfil'

export interface Contexto {
  session: Session
  familiaId: string
  pessoas: Pessoa[]
  eu: Pessoa | undefined
  recarregarPessoas: () => Promise<void>
  /** Depois de entrar, sair ou ser removido de uma família. */
  recarregarFamilia: () => Promise<void>
  abrirCadastro: (pessoaId: string) => void
}

type Aba = 'hoje' | 'plano' | 'receitas' | 'registrar' | 'exames' | 'perfil'

// Registrar não fica na barra: abre pelo botão do Hoje e pelo "Registrar agora" de uma receita.
const ABAS: { id: Aba; nome: string; icone: string }[] = [
  { id: 'hoje', nome: 'Hoje', icone: '◔' },
  { id: 'plano', nome: 'Plano', icone: '☷' },
  { id: 'receitas', nome: 'Receitas', icone: '♨' },
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
  const [registrarInicial, setRegistrarInicial] = useState<ItemInicial | null>(null)
  // Pessoa em cadastro guiado; abre sozinho no primeiro acesso enquanto faltarem dados.
  const [cadastro, setCadastro] = useState<string | null>(null)
  // Código de convite aberto pelo link ou digitado; mostra a tela de aceitar depois do login.
  const [convite, setConvite] = useState<string | null>(convitePendente)

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
  if (!session) return <Login convite={convite} />
  if (erro)
    return (
      <div className="tela">
        <p className="erro">{erro}</p>
        <button onClick={() => { setErro(null); carregarFamilia() }}>Tentar de novo</button>
      </div>
    )
  if (familiaId === undefined) return <div className="carregando">Carregando…</div>
  if (convite)
    return (
      <TelaConvite
        codigo={convite}
        temFamilia={familiaId !== null}
        onPronto={() => { setConvite(null); setAba('hoje'); carregarFamilia() }}
        onFechar={() => setConvite(null)}
      />
    )
  if (familiaId === null)
    return <Onboarding onPronto={carregarFamilia} onConvite={(c) => { guardarConvitePendente(c); setConvite(c) }} />

  const ctx: Contexto = {
    session,
    familiaId,
    pessoas,
    eu: pessoas.find((p) => p.user_id === session.user.id),
    recarregarPessoas: async () => setPessoas(await carregarPessoas(familiaId)),
    recarregarFamilia: carregarFamilia,
    abrirCadastro: setCadastro,
  }

  function abrirRegistrar(inicial?: ItemInicial) {
    setRegistrarInicial(inicial ?? null)
    setAba('registrar')
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
        {aba === 'hoje' && <Hoje ctx={ctx} versao={versaoHoje} onRegistrar={() => abrirRegistrar()} />}
        {aba === 'registrar' && (
          <Registrar key={registrarInicial?.alimento.id ?? ''} ctx={ctx} inicial={registrarInicial} onSalvo={() => { setVersaoHoje((v) => v + 1); setAba('hoje') }} />
        )}
        {aba === 'plano' && <Plano ctx={ctx} />}
        {aba === 'receitas' && <Receitas ctx={ctx} onRegistrar={abrirRegistrar} />}
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
