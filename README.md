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

Telas: **Hoje** (calorias e macros de cada um contra a própria meta, a lista das refeições do plano para marcar Fiz / Ajustar gramas / Não fiz e se a meta do dia foi batida, micronutrientes do dia), **Plano** (refeições do dia com horário, dias da semana e gramas de cada alimento, total contra a meta, avisos no celular), **Registrar** (uma refeição para os dois, com gramas por pessoa), **Exames** (resultados, faixa do laudo e o que na alimentação mexe em cada marcador) e **Perfil** (dados, meta calculada com a fórmula visível, privacidade dos exames, alimentos de rótulo e a entrada da **Família**).

Login com e-mail e senha; a sessão fica salva, então depois da primeira vez o app abre direto.

**Família** (Perfil › Família), no estilo do Compartilhamento Familiar do iCloud:
- Membros com papel: organizador (um por família), responsável, adulto e criança; quem não tem login é dependente.
- Convidar: o app gera um link, um código de 10 caracteres e um QR. O link sai pela folha de compartilhar do celular (iMessage, WhatsApp, e-mail). Com e-mail, só aquela conta aceita e ela entra direto ao criar a conta.
- Quem aceita ganha o próprio espaço (meta, plano, avisos) e o cadastro guiado abre sozinho. Dependente pode ganhar login depois ("Dar login").
- Sair ou ser removido leva os próprios dados para uma família nova. Quem entra estando sozinho em outra família traz a família inteira junto.
- Nenhum app consegue ler a lista da Família do iCloud nem do Google; por isso o convite é por link, código ou QR.
- Android: o mesmo app; botão "Instalar o app" quando o Chrome oferece, e "Escolher dos contatos" no convite (Contact Picker do Chrome).

## Banco (`supabase/`)

- `migrations/` na ordem: esquema e RLS, referências (nutrientes, recomendações, marcadores), TACO, função de ingestão antes do exame.
- Regras de acesso: tudo é por família (`familia_membro`); exames só a própria pessoa vê, a menos que ela marque `compartilha_exames`; só a própria pessoa muda o login e essa opção (trigger `proteger_pessoa`).
- Uma refeição feita junto vira um `refeicao_grupo` com uma `refeicao` por pessoa, cada uma com as próprias gramas (`registrar_refeicao`).
- Plano de refeições: `plano_refeicao` + `plano_item` (gramas por alimento) por pessoa. Marcar no dia (`marcar_plano`) registra a refeição com os itens do plano ou com as gramas ajustadas e grava `plano_checagem`; apagar a refeição desfaz a marcação. Meta batida = energia entre 90% e 110% da meta.
- Avisos: a função `functions/avisos` manda Web Push (chaves VAPID geradas no primeiro uso e guardadas em `push_config`). O `pg_cron` chama a função a cada minuto (`20261024000002_avisos_cron.sql`) e `avisos_devidos()` devolve o que vence: cada refeição do plano com sino ligado e ainda não marcada, e o resumo do dia no horário de `pessoa.aviso_resumo` (padrão 21:30). No iPhone o aviso só chega com o app instalado na Tela de Início.
- Família (`20261024000003_familia.sql`): papéis em `familia_membro.papel`, um login em uma família só, convites com `codigo`, `papel`, `expira_em` (7 dias). Entrar, sair, remover, mudar papel e passar o organizador só pelas funções `aceitar_convite`, `sair_da_familia`, `remover_membro`, `mudar_papel` e `transferir_organizador`. `ver_convite` responde até para quem ainda não tem conta.
- `tests/` roda as migrations num Postgres local e confere a RLS com três usuários (`rls.sql`), o plano com os avisos (`plano.sql`) e a família (`familia.sql`).
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

## Publicação

O app sai em `https://apitov777.github.io/homefitness/` pelo workflow `.github/workflows/pages.yml`,
a cada push na `main` que mexa em `app/`. Requer o repositório público e, em
Settings › Pages, a fonte "GitHub Actions". No Supabase, Authentication › URL Configuration ›
Site URL deve apontar para esse endereço.
