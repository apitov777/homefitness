import { describe, expect, it } from 'vitest'
import { lerRotulo } from './rotulo'

describe('lerRotulo', () => {
  it('rótulo novo: usa a coluna de 100 g e a da porção', () => {
    const l = lerRotulo(`INFORMAÇÃO NUTRICIONAL
Porções por embalagem: 10
Porção: 30 g (1 xícara)
100 g 30 g %VD*
Valor energético (kcal) 380 114 6
Carboidratos (g) 60 18 6
Açúcares totais (g) 5,0 1,5
Açúcares adicionados (g) 2,0 0,6 1
Proteínas (g) 12 3,6 7
Gorduras totais (g) 8,5 2,6 4
Gorduras saturadas (g) 1,5 0,5 2
Gorduras trans (g) 0 0 0
Fibras alimentares (g) 9,0 2,7 11
Sódio (mg) 250 75 4`)
    expect(l.porcaoG).toBe(30)
    expect(l.porcaoMedida).toBe('1 xícara')
    expect(l.por100).toEqual({
      energia: 380, carboidrato: 60, acucar: 5, proteina: 12, gordura: 8.5, gordura_saturada: 1.5, fibra: 9, sodio: 250,
    })
    expect(l.porPorcao.energia).toBe(114)
    expect(l.porPorcao.sodio).toBe(75)
  })

  it('rótulo antigo: só a porção, ignora kJ e %VD', () => {
    const l = lerRotulo(`INFORMAÇÃO NUTRICIONAL
Porção de 200 ml (1 copo)
Quantidade por porção %VD(*)
Valor energético 120 kcal = 504 kJ 6%
Carboidratos 10 g 3%
Proteínas 6,2 g 8%
Gorduras totais 6,0 g 11%
Gorduras saturadas 3,8 g 17%
Gorduras trans 0 g **
Fibra alimentar 0 g 0%
Sódio 100 mg 4%
Cálcio 240 mg 24%`)
    expect(l.porcaoG).toBe(200)
    expect(l.porcaoMedida).toBe('1 copo')
    expect(l.por100).toEqual({})
    expect(l.porPorcao).toEqual({
      energia: 120, carboidrato: 10, proteina: 6.2, gordura: 6, gordura_saturada: 3.8, fibra: 0, sodio: 100, calcio: 240,
    })
  })

  it('texto de OCR de verdade: "(9)" no lugar de "(g)" e "100g 309" no cabeçalho', () => {
    const l = lerRotulo(`INFORMAÇÃO NUTRICIONAL

Porção: 30 g (1 xícara)

100g 309 %VD*

Valor energético (kcal) 380 114 6
Carboidratos (9) 60 18 6
Açúcares totais (9) 5,0 1,5

Açúcares adicionados (g) 2,0 0,6 1
Proteínas (9) 12 3,6 7
Gorduras totais (9) 8,5 2,6 4
Gorduras saturadas (9) 1,5 0,5 2
Gorduras trans (9) (o) () (o)
Fibras alimentares (g) 9,0 2,7 11
Sódio (mg) 250 75 4`)
    expect(l.por100).toEqual({
      energia: 380, carboidrato: 60, acucar: 5, proteina: 12, gordura: 8.5, gordura_saturada: 1.5, fibra: 9, sodio: 250,
    })
    expect(l.porPorcao.carboidrato).toBe(18)
  })

  it('aguenta o "O,5" do OCR e linhas que não são da tabela', () => {
    const l = lerRotulo(`Ingredientes: aveia, açúcar
Porção 40g (4 colheres de sopa)
Valor energético 150 kcal
Proteínas O,5 g
Fibra alimentar 4,1 g`)
    expect(l.porcaoG).toBe(40)
    expect(l.porPorcao.proteina).toBe(0.5)
    expect(l.porPorcao.fibra).toBe(4.1)
    expect(l.porPorcao.acucar).toBeUndefined()
  })
})
