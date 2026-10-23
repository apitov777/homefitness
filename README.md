# homefitness

Sistema pessoal de controle de alimentação e saúde para duas pessoas: registro de refeições, acompanhamento de nutrientes e vitaminas, acompanhamento de exames laboratoriais e a relação entre o que se come e o que os exames mostram.

## Estrutura

```
skills/
└── nutricao-saude/        # Skill do Claude com a base de conhecimento do projeto
    ├── SKILL.md           # Princípios e rotinas (perfil, cardápio, registro, exames, avaliação da semana)
    ├── references/
    │   ├── calculos.md    # TMB, TDEE, metas calóricas, macros, água, fibras
    │   ├── nutrientes.md  # Vitaminas e minerais: RDA, fontes brasileiras, deficiências, interações
    │   ├── exames.md      # Marcadores laboratoriais e o que na alimentação influencia cada um
    │   └── modelo-dados.md# Esquema Supabase/Postgres, views, importação da TACO, RLS
    └── scripts/
        └── calc_nutricional.py   # Cálculo determinístico de TMB/TDEE/macros
```

## Stack

- **Banco:** Supabase, projeto `homefitness` (região São Paulo), Postgres + RLS por família.
- **Dados de alimentos:** TACO 4ª edição (NEPA/UNICAMP), 597 alimentos importados da planilha original em `data/taco/`; alimentos de rótulo cadastrados pelo app.
- **Front-end:** PWA (React + Vite) em `app/`, instalável no iPhone pela Tela de Início. Depois pode virar app nativo SwiftUI com o app Saúde usando o mesmo banco.

## App (`app/`)

```bash
cd app
npm install
npm run dev      # usa .env.production (URL e chave publishable do projeto)
npm test         # cálculo de metas conferido contra o script Python
npm run build    # gera app/dist para publicar
```

Telas: **Hoje** (calorias e macros de cada um contra a própria meta, micronutrientes do dia), **Registrar** (uma refeição para os dois, com gramas por pessoa), **Exames** (resultados, faixa do laudo e o que na alimentação mexe em cada marcador) e **Perfil** (dados, meta calculada com a fórmula visível, família, privacidade dos exames, alimentos de rótulo).

Login com e-mail e senha; a sessão fica salva, então depois da primeira vez o app abre direto. Para a segunda pessoa entrar, cadastre-a em Perfil › Família com o e-mail dela; ao criar a conta com esse e-mail, ela entra na família e assume o próprio perfil.

## Banco (`supabase/`)

- `migrations/` na ordem: esquema e RLS, referências (nutrientes, recomendações, marcadores), TACO, função de ingestão antes do exame.
- Regras de acesso: tudo é por família (`familia_membro`); exames só a própria pessoa vê, a menos que ela marque `compartilha_exames`; só a própria pessoa muda o login e essa opção (trigger `proteger_pessoa`).
- Uma refeição feita junto vira um `refeicao_grupo` com uma `refeicao` por pessoa, cada uma com as próprias gramas (`registrar_refeicao`).
- `tests/` roda as migrations num Postgres local e confere a RLS com três usuários.
- `scripts/importar_taco.py` regenera a migration da TACO a partir da planilha. Na TACO original o leite de vaca integral e o desnatado UHT estão sem energia e macros (amostras em reavaliação); cadastre pelo rótulo.

## Uso da skill

Instale a pasta `skills/nutricao-saude` como skill no Claude (ou aponte o Claude Code para este repositório). A skill é acionada em qualquer conversa sobre dieta, cardápio, nutrientes, exames ou evolução do banco de dados do sistema.

Cálculo rápido de metas:

```bash
python skills/nutricao-saude/scripts/calc_nutricional.py \
  --sexo M --idade 35 --peso 85 --altura 178 --atividade moderado --objetivo perder --json
```

## Aviso

O conteúdo da skill é informativo. Faixas de referência variam entre laboratórios; interpretação clínica, prescrição de suplementos e reposição hormonal são do médico.
