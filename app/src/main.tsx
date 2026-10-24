import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { guardarConvitePendente, lerConviteDaUrl } from './familia'
import { ouvirInstalacao } from './plataforma'
import './styles.css'

registerSW({ immediate: true })
ouvirInstalacao()
// Link de convite: guarda o código até a pessoa entrar ou criar a conta.
const convite = lerConviteDaUrl()
if (convite) guardarConvitePendente(convite)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
