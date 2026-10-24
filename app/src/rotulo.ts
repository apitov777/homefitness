// Lê o texto da tabela nutricional (vindo do OCR da foto do rótulo) e tira dele os números.
// Rótulo novo (RDC 429/2020): colunas "100 g | porção | %VD". Rótulo antigo: só a porção e o %VD.
// Nada aqui é estimado: o que não foi lido fica em branco para a pessoa preencher.

export type CampoRotulo =
  | 'energia' | 'carboidrato' | 'acucar' | 'proteina' | 'gordura' | 'gordura_saturada' | 'fibra' | 'sodio' | 'calcio' | 'ferro'

export interface LeituraRotulo {
  /** Porção do rótulo em g ou mL, se foi lida. */
  porcaoG: number | null
  /** Medida caseira da porção, como "1 xícara" ou "2 fatias". */
  porcaoMedida: string | null
  /** Valores por 100 g (rótulo novo) — preferidos, porque arredondam menos. */
  por100: Partial<Record<CampoRotulo, number>>
  /** Valores por porção. */
  porPorcao: Partial<Record<CampoRotulo, number>>
}

// A ordem importa: "açúcares" antes de "carboidratos" e "saturadas" antes de "gorduras totais".
const LINHAS: { campo: CampoRotulo; re: RegExp }[] = [
  { campo: 'energia', re: /valor\s*energ|energia/ },
  { campo: 'acucar', re: /a[cç][uú]car(es)?\s*(totais|total)?(?!\s*adicion)/ },
  { campo: 'carboidrato', re: /carboidrat/ },
  { campo: 'proteina', re: /prote[ií]n/ },
  { campo: 'gordura_saturada', re: /saturad/ },
  { campo: 'gordura', re: /gorduras?\s*tota|lip[ií]dio|^gorduras?\b(?!.*(trans|satur|mono|poli))/ },
  { campo: 'fibra', re: /fibra/ },
  { campo: 'sodio', re: /s[oó]dio/ },
  { campo: 'calcio', re: /c[aá]lcio/ },
  { campo: 'ferro', re: /\bferro\b/ },
]

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function lerNum(s: string): number {
  // "1.234,5" -> 1234.5; "12,5" -> 12.5; "0.5" -> 0.5
  const t = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  return Number(t)
}

/** Números da linha, sem os de %VD ("6%"), sem o kJ e sem o "(g)"/"(mg)" da unidade. */
function numerosDaLinha(linha: string, campo: CampoRotulo): number[] {
  let l = semAcento(linha)
    .replace(/\b[o0]\s*(?=[,.]\d)/g, '0') // OCR troca 0 por O em "O,5"
    // a unidade entre parênteses logo depois do nome: "(g)", "(mg)", "(kcal)" e o "(9)" que o OCR faz do "(g)"
    .replace(/\(\s*[a-z0-9µ]{1,4}\s*\)/, ' ')
  if (campo === 'energia') {
    // "114 kcal = 479 kJ" -> só o kcal; "(kcal) 380 114" (rótulo novo) já ficou sem unidade.
    l = l.replace(/[\d.,]+\s*k\s*j\b/g, ' ')
  }
  const nums: number[] = []
  const re = /(\d+(?:[.,]\d+)*)\s*(%)?/g
  for (let m = re.exec(l); m; m = re.exec(l)) {
    if (m[2]) continue
    const v = lerNum(m[1])
    if (Number.isFinite(v)) nums.push(v)
  }
  return nums
}

export function lerRotulo(texto: string): LeituraRotulo {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const tudo = semAcento(texto)
  const leitura: LeituraRotulo = { porcaoG: null, porcaoMedida: null, por100: {}, porPorcao: {} }

  // "Porção: 30 g (1 xícara)" / "Porção de 200 ml (1 copo)" / "Porcao 25g (2 1/2 colheres de sopa)"
  const mp = tudo.match(/porc[aã]o[^\d\n]{0,12}(\d+(?:[.,]\d+)?)\s*(g|ml)\b\s*(\(([^)\n]{1,40})\))?/)
  if (mp) {
    leitura.porcaoG = lerNum(mp[1])
    if (mp[4]) {
      // devolve a medida com os acentos do texto original
      const i = texto.toLowerCase().indexOf(mp[4].slice(0, 3))
      leitura.porcaoMedida = (i >= 0 ? texto.slice(i, i + mp[4].length) : mp[4]).trim()
    }
  }

  // Rótulo novo: cabeçalho com "100 g" (ou "100 ml") antes da coluna da porção.
  const novo = /\b100\s*(g|ml)\b/.test(tudo.replace(/porc[aã]o[^\n]*/g, ''))

  for (const linha of linhas) {
    const l = semAcento(linha)
    if (/porc[aã]o|%\s*vd|valores?\s*diarios?|informac/.test(l) && !/energ|carbo|prote|gord|sodio|fibra/.test(l)) continue
    if (/adicionad|trans|mono|poli|lactose/.test(l)) continue
    const achou = LINHAS.find((x) => x.re.test(l))
    if (!achou) continue
    if (achou.campo in leitura.porPorcao || achou.campo in leitura.por100) continue
    const nums = numerosDaLinha(linha, achou.campo)
    if (!nums.length) continue
    if (novo && nums.length >= 2) {
      leitura.por100[achou.campo] = nums[0]
      leitura.porPorcao[achou.campo] = nums[1]
    } else if (novo) {
      leitura.por100[achou.campo] = nums[0]
    } else {
      leitura.porPorcao[achou.campo] = nums[0]
    }
  }
  return leitura
}

/** Quantos campos a leitura trouxe (para dizer à pessoa o que conferir). */
export function camposLidos(l: LeituraRotulo): CampoRotulo[] {
  return [...new Set([...Object.keys(l.por100), ...Object.keys(l.porPorcao)])] as CampoRotulo[]
}
