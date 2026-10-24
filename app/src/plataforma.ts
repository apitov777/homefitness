// O que muda entre iPhone e Android: instalação, agenda de contatos e compartilhamento.

export function ehIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function ehAndroid(): boolean {
  return /Android/.test(navigator.userAgent)
}

export function instalado(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

// Android (Chrome, Edge, Samsung Internet) oferece a instalação por este evento; guardamos para o botão.
interface PedidoInstalacao extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let pedido: PedidoInstalacao | null = null
const ouvintes = new Set<() => void>()

export function ouvirInstalacao() {
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault()
    pedido = ev as PedidoInstalacao
    ouvintes.forEach((f) => f())
  })
  window.addEventListener('appinstalled', () => {
    pedido = null
    ouvintes.forEach((f) => f())
  })
}

export function aoMudarInstalacao(f: () => void): () => void {
  ouvintes.add(f)
  return () => ouvintes.delete(f)
}

export type EstadoInstalacao = 'instalado' | 'botao' | 'ios' | 'android_menu' | 'outro'

export function estadoInstalacao(): EstadoInstalacao {
  if (instalado()) return 'instalado'
  if (pedido) return 'botao'
  if (ehIOS()) return 'ios'
  if (ehAndroid()) return 'android_menu'
  return 'outro'
}

export async function instalar(): Promise<boolean> {
  if (!pedido) return false
  await pedido.prompt()
  const { outcome } = await pedido.userChoice
  pedido = null
  ouvintes.forEach((f) => f())
  return outcome === 'accepted'
}

// Contact Picker: existe no Chrome do Android; no iPhone fica desligado no Safari.
interface ContatoEscolhido { name?: string[]; email?: string[] }
interface Agenda { select: (campos: string[], opcoes: { multiple: boolean }) => Promise<ContatoEscolhido[]> }

export function podeEscolherContato(): boolean {
  return 'contacts' in navigator && 'ContactsManager' in window
}

export async function escolherContato(): Promise<{ nome: string; email: string } | null> {
  const agenda = (navigator as unknown as { contacts: Agenda }).contacts
  const [c] = await agenda.select(['name', 'email'], { multiple: false })
  if (!c) return null
  return { nome: c.name?.[0] ?? '', email: c.email?.[0] ?? '' }
}

/** Abre a folha de compartilhar do celular (iMessage, WhatsApp…). Sem ela, copia o texto. */
export async function compartilhar(titulo: string, texto: string, url?: string): Promise<'enviado' | 'copiado' | 'cancelado'> {
  if (navigator.share) {
    try {
      await navigator.share(url ? { title: titulo, text: texto, url } : { title: titulo, text: texto })
      return 'enviado'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelado'
    }
  }
  await navigator.clipboard.writeText(url ? `${texto}\n${url}` : texto)
  return 'copiado'
}
