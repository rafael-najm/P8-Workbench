# PICO WORKBENCH: plano

## Estrutura de pastas

```
samples/
  nebula_strike.p8          # cart de exemplo (fixture dos testes)
docs/
  PLAN.md                   # este arquivo
src/
  cart/                     # [M1] formato e análise estática, sem dependência de DOM
    types.ts                #   modelo do cart (Cart, Sfx, MusicPattern...)
    cart.ts                 #   cart vazio, clone, acesso à memória compartilhada gfx/map
    p8scii.ts               #   tabela P8SCII <-> unicode completa (256 glyphs)
    p8format.ts             #   parse/serialize .p8 (round-trip sem perdas)
    lexer.ts                #   lexer PICO-8 (reusado pelo contador e pelo pré-processador)
    tokens.ts               #   contagem de tokens/chars, tokens por função
    lint.ts                 #   [M4] globais indefinidas, locais não usadas
  runtime/
    preprocess/             # [M2] lexer -> parser de statements -> Lua 5.4 + source map
    api/                    # [M3] gfx, input, math, tabelas, strings, memória, sistema
    audio/                  # [M6] AudioWorklet: 8 ondas, efeitos, 4 canais
    font.ts                 # [M3] fonte 3x5 (CC0) + glyphs P8SCII
    memory.ts               # [M3] Uint8Array(0x10000) com o mapa de memória do PICO-8
    machine.ts              # [M3] ciclo _init/_update/_draw, clock, watchdog
    headless.ts             # [M3] execução sem canvas/áudio (testes, playtest, worker)
  editors/
    code/                   # [M4] Monaco + linguagem pico8-lua, autocomplete, diagnósticos
    sprite/                 # [M5]
    map/                    # [M5]
    sfx/                    # [M6]
    music/                  # [M6]
  agent/
    openrouter.ts           # [M7] SSE + tool calling
    tools/                  # [M7] uma tool por arquivo (schema + impl + teste)
    loop.ts                 # [M7]
    history.ts              # [M7] snapshots / desfazer tarefa
    system-prompt.md        # [M7]
  workers/                  # [M3/M7] worker headless para run_game/playtest
  ui/
    layout/                 # [M4] shell, painéis dockáveis, command palette
    theme/                  # [M4] tokens, fonte pixel, paleta
  store/                    # [M4] zustand: projeto, runtime, agente, ui
  persistence/              # [M4] IndexedDB (idb), autosave, versões
e2e/                        # [M8] Playwright
```

Regra de dependências: `cart/` não importa nada de fora dele; `runtime/` só
importa de `cart/`; `agent/` e `editors/` usam `store/` + `runtime/`. Isso
permite rodar o runtime inteiro dentro de um Web Worker.

## Milestones

| # | Entrega | Critério de pronto |
|---|---------|--------------------|
| 1 | Formato `.p8`, P8SCII, lexer, contador de tokens | round-trip idêntico do nebula_strike, 5653 tokens, shell Vite compilando |
| 2 | Pré-processador PICO-8 → Lua 5.4 (tokens + parser de expressões) | ~40 fixtures; nebula_strike compila no wasmoon; source map |
| 3 | Runtime: memória, API gráfica/input/math, fonte, ciclo, headless, watchdog | testes por função da API; 10.000 frames headless sem erro |
| 4 | UI: shell, Monaco `pico8-lua`, Game View, painéis, command palette, projetos no IndexedDB, hot reload | fluxo editar → rodar → erro destacado na linha certa |
| 5 | Editores de sprite e mapa | editar sprite reflete no jogo rodando |
| 6 | Áudio: sintetizador, `sfx`/`music`, editores de SFX e música | nebula_strike jogável com som |
| 7 | Agente: OpenRouter, painel de chat, tools, worker headless, playtest, snapshots | tarefa de ponta a ponta do power-up |
| 8 | Polimento, onboarding, Playwright, README, deploy | `npm run build` estático + e2e verdes |

## Milestone 1: detalhes

### P8SCII (`p8scii.ts`)
- Tabela de 256 entradas byte → unicode (os glyphs de botão usam U+FE0F).
- `unicodeToP8scii` aceita os glyphs com e sem U+FE0F e as maiúsculas itálicas
  (𝘢..𝘻) que o PICO-8 usa no copiar/colar; caracteres desconhecidos viram bytes
  UTF-8, como no PICO-8.
- "p8 string" = string JS em que cada char é um byte P8SCII: o lexer trabalha
  nela, então cada glyph conta 1 caractere.

### Formato `.p8` (`p8format.ts`)
- Seções `__lua__ __gfx__ __label__ __gff__ __map__ __sfx__ __music__` + `__meta:*__` (preservadas).
- Modelo: `gfx` `Uint8Array(128*128)`, `flags` `Uint8Array(256)`, `map`
  `Uint8Array(128*64)`, `label` (0..31, com a paleta secreta `g..v`), 64 sfx, 64 padrões de música.
- **Memória compartilhada:** linhas 32..63 do mapa = linhas 64..127 da
  spritesheet (1 byte do mapa = 2 pixels, nibble baixo à esquerda).
  `setGfxPixel`/`setMapTile` mantêm os dois lados em sincronia; no parse, um
  `__map__` com mais de 32 linhas escreve na spritesheet.
- **Round-trip sem perdas:** cada seção guarda o texto bruto e a serialização
  canônica do que foi lido. Se os dados não mudaram, o texto bruto é reemitido
  (preserva linhas curtas de sfx, CRLF, cabeçalho ausente etc.). Seções
  alteradas saem no formato canônico do PICO-8 (linhas vazias finais cortadas,
  ordem canônica para seções novas).

### Contador de tokens (`lexer.ts`, `tokens.ts`)
- Lexer próprio (strings com escapes e `\z`, strings/comentários longos,
  `//`, números binários/hex fracionários, todos os operadores do PICO-8).
- Regras: 1 token por identificador/keyword/literal/operador/abertura;
  0 para `, . : ; :: ) ] } local end` e comentários; `-`/`~` unário colado a
  literal numérico conta junto (mesma condição do shrinko8).
- `functionTokenCounts` para o futuro CodeLens/`cart_stats`.

### Testes
- `nebula_strike.p8`: round-trip idêntico, 5653 tokens, 18482 caracteres.
- 30 casos pequenos com valores esperados gerados pelo shrinko8, mais casos das regras.
- Seções, CRLF, meta, erros com número de linha, memória compartilhada.
- Validação extra feita durante o desenvolvimento (fora da suíte): os 38 carts
  de `test_input/` do shrinko8 batem em tokens, caracteres e round-trip.

## Planejado para depois
- Toggle "overflow 16.16 estrito" (M3): envolver aritmética em `fx()` no pré-processador quando ativo.
