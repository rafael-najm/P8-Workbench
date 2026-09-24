# PICO WORKBENCH

A browser-based PICO-8 development workspace with an AI agent. It uses its own
runtime written from scratch (no Lexaloffle code or assets) and runs as a static
site with no backend.

> Work in progress. See [`docs/PLAN.md`](docs/PLAN.md) for the milestone plan.

## Status

- [x] **M1:** `.p8` parser/serializer (lossless round-trip), P8SCII mapping, PICO-8 lexer, token counter
- [x] **M2:** PICO-8 → Lua 5.4 preprocessor (lexer → AST → codegen, line-preserving)
- [x] **M3:** runtime (memory map, graphics/text/input API, Lua stdlib, frame cycle, watchdog, headless mode)
- [x] **M4:** UI shell (dockable panels, command palette, shortcuts), Monaco `pico8-lua`, Game View with inspector and hot reload, projects in IndexedDB
- [x] **M5:** sprite editor (tools, flags, animation preview, undo, PNG paste) and map editor (zoom/pan, tile brushes, shared-area warning)
- [x] **M6:** audio (AudioWorklet synth with 8 waveforms and 7 effects, sample-accurate sequencer, sfx tracker/graph editor, music pattern editor)
- [ ] M7: AI agent
- [ ] M8: polish and deploy

## Development

Requires Node LTS (20+). Works on Windows, macOS and Linux.

```sh
npm install
npm run dev        # dev server
npm test           # unit tests (Vitest)
npm run typecheck
npm run build      # static site in dist/
```

Set `BASE_PATH=/repo-name/` at build time when deploying to GitHub Pages.
