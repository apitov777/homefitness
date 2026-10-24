// Família no estilo do iCloud: papéis, convites por link/código/QR e e-mail, entrar, sair e remover.
import { supabase } from './supabase'

export type Papel = 'organizador' | 'responsavel' | 'adulto' | 'crianca'

export const PAPEIS: Record<Papel, { nome: string; descricao: string }> = {
  organizador: { nome: 'Organizador', descricao: 'Convida e remove pessoas, muda os papéis e o nome da família.' },
  responsavel: { nome: 'Responsável', descricao: 'Convida pessoas e cuida das crianças e dependentes.' },
  adulto: { nome: 'Adulto', descricao: 'Usa o app com os próprios dados e vê o que a família compartilha.' },
  crianca: { nome: 'Criança', descricao: 'Tem login próprio; os adultos acompanham as refeições e metas.' },
}

export const DEPENDENTE = { nome: 'Dependente', descricao: 'Sem login: a família registra por ela.' }

export function gerencia(papel: Papel | undefined): boolean {
  return papel === 'organizador' || papel === 'responsavel'
}

export interface Membro { user_id: string; papel: Papel; email: string; desde: string }

export interface Convite {
  id: string
  codigo: string
  email: string | null
  nome: string | null
  papel: Exclude<Papel, 'organizador'>
  pessoa_id: string | null
  expira_em: string
  created_at: string
}

export interface ConviteInfo {
  familia: string
  convidado_por: string | null
  nome: string | null
  papel: Papel
  para_email: boolean
  situacao: 'valido' | 'usado' | 'expirado'
}

export interface ConviteRecebido { codigo: string; familia: string; convidado_por: string | null; papel: Papel }

function falhou(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

export async function carregarMembros(): Promise<Membro[]> {
  const { data, error } = await supabase.rpc('membros_da_familia')
  falhou(error)
  return data as Membro[]
}

export async function carregarConvites(familiaId: string): Promise<Convite[]> {
  const { data, error } = await supabase
    .from('familia_convite')
    .select('id, codigo, email, nome, papel, pessoa_id, expira_em, created_at')
    .eq('familia_id', familiaId)
    .is('aceito_em', null)
    .is('recusado_em', null)
    .gte('expira_em', new Date().toISOString())
    .order('created_at')
  falhou(error)
  return data as Convite[]
}

export async function criarConvite(c: {
  familiaId: string
  nome?: string
  email?: string
  papel: Convite['papel']
  pessoaId?: string
}): Promise<Convite> {
  const email = c.email?.trim().toLowerCase() || null
  if (email) {
    // Mandar de novo para o mesmo e-mail troca o convite anterior.
    const { error } = await supabase.from('familia_convite').delete()
      .eq('familia_id', c.familiaId).eq('email', email).is('aceito_em', null)
    falhou(error)
  }
  const { data, error } = await supabase
    .from('familia_convite')
    .insert({
      familia_id: c.familiaId,
      nome: c.nome?.trim() || null,
      email,
      papel: c.papel,
      pessoa_id: c.pessoaId ?? null,
    })
    .select('id, codigo, email, nome, papel, pessoa_id, expira_em, created_at')
    .single()
  falhou(error)
  return data as Convite
}

/** Mais 7 dias de validade. */
export async function renovarConvite(id: string): Promise<void> {
  const expira = new Date(Date.now() + 7 * 86400000).toISOString()
  const { error } = await supabase.from('familia_convite').update({ expira_em: expira }).eq('id', id)
  falhou(error)
}

export async function cancelarConvite(id: string): Promise<void> {
  const { error } = await supabase.from('familia_convite').delete().eq('id', id)
  falhou(error)
}

export function formatarCodigo(c: string): string {
  return c.length === 10 ? `${c.slice(0, 5)}-${c.slice(5)}` : c
}

export function linkConvite(codigo: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}?convite=${codigo}`
}

export function textoConvite(familia: string, de: string | undefined, codigo: string): string {
  return `${de ? `${de} convidou você` : 'Você foi convidado'} para a família “${familia}” no Homefitness. ` +
    `Toque no link para entrar (ou use o código ${formatarCodigo(codigo)}):`
}

export async function verConvite(codigo: string): Promise<ConviteInfo | null> {
  const { data, error } = await supabase.rpc('ver_convite', { p_codigo: codigo })
  falhou(error)
  return (data as ConviteInfo[])[0] ?? null
}

export async function aceitarConvite(codigo: string, nome?: string): Promise<void> {
  const { error } = await supabase.rpc('aceitar_convite', { p_codigo: codigo, p_nome: nome?.trim() || null })
  falhou(error)
}

export async function meusConvites(): Promise<ConviteRecebido[]> {
  const { data, error } = await supabase.rpc('meus_convites')
  falhou(error)
  return data as ConviteRecebido[]
}

export async function recusarConvite(codigo: string): Promise<void> {
  const { error } = await supabase.rpc('recusar_convite', { p_codigo: codigo })
  falhou(error)
}

export async function sairDaFamilia(): Promise<void> {
  const { error } = await supabase.rpc('sair_da_familia')
  falhou(error)
}

export async function removerMembro(userId: string): Promise<void> {
  const { error } = await supabase.rpc('remover_membro', { p_user: userId })
  falhou(error)
}

export async function mudarPapel(userId: string, papel: Papel): Promise<void> {
  const { error } = await supabase.rpc('mudar_papel', { p_user: userId, p_papel: papel })
  falhou(error)
}

export async function transferirOrganizador(userId: string): Promise<void> {
  const { error } = await supabase.rpc('transferir_organizador', { p_user: userId })
  falhou(error)
}

// Convite aberto pelo link: guardado até a pessoa entrar ou criar a conta.
const CHAVE = 'convite_pendente'

export function lerConviteDaUrl(): string | null {
  const url = new URL(window.location.href)
  const codigo = url.searchParams.get('convite')
  if (!codigo) return null
  url.searchParams.delete('convite')
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  return codigo
}

export function guardarConvitePendente(codigo: string) {
  try { localStorage.setItem(CHAVE, codigo) } catch { /* modo privado */ }
}

export function convitePendente(): string | null {
  try { return localStorage.getItem(CHAVE) } catch { return null }
}

export function esquecerConvitePendente() {
  try { localStorage.removeItem(CHAVE) } catch { /* modo privado */ }
}

/** Cor fixa por pessoa para o avatar com as iniciais. */
const CORES = ['#2f6b4f', '#2c5d8a', '#8a4b2c', '#6b3f8a', '#8a2c55', '#4f6b2f', '#2c7a8a']

export function corAvatar(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return CORES[h % CORES.length]
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return '?'
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase()
}
