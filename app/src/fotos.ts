// Fotos das receitas: as do catálogo são arquivos do app (fotos/<slug>.jpg, com crédito em fotos/creditos.json);
// as da família ficam no bucket privado "fotos" do Storage e abrem por URL assinada.
import { supabase } from './supabase'

export interface Credito { titulo: string; autor: string; licenca: string; pagina: string }

const BASE = import.meta.env.BASE_URL as string

/** URL de uma foto do catálogo (arquivo do app) ou nulo quando a foto está no Storage. */
export function fotoEstatica(foto: string | null | undefined): string | null {
  return foto?.startsWith('fotos/') ? BASE + foto : null
}

export function fotoNoStorage(foto: string | null | undefined): boolean {
  return !!foto && !foto.startsWith('fotos/')
}

/** URLs assinadas (1 h) das fotos da família; as do catálogo não precisam. */
export async function urlsDasFotos(fotos: (string | null)[]): Promise<Map<string, string>> {
  const caminhos = [...new Set(fotos.filter((f): f is string => fotoNoStorage(f)))]
  const mapa = new Map<string, string>()
  if (!caminhos.length) return mapa
  const { data, error } = await supabase.storage.from('fotos').createSignedUrls(caminhos, 3600)
  if (error) throw error
  for (const d of data) if (d.signedUrl && d.path) mapa.set(d.path, d.signedUrl)
  return mapa
}

let cacheCreditos: Record<string, Credito> | null = null
export async function carregarCreditos(): Promise<Record<string, Credito>> {
  if (cacheCreditos) return cacheCreditos
  try {
    const r = await fetch(BASE + 'fotos/creditos.json')
    cacheCreditos = r.ok ? ((await r.json()) as Record<string, Credito>) : {}
  } catch {
    cacheCreditos = {}
  }
  return cacheCreditos
}

export function creditoDe(foto: string | null | undefined, creditos: Record<string, Credito>): Credito | null {
  const m = foto?.match(/^fotos\/(.+)\.jpg$/)
  return m ? creditos[m[1]] ?? null : null
}

/** Reduz a foto do celular para no máximo `lado` px e JPEG, antes de subir. */
export async function reduzirFoto(arquivo: Blob, lado = 1200): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo)
  const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * escala)
  canvas.height = Math.round(bitmap.height * escala)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('não deu para converter a foto'))), 'image/jpeg', 0.82))
}

/** Sobe a foto da receita da família e grava o caminho em receita.foto. Devolve o caminho. */
export async function enviarFotoReceita(familiaId: string, receitaId: string, arquivo: Blob): Promise<string> {
  const caminho = `${familiaId}/${receitaId}.jpg`
  const pequena = await (await reduzirFoto(arquivo)).arrayBuffer()
  const { error } = await supabase.storage.from('fotos').upload(caminho, pequena, { contentType: 'image/jpeg', upsert: true })
  if (error) throw error
  await definirFoto(receitaId, caminho)
  return caminho
}

export async function definirFoto(receitaId: string, foto: string | null): Promise<void> {
  const { error } = await supabase.from('receita').update({ foto }).eq('id', receitaId)
  if (error) throw error
}

/** Tira a foto da receita da família (apaga do Storage quando for de lá). */
export async function removerFotoReceita(receitaId: string, foto: string | null): Promise<void> {
  if (fotoNoStorage(foto)) {
    const { error } = await supabase.storage.from('fotos').remove([foto!])
    if (error) throw error
  }
  await definirFoto(receitaId, null)
}
