# Cálculos nutricionais

Use `scripts/calc_nutricional.py` para rodar tudo isto de forma determinística. Este arquivo explica o que o script faz e as decisões por trás.

## 1. Taxa Metabólica Basal (TMB)

**Mifflin-St Jeor** (padrão da skill; mais precisa que Harris-Benedict para a população atual):

- Homem: `TMB = 10 × peso(kg) + 6,25 × altura(cm) − 5 × idade + 5`
- Mulher: `TMB = 10 × peso(kg) + 6,25 × altura(cm) − 5 × idade − 161`

Se a pessoa souber o percentual de gordura, **Katch-McArdle** tende a ser melhor para quem treina:
`TMB = 370 + 21,6 × massa magra(kg)`, com `massa magra = peso × (1 − %gordura/100)`.

## 2. Gasto energético total (TDEE)

`TDEE = TMB × fator de atividade`

| Nível | Fator | Descrição prática |
|---|---|---|
| Sedentário | 1,2 | Trabalho sentado, pouco ou nenhum exercício |
| Leve | 1,375 | Exercício leve 1–3×/semana |
| Moderado | 1,55 | Exercício moderado 3–5×/semana |
| Ativo | 1,725 | Exercício intenso 6–7×/semana |
| Muito ativo | 1,9 | Treino pesado diário ou trabalho físico |

Pessoas tendem a superestimar o próprio nível. Na dúvida, comece um degrau abaixo e ajuste pela balança depois de 2–3 semanas.

## 3. Meta calórica por objetivo

| Objetivo | Ajuste sobre o TDEE | Observação |
|---|---|---|
| Manter | 0 | — |
| Perder gordura (moderado) | −15% a −20% | Ritmo ≈ 0,5% do peso/semana; preserva massa magra |
| Perder gordura (lento) | −10% | Para quem já é magro ou tem pouco a perder |
| Ganhar massa | +10% a +15% | Ganho mais rápido vira gordura |
| Saúde geral / recomposição | 0 a −10% com proteína alta | Bom para iniciantes em treino |

Nunca abaixo da TMB. Déficits acima de 25% só a pedido explícito e com acompanhamento.

## 4. Macronutrientes

Ordem de decisão: **proteína → gordura → carboidrato fecha o resto**.

**Proteína** (4 kcal/g), em g por kg de peso corporal:
- Sedentário saudável: 0,8–1,0
- Ativo / quer preservar massa em déficit: 1,6–2,2
- Ganho de massa: 1,6–2,0
- Acima de 65 anos: 1,0–1,2 (ajuda contra sarcopenia)
- Se obesidade importante, use o peso alvo ou o peso ajustado, não o peso atual.

**Gordura** (9 kcal/g): 20–35% das calorias, mínimo ≈ 0,6–0,8 g/kg. Abaixo disso prejudica hormônios (inclusive testosterona) e absorção das vitaminas A, D, E, K. Priorize insaturadas (azeite, abacate, castanhas, peixes); saturadas < 10% das calorias.

**Carboidrato** (4 kcal/g): o que sobrar. Quem treina intenso precisa de mais (3–6 g/kg); quem é sedentário fica bem com 2–3 g/kg. Prefira fontes integrais, raízes, frutas, leguminosas.

**Fibras**: 25 g/dia (mulheres) e 38 g/dia (homens), ou ~14 g a cada 1.000 kcal.

**Água**: ≈ 30–35 mL/kg/dia como base; +500–1.000 mL em dias de treino ou calor forte. Café e chá contam, álcool não.

## 5. Distribuição nas refeições

- Proteína: 0,3–0,4 g/kg por refeição, 3–5 refeições — estimula melhor a síntese muscular do que concentrar tudo no jantar.
- Carboidrato: mais perto do treino se a pessoa treina; mais no café e almoço para quem é sedentário.
- Não existe horário mágico para comer; consistência e total diário importam mais.

## 6. Como checar se o plano está funcionando

- Pese 2–3× por semana, de manhã, em jejum; use a média semanal, não o dia.
- Perda/ganho fora do esperado por 2 semanas → ajuste ±100–150 kcal.
- Fome extrema, queda de rendimento, irritabilidade, queda de cabelo, amenorreia: sinais de déficit excessivo → suba as calorias.

## 7. Exemplo rápido

Homem, 35 anos, 85 kg, 178 cm, moderado, perder gordura:
- TMB = 10×85 + 6,25×178 − 5×35 + 5 = 1.792 kcal
- TDEE = 1.792 × 1,55 = 2.778 kcal
- Meta = 2.778 × 0,82 ≈ 2.280 kcal
- Proteína 1,8 g/kg = 153 g (612 kcal)
- Gordura 0,9 g/kg = 77 g (689 kcal)
- Carboidrato = (2.280 − 612 − 689) / 4 ≈ 245 g
