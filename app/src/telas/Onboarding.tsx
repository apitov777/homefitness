import { useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { erroTexto } from '../dados'

export default function Onboarding({ onPronto, onConvite }: { onPronto: () => void; onConvite: (codigo: string) => void }) {
  const [codigo, setCodigo] = useState('')
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
      <h1>Boas-vindas</h1>
      <form
        className="cartao"
        onSubmit={(ev) => { ev.preventDefault(); onConvite(codigo) }}
      >
        <h2>Tenho um convite</h2>
        <p className="dica">Digite o código que veio no convite, ou abra o link que recebeu.</p>
        <div className="linha alinhada">
          <input
            aria-label="Código do convite"
            placeholder="XXXXX-XXXXX"
            autoCapitalize="characters"
            autoComplete="off"
            required
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
          />
          <button>Ver convite</button>
        </div>
        <button type="button" className="link" onClick={onPronto}>Meu convite veio por e-mail</button>
      </form>
      <p>
        Ou crie a sua família. Depois, em Perfil › Família, você convida as pessoas da casa por link, QR code ou e-mail.
      </p>
      <form onSubmit={criar} className="cartao">
        <h2>Criar família</h2>
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
