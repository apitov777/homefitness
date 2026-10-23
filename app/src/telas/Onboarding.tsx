import { useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { erroTexto } from '../dados'

export default function Onboarding({ onPronto }: { onPronto: () => void }) {
  const [familia, setFamilia] = useState('Nossa casa')
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function criar(ev: FormEvent) {
    ev.preventDefault()
    setEnviando(true)
    setErro(null)
    const { error } = await supabase.rpc('criar_familia', { p_nome_familia: familia, p_nome_pessoa: nome })
    setEnviando(false)
    if (error) setErro(erroTexto(error))
    else onPronto()
  }

  return (
    <div className="tela">
      <h1>Bem-vindo</h1>
      <p>
        Crie a família para começar. Depois, em Perfil, você cadastra a outra pessoa e o e-mail dela; quando ela criar a
        conta com esse e-mail, entra direto na família.
      </p>
      <p className="dica">
        Recebeu um convite? Use o mesmo e-mail do convite e toque em{' '}
        <button type="button" className="link inline" onClick={onPronto}>verificar convite</button>.
      </p>
      <form onSubmit={criar} className="cartao">
        <label>
          Seu nome
          <input required value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>
        <label>
          Nome da família
          <input required value={familia} onChange={(e) => setFamilia(e.target.value)} />
        </label>
        {erro && <p className="erro">{erro}</p>}
        <button className="primario" disabled={enviando}>Criar família</button>
        <button type="button" className="link" onClick={() => supabase.auth.signOut()}>Sair</button>
      </form>
    </div>
  )
}
