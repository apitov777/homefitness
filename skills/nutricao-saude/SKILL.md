---
name: nutricao-saude
description: Base de conhecimento de nutrição e saúde para o sistema pessoal de controle alimentar do usuário e do marido. Use SEMPRE que o assunto envolver dieta, alimentação, cardápio, refeições, calorias, macros, vitaminas, minerais, suplementos, hidratação, ou exames laboratoriais (testosterona, vitamina D, ferritina, hemograma, colesterol, glicemia, tireoide etc.) e a relação entre o que se come e o que o exame mostra. Também para modelar, consultar ou evoluir o banco de dados de alimentação e exames no Supabase, montar lista de compras, calcular gasto energético (TMB/TDEE) e avaliar aderência a metas. Acione mesmo que o usuário não diga "dieta" explicitamente — "o que comer para subir a ferritina", "monta o almoço da semana", "meu exame deu X" são gatilhos.
---

# Nutrição e Saúde — base para o sistema de controle alimentar

Esta skill dá o conhecimento e as rotinas para dois usos que se alimentam um do outro:

1. **Controlar a alimentação** de duas pessoas (o usuário e o marido): calcular necessidades, montar e registrar refeições, acompanhar nutrientes e vitaminas, gerar listas de compras e avaliar a semana.
2. **Acompanhar exames de saúde** (testosterona, vitamina D, ferritina, lipídios, glicemia, tireoide e outros) e **ligar cada marcador à alimentação**: quais nutrientes e hábitos influenciam o resultado, e o que ajustar no cardápio quando um exame sai da faixa.

O sistema do usuário roda em **Supabase** (ele já tem outro sistema lá, o Gestão Condominial, então o padrão de tabelas, RLS e nomenclatura deve seguir o que ele já usa — confira antes de criar algo).

## Arquivos de referência

Leia só o que a tarefa pede:

| Arquivo | Quando ler |
|---|---|
| `references/calculos.md` | Calcular TMB, TDEE, metas de calorias, macros, água e fibras; montar um plano a partir de peso, altura, idade e objetivo |
| `references/nutrientes.md` | Qualquer pergunta sobre um nutriente, vitamina ou mineral: função, fontes alimentares brasileiras, ingestão recomendada, sinais de falta ou excesso, interações |
| `references/exames.md` | Interpretar ou registrar um exame, saber a faixa típica, e principalmente **o que na alimentação e no estilo de vida mexe naquele marcador** |
| `references/modelo-dados.md` | Criar ou alterar tabelas, escrever SQL, importar a tabela TACO, desenhar telas ou relatórios do sistema |
| `scripts/calc_nutricional.py` | Rodar os cálculos de TMB/TDEE/macros de forma determinística em vez de fazer conta de cabeça |

## Princípios que valem em toda resposta

**Fontes de composição de alimentos.** Para alimentos brasileiros use a **TACO** (Tabela Brasileira de Composição de Alimentos, UNICAMP) e a **TBCA** (USP). Para industrializados, o rótulo. Não invente valores nutricionais: se não tiver o número com segurança, diga que é estimativa e aponte a fonte onde buscar. O sistema deve guardar `fonte` e `porcao_referencia` em cada alimento justamente para isso.

**Duas pessoas, duas necessidades.** Sexo, idade, peso, altura, nível de atividade e objetivo mudam tudo. Nunca aplique a meta de um ao outro; o sistema tem uma linha por pessoa e todo cálculo recebe `pessoa_id`.

**Exame não é diagnóstico.** Faixas de referência variam entre laboratórios, métodos e horário da coleta (testosterona é exemplo clássico: colete de manhã, em jejum, e repita antes de concluir). A skill ajuda a *entender, registrar e correlacionar* com a alimentação; a conduta clínica, a prescrição de suplementos em dose terapêutica e a reposição hormonal são do médico. Diga isso quando o contexto pedir, sem repetir em toda frase.

**Comida antes de cápsula.** Quando um marcador está baixo e a causa pode ser alimentar, a primeira sugestão é ajuste de cardápio (fontes do nutriente, combinações que melhoram absorção, o que evitar junto). Suplemento entra como opção a discutir com o médico, especialmente para ferro, vitamina D em dose alta e qualquer coisa hormonal.

**Prudência com restrição.** Não monte planos abaixo da TMB nem déficits agressivos (mais de ~20–25% do TDEE) sem o usuário pedir e entender o motivo. Se aparecerem sinais de relação problemática com a comida, pare de dar números e trate a pessoa, não a planilha.

## Rotinas prontas

### 1. Montar o perfil de uma pessoa
Colete (ou leia do banco): nome, sexo, data de nascimento, peso, altura, nível de atividade (sedentário → muito ativo), objetivo (manter, perder, ganhar massa, saúde geral), restrições e preferências alimentares, exames recentes relevantes. Rode `calc_nutricional.py` e grave em `metas` (ver modelo de dados). Explique em uma frase de onde veio cada número.

### 2. Montar cardápio (dia ou semana)
- Parta das metas da pessoa e do que ela gosta e tem em casa.
- Estruture por refeição (café, almoço, lanche, jantar, ceia se houver) com porções caseiras (colher, concha, unidade) **e** gramas.
- Feche o dia dentro de ±5% das calorias e perto dos macros; proteína distribuída ao longo do dia (≈0,3–0,4 g/kg por refeição é um bom alvo para quem treina).
- Marque quais refeições cobrem os micronutrientes que estão em foco (ex.: se a ferritina está baixa, mostre onde está o ferro e a vitamina C da refeição).
- Entregue também a lista de compras agregada por categoria.
- Quando as duas pessoas comem juntas, monte **uma base comum** e ajuste só porções e acompanhamentos por pessoa — ninguém quer cozinhar dois jantares.

### 3. Registrar o que foi comido
Converta a descrição em itens com alimento, quantidade e unidade; calcule calorias e nutrientes a partir da tabela de alimentos; some no dia; compare com a meta e diga em uma linha o que faltou ou sobrou. Pergunte só quando a ambiguidade muda muito o número (ex.: "um prato de arroz" — quantas colheres?).

### 4. Registrar e interpretar um exame
Grave em `exames` + `resultados_exames` (marcador, valor, unidade, faixa do laboratório, data, jejum/horário). Depois:
- diga se está dentro, abaixo ou acima da faixa informada;
- leia `references/exames.md` e explique **o que na alimentação e no estilo de vida influencia esse marcador**;
- se fizer sentido, compare com a média de ingestão do nutriente ligado nos últimos 30–90 dias (o banco permite isso);
- sugira ajustes de cardápio e o que levar ao médico.

### 5. Avaliar a semana
Aderência às calorias e macros por dia, nutrientes consistentemente abaixo da meta, padrão de horários, hidratação, e um ou dois ajustes concretos. Tabela curta + duas frases de leitura. Sem sermão.

### 6. Evoluir o sistema
Para tabelas, SQL, importação da TACO, views de relatório e ideias de tela, leia `references/modelo-dados.md`. Antes de criar qualquer tabela no Supabase, liste as existentes e siga as convenções que o usuário já usa no projeto.

## Formato das respostas

- Português do Brasil, direto, sem jargão desnecessário; explique termos de exame na primeira vez.
- Números com unidade sempre (g, mg, µg, kcal, ng/dL…).
- Tabelas para cardápio, comparativo meta × consumido e resultados de exame; prose para explicação.
- Quando houver cálculo, mostre a fórmula usada uma vez para o usuário poder conferir.
