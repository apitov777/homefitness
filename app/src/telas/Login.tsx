import { useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { FaixaConvite } from './Convite'

export default function Login({ convite }: { convite: string | null }) {
  // Quem chega por convite quase sempre ainda não tem conta.
  const [modo, setModo] = useState<'entrar' | 'criar'>(convite ? 'criar' : 'entrar')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(ev: FormEvent) {
    ev.preventDefault()
    setErro(null)
    setMsg(null)
    setEnviando(true)
    try {
      if (modo === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: senha,
          options: { emailRedirectTo: window.location.origin + window.location.pathname },
        })
        if (error) throw error
        if (!data.session) {
          setMsg('Conta criada. Abra o e-mail de confirmação, toque no link e depois entre aqui com sua senha.')
          setModo('entrar')
        }
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setErro(
        m.includes('Invalid login credentials') ? 'E-mail ou senha incorretos.'
        : m.includes('Email not confirmed') ? 'Confirme o e-mail antes de entrar (veja sua caixa de entrada).'
        : m.includes('Password should be') ? 'A senha precisa ter pelo menos 6 caracteres.'
        : m,
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="tela login">
      <h1>Homefitness</h1>
      <p className="sub">Dieta e saúde da família</p>
      {convite && <FaixaConvite codigo={convite} />}
      <form onSubmit={enviar} className="cartao">
        <label>
          E-mail
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Senha
          <input
            type="password"
            autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </label>
        {erro && <p className="erro">{erro}</p>}
        {msg && <p className="ok">{msg}</p>}
        <button type="submit" className="primario" disabled={enviando}>
          {enviando ? 'Aguarde…' : modo === 'entrar' ? 'Entrar' : 'Criar conta'}
        </button>
        <button type="button" className="link" onClick={() => setModo(modo === 'entrar' ? 'criar' : 'entrar')}>
          {modo === 'entrar' ? 'Primeira vez? Criar conta' : 'Já tenho conta'}
        </button>
      </form>
      <p className="dica">
        Depois de entrar uma vez, o app abre direto. No iPhone, toque em Compartilhar e “Adicionar à Tela de Início”; no
        Android, no menu ⋮ do Chrome, toque em “Instalar app”.
      </p>
    </div>
  )
}
