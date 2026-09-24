# PICO WORKBENCH

A browser workspace for making PICO-8-style games: a full-screen code editor, sprite/map/sfx/music editors, a from-scratch PICO-8 runtime, and an AI agent (via OpenRouter, with your own key) that can edit everything, run the game headless, take screenshots and playtest.

Static site, no backend. No Lexaloffle binaries, assets or code: the runtime is original; the `.p8` text format is open; the PICO-8 font is CC0.

## Features

- **Cart format:** lossless `.p8` read/write (the sample round-trips byte for byte), full P8SCII glyph mapping, and a token counter that matches PICO-8/shrinko8 (`nebula_strike.p8` = 5653 tokens).
- **Runtime:** PICO-8 Lua is preprocessed to Lua 5.4 (wasmoon), keeping line numbers. It includes the graphics, text, input, math, table, string, memory and system APIs, the 64 KiB memory map, a watchdog for infinite loops, hot reload, and a headless mode.
- **Editor:** Monaco with a `pico8-lua` grammar, API autocomplete and hover, color swatches, lint, runtime errors mapped to source lines, and token counts per function.
- **Game View:** pixel-perfect canvas, pause/step/speed controls, the PICO-8 pause menu, and a globals inspector that is editable while paused.
- **Asset editors:** sprites (tools, flags, animation preview, PNG paste), map (zoom/pan, multi-tile brushes), SFX (tracker and graph modes), and music (patterns and loop flags).
- **Audio:** an AudioWorklet synth with the 8 PICO-8 waveforms and 7 effects, driven by a sample-accurate sequencer.
- **AI agent:** 21 tools covering code, sprites, map, sound, running the game, screenshots, globals, eval and playtest bots. It has an approve mode with diffs, per-task undo, and cost shown per message.

## Development

Requires Node LTS (20+). Works on Windows, macOS and Linux.

```sh
npm install
npm run dev         # http://localhost:5173
npm test            # unit tests (Vitest, 340+)
npm run test:e2e    # Playwright (builds and serves on :4173)
npm run build       # static site in dist/
```

Using the AI agent: open Settings (gear icon), paste an OpenRouter key and pick a model with tool support (vision recommended). The key is stored only in `localStorage` and is sent only to openrouter.ai.

Shortcuts: `Ctrl+R` run/reload · `Ctrl+Enter` restart · `Ctrl+S` save + hot reload · `F5` play/pause · `F6` step · `Ctrl+K` command palette · `Ctrl+1..6` panels (game, sprites, map, sfx, music, agent) · `Esc` closes a panel.

## Deploy

- **GitHub Pages:** `.github/workflows/deploy.yml` builds on every push to `main` with `BASE_PATH=/<repo>/`. Enable Pages with "GitHub Actions" as the source.
- **Vercel:** import the repo (`vercel.json` is included), no configuration needed.

## How the runtime works

1. **Preprocessor** (`src/runtime/preprocess`): a PICO-8 lexer (shared with the token counter) feeds a recursive-descent parser. The code generator emits Lua 5.4 on the same source lines, so error lines map 1:1.
   - It expands compound assignment and turns short `if`/`while` and `?` into normal statements.
   - PICO-8-only operators (`\`, `& | ^^ ~ << >> >>> <<> >><`, `@ % $`) become helper calls.
   - Numbers are emitted with their exact 16.16 value.
2. **Numbers:** Lua floats, with 16.16 emulated where games depend on it: bitwise ops and shifts, `tostr` flags, `tonum`, `peek4`, `dget`, and literal wrap-around (`0xffff == -1`). `..` formats numbers the way PICO-8 does.
3. **Machine** (`src/runtime/machine.ts`):
   - Memory is a real 64 KiB `Uint8Array` laid out like PICO-8 (screen at 0x6000, draw state at 0x5f00…), so `poke` tricks work.
   - Graphics, memory and input are TypeScript registered as raw Lua C functions (about 12x faster than wasmoon's generic bridge). Math, tables and strings stay in Lua.
   - The cart runs in its own environment. Top-level code and `_init` run in a coroutine (so `flip()` works), then `_update60`/`_update` and `_draw`.
   - A `debug.sethook` watchdog stops frames that run longer than 2 s.
4. **Audio:** the same sequencer runs on the main thread (for `stat()`) and inside the AudioWorklet (for sound).
5. **Headless:** the same `Machine`, with no clock, driven frame by frame with input scripts. It powers tests, the agent's tools (inside a Web Worker) and the playtest bots.

## Status and known gaps

- Custom sfx instruments and sfx filters (noiz, buzz, reverb…) are approximated or ignored.
- `.p8.png` carts and `#include` are not supported (only `.p8` text).
- The "strict 16.16 overflow" toggle is planned; see `docs/PLAN.md`.
- `TODO(milestone-8)`: first-visit onboarding, a home screen with a live demo cart, and code-splitting of the bundle (Monaco is about 4 MB).
