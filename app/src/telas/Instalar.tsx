import { useEffect, useState } from 'react'
import { aoMudarInstalacao, estadoInstalacao, instalar } from '../plataforma'

const DISPENSADO = 'instalar_dispensado'

function dispensado(): boolean {
  try { return localStorage.getItem(DISPENSADO) === '1' } catch { return false }
}

/** Como pôr o app na tela inicial: botão no Android, passo a passo no iPhone. */
export default function CartaoInstalar({ dispensavel = false }: { dispensavel?: boolean }) {
  const [estado, setEstado] = useState(estadoInstalacao)
  const [fechado, setFechado] = useState(() => dispensavel && dispensado())
  useEffect(() => aoMudarInstalacao(() => setEstado(estadoInstalacao())), [])

  if (estado === 'instalado' || fechado || (dispensavel && estado === 'outro')) return null

  function fechar() {
    try { localStorage.setItem(DISPENSADO, '1') } catch { /* modo privado */ }
    setFechado(true)
  }

  return (
    <section className="cartao instalar">
      <div className="instalar-topo">
        <h2>Instale o app no celular</h2>
        {dispensavel && <button className="apagar" aria-label="Fechar" onClick={fechar}>×</button>}
      </div>
      {estado === 'botao' && (
        <>
          <p className="dica">Fica na tela inicial, abre em tela cheia e recebe os avisos das refeições.</p>
          <button className="primario" onClick={() => instalar()}>Instalar o app</button>
        </>
      )}
      {estado === 'ios' && (
        <ol className="passos">
          <li>No Safari, toque em <strong>Compartilhar</strong> (o quadrado com a seta para cima).</li>
          <li>Toque em <strong>Adicionar à Tela de Início</strong>.</li>
          <li>Abra pelo ícone e entre com o mesmo e-mail. Os avisos do iPhone só funcionam assim.</li>
        </ol>
      )}
      {estado === 'android_menu' && (
        <ol className="passos">
          <li>No Chrome, toque no menu <strong>⋮</strong>.</li>
          <li>Toque em <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.</li>
        </ol>
      )}
      {estado === 'outro' && (
        <p className="dica">Abra este endereço no celular: no iPhone pelo Safari, no Android pelo Chrome.</p>
      )}
    </section>
  )
}
