import { useEffect, useState, type FormEvent } from 'react'
import { erroTexto } from '../dados'
import { aceitarConvite, esquecerConvitePendente, PAPEIS, verConvite, type ConviteInfo } from '../familia'

function useConvite(codigo: string) {
  const [info, setInfo] = useState<ConviteInfo | null | undefined>(undefined)
  useEffect(() => {
    verConvite(codigo).then(setInfo).catch(() => setInfo(null))
  }, [codigo])
  return info
}

function textoSituacao(info: ConviteInfo | null): string | null {
  if (!info) return 'Convite não encontrado. Confira o código ou peça um novo.'
  if (info.situacao === 'usado') return 'Este convite já foi usado. Peça um novo para quem convidou.'
  if (info.situacao === 'expirado') return 'Este convite expirou. Peça um novo para quem convidou.'
  return null
}

/** Faixa na tela de login de quem abriu o link sem conta. */
export function FaixaConvite({ codigo }: { codigo: string }) {
  const info = useConvite(codigo)
  if (info === undefined) return null
  const problema = textoSituacao(info)
  return (
    <section className="cartao destaque-convite">
      {problema ? <p>{problema}</p> : (
        <>
          <p>
            <strong>{info!.convidado_por ?? 'Alguém'}</strong> convidou você para a família <strong>{info!.familia}</strong>.
          </p>
          <p className="dica">
            Crie sua conta (ou entre, se já tiver){info!.para_email ? ' com o e-mail que recebeu o convite' : ''} para aceitar.
          </p>
        </>
      )}
    </section>
  )
}

/** Depois de entrar: mostra o convite e aceita. Ao aceitar, o app monta o espaço da pessoa. */
export default function TelaConvite({ codigo, temFamilia, onPronto, onFechar }: {
  codigo: string
  temFamilia: boolean
  onPronto: () => void
  onFechar: () => void
}) {
  const info = useConvite(codigo)
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (info?.nome) setNome(info.nome)
  }, [info])

  function fechar() {
    esquecerConvitePendente()
    onFechar()
  }

  async function aceitar(ev: FormEvent) {
    ev.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      await aceitarConvite(codigo, temFamilia ? undefined : nome)
      esquecerConvitePendente()
      onPronto()
    } catch (e) {
      setErro(erroTexto(e))
      setEnviando(false)
    }
  }

  if (info === undefined) return <div className="carregando">Carregando convite…</div>
  const problema = textoSituacao(info)

  return (
    <div className="tela convite">
      <div className="convite-icone" aria-hidden>⌂</div>
      {problema ? (
        <>
          <h1>Convite</h1>
          <p>{problema}</p>
          <button className="primario" onClick={fechar}>Continuar</button>
        </>
      ) : (
        <form onSubmit={aceitar}>
          <h1>Entrar na família {info!.familia}</h1>
          <p>
            {info!.convidado_por ?? 'Alguém'} convidou você para a família, como {PAPEIS[info!.papel].nome.toLowerCase()}.
            Você ganha o seu espaço no app, com a sua meta, o seu plano de refeições e os seus avisos.
          </p>
          <ul className="compartilha">
            <li><strong>A família vê</strong><span>Suas refeições, plano e metas, como no app de cada um.</span></li>
            <li><strong>Só você vê</strong><span>Seus exames, até você escolher compartilhar.</span></li>
          </ul>
          {temFamilia ? (
            <p className="aviso">
              Você já está em uma família. Se só você tem login nela, ela inteira vem junto (dependentes, alimentos e refeições).
              Se divide com mais gente, você sai de lá levando os seus dados.
            </p>
          ) : (
            <label>Seu nome<input required value={nome} onChange={(e) => setNome(e.target.value)} /></label>
          )}
          {erro && <p className="erro">{erro}</p>}
          <button className="primario" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar na família'}</button>
          <button type="button" className="link" onClick={fechar}>Agora não</button>
        </form>
      )}
    </div>
  )
}
