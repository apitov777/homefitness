// Lê a foto da tabela nutricional no próprio celular (Tesseract, em português) e passa o texto para lerRotulo.
// O Tesseract (≈ 2 MB de código e 1 MB do idioma) só baixa na primeira foto, e o navegador guarda.
import { lerRotulo, type LeituraRotulo } from './rotulo'

/** Reduz a foto (fotos de 12 MP deixam o OCR lento sem ganhar leitura) e passa para tons de cinza. */
async function preparar(arquivo: File): Promise<HTMLCanvasElement> {
  const img = await createImageBitmap(arquivo)
  const escala = Math.min(1, 2000 / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * escala)
  c.height = Math.round(img.height * escala)
  const g = c.getContext('2d')!
  g.filter = 'grayscale(1) contrast(1.3)'
  g.drawImage(img, 0, 0, c.width, c.height)
  img.close()
  return c
}

export async function lerFotoRotulo(
  arquivo: File,
  progresso: (texto: string) => void,
): Promise<{ texto: string; rotulo: LeituraRotulo }> {
  progresso('Preparando a foto…')
  const imagem = await preparar(arquivo)
  progresso('Carregando o leitor…')
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('por', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') progresso(`Lendo o rótulo… ${Math.round(m.progress * 100)}%`)
    },
  })
  try {
    const { data } = await worker.recognize(imagem)
    return { texto: data.text, rotulo: lerRotulo(data.text) }
  } finally {
    await worker.terminate()
  }
}
