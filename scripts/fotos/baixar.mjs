// Baixa uma foto livre por receita do Wikimedia Commons e guarda em app/public/fotos/<slug>.jpg,
// com o crédito em app/public/fotos/creditos.json. Roda no GitHub Actions (fotos.yml).
//   node baixar.mjs                  baixa só o que falta
//   node baixar.mjs --refazer=a,b    refaz esses slugs (ou --refazer=todos)
// Em receitas.json, "escolha": N usa o N-ésimo candidato (1 a 4) e "arquivo": "File:X.jpg" fixa um arquivo.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const destino = path.join(raiz, 'app/public/fotos')
const aqui = path.join(raiz, 'scripts/fotos')
const itens = JSON.parse(await readFile(path.join(aqui, 'receitas.json'), 'utf8'))
const arg = process.argv.find((a) => a.startsWith('--refazer='))?.slice(10) ?? ''
const refazer = arg === 'todos' ? null : new Set(arg.split(',').filter(Boolean))
const UA = 'homefitness-fotos/1.0 (https://github.com/apitov777/homefitness; app pessoal de receitas)'
const API = 'https://commons.wikimedia.org/w/api.php'

async function api(params) {
  const u = new URL(API)
  for (const [k, v] of Object.entries({ format: 'json', origin: '*', ...params })) u.searchParams.set(k, v)
  const r = await fetch(u, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`${r.status} ${u}`)
  return r.json()
}

function candidatosDe(pages) {
  return Object.values(pages ?? {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => {
      const ii = p.imageinfo?.[0]
      if (!ii) return null
      const m = ii.extmetadata ?? {}
      const lic = m.LicenseShortName?.value ?? ''
      if (!/jpeg|png/.test(ii.mime ?? '') || ii.width < 600 || ii.height < 400) return null
      if (ii.width / ii.height > 2.2 || ii.height / ii.width > 1.6) return null
      if (/fair/i.test(lic)) return null
      return {
        titulo: p.title, url: ii.thumburl ?? ii.url, pagina: ii.descriptionurl,
        autor: (m.Artist?.value ?? '').replace(/<[^>]+>/g, '').trim().slice(0, 80) || 'autor não informado',
        licenca: lic || 'ver página', largura: ii.width, altura: ii.height,
      }
    })
    .filter(Boolean)
}

async function buscar(termo) {
  const j = await api({
    action: 'query', generator: 'search', gsrsearch: `${termo} filetype:bitmap`, gsrnamespace: 6, gsrlimit: 12,
    prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: 1200, iiextmetadatafilter: 'LicenseShortName|Artist',
  })
  return candidatosDe(j.query?.pages)
}

async function porArquivo(titulo) {
  const j = await api({ action: 'query', titles: titulo, prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: 1200, iiextmetadatafilter: 'LicenseShortName|Artist' })
  return candidatosDe(j.query?.pages)
}

async function baixarImagem(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return Buffer.from(await r.arrayBuffer())
}

const existe = (f) => access(f).then(() => true, () => false)
await mkdir(destino, { recursive: true })
const creditosArq = path.join(destino, 'creditos.json')
const creditos = (await existe(creditosArq)) ? JSON.parse(await readFile(creditosArq, 'utf8')) : {}
const candidatosTodos = {}
const thumbs = []

for (const it of itens) {
  const arq = path.join(destino, `${it.slug}.jpg`)
  const pular = (await existe(arq)) && refazer !== null && !refazer.has(it.slug)
  let cands = []
  try {
    if (it.arquivo) cands = await porArquivo(it.arquivo)
    for (const termo of it.busca) {
      if (cands.length >= 4) break
      const mais = await buscar(termo)
      for (const c of mais) if (!cands.some((x) => x.titulo === c.titulo)) cands.push(c)
    }
  } catch (e) {
    console.log(`! ${it.slug}: ${e.message}`)
  }
  cands = cands.slice(0, 4)
  candidatosTodos[it.slug] = cands.map((c) => c.titulo)
  const escolhido = cands[(it.escolha ?? 1) - 1] ?? cands[0]
  if (!pular && escolhido) {
    try {
      const img = await baixarImagem(escolhido.url)
      await sharp(img).rotate().resize(800, 600, { fit: 'cover', position: 'attention' }).jpeg({ quality: 80, mozjpeg: true }).toFile(arq)
      creditos[it.slug] = { titulo: escolhido.titulo.replace(/^File:/, ''), autor: escolhido.autor, licenca: escolhido.licenca, pagina: escolhido.pagina }
      console.log(`✓ ${it.slug}: ${escolhido.titulo} (${escolhido.licenca})`)
    } catch (e) {
      console.log(`! ${it.slug}: ${e.message}`)
    }
  } else if (!escolhido) {
    console.log(`? ${it.slug}: nenhum candidato`)
  }
  // Miniaturas dos candidatos para a folha de contato.
  for (let i = 0; i < 4; i++) {
    const c = cands[i]
    let buf = null
    if (c) {
      try { buf = await sharp(await baixarImagem(c.url)).rotate().resize(180, 135, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer() } catch { buf = null }
    }
    thumbs.push({ slug: it.slug, i, buf })
  }
  await new Promise((r) => setTimeout(r, 300))
}

await writeFile(creditosArq, JSON.stringify(creditos, null, 1))
await writeFile(path.join(aqui, 'candidatos.json'), JSON.stringify(candidatosTodos, null, 1))

// Folhas de contato: 22 receitas por folha, 4 candidatos por linha, para conferir e escolher.
const porFolha = 22
for (let f = 0; f * porFolha < itens.length; f++) {
  const grupo = itens.slice(f * porFolha, (f + 1) * porFolha)
  const altura = grupo.length * 140
  const comps = []
  grupo.forEach((it, linha) => {
    const y = linha * 140
    const rotulo = Buffer.from(`<svg width="200" height="140"><text x="6" y="60" font-size="13" font-family="sans-serif" font-weight="bold">${it.slug.slice(0, 26)}</text><text x="6" y="80" font-size="12" font-family="sans-serif">${(it.nome).replace(/&/g, '&amp;').replace(/</g, '&lt;').slice(0, 28)}</text></svg>`)
    comps.push({ input: rotulo, left: 0, top: y })
    for (let i = 0; i < 4; i++) {
      const t = thumbs.find((x) => x.slug === it.slug && x.i === i)
      if (t?.buf) comps.push({ input: t.buf, left: 200 + i * 185, top: y })
      const num = Buffer.from(`<svg width="22" height="22"><rect width="22" height="22" fill="black" opacity="0.6"/><text x="6" y="16" font-size="14" fill="white" font-family="sans-serif">${i + 1}</text></svg>`)
      comps.push({ input: num, left: 200 + i * 185, top: y })
    }
  })
  await sharp({ create: { width: 940, height: altura, channels: 3, background: '#ffffff' } }).composite(comps).jpeg({ quality: 75 }).toFile(path.join(aqui, `contato-${f + 1}.jpg`))
}
console.log('pronto')
