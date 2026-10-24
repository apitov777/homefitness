// Avisos do plano por Web Push. No iPhone só funcionam com o app instalado na Tela de Início (iOS 16.4+).
import { supabase } from './supabase'

export type EstadoAvisos =
  | 'sem_suporte' // navegador sem Push API
  | 'instalar' // iPhone/iPad fora do app instalado
  | 'bloqueado' // permissão negada nos Ajustes
  | 'desligado'
  | 'ligado'

function ehIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function instalado(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

async function inscricaoAtual(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

export async function estadoAvisos(): Promise<EstadoAvisos> {
  if (ehIOS() && !instalado()) return 'instalar'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'sem_suporte'
  if (Notification.permission === 'denied') return 'bloqueado'
  if (Notification.permission !== 'granted') return 'desligado'
  const sub = await inscricaoAtual()
  if (!sub) return 'desligado'
  // O aparelho pode estar gravado para outra pessoa que usou o app nele.
  const { count } = await supabase.from('push_inscricao').select('id', { count: 'exact', head: true }).eq('endpoint', sub.endpoint)
  return count ? 'ligado' : 'desligado'
}

function base64UrlParaBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function nomeAparelho(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Mac/.test(ua)) return 'Mac'
  return 'Navegador'
}

/** Pede permissão (precisa vir de um toque) e grava o aparelho para o usuário logado. */
export async function ligarAvisos(): Promise<void> {
  const permissao = await Notification.requestPermission()
  if (permissao !== 'granted') throw new Error('Sem permissão para avisos. Libere em Ajustes › Notificações › Homefitness.')
  const { data, error } = await supabase.functions.invoke('avisos', { body: { acao: 'chave' } })
  if (error) throw error
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlParaBytes(data.chave) })
  }
  const json = sub.toJSON()
  const { error: e2 } = await supabase.rpc('inscrever_push', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_aparelho: nomeAparelho(),
  })
  if (e2) throw e2
}

export async function desligarAvisos(): Promise<void> {
  const sub = await inscricaoAtual()
  if (!sub) return
  await supabase.from('push_inscricao').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

export async function avisoDeTeste(): Promise<number> {
  const { data, error } = await supabase.functions.invoke('avisos', { body: { acao: 'teste' } })
  if (error) throw error
  return data.enviados as number
}
