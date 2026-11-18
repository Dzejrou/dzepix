# dzepix

Art pipeline for pixel-art games: PixelLab results (characters, animations,
tiles, building kits, objects, effects, UI, fonts, portraits) become
editable `.aseprite` files, and an exporter per engine turns those into what
the game loads.

- **Engines:** Phaser 4 (`engines/phaser/`), Godot 4 (`engines/godot/`,
  planned).
- **Needs:** Node 20+, Aseprite 1.3+ (`ASEPRITE=/path/to/aseprite` if it's
  not in `~/Applications`).

## Use it in a game

```bash
git submodule add <this repo's url> tools/art
cd tools/art && npm install
```

Then add `art.config.json` in the game's root (at least `"engine"` and
`"out"`), and run from the game's root:

```bash
node tools/art/art.mjs help
```

Docs:

- [docs/pixellab-mcp.md](docs/pixellab-mcp.md): how to make art with the
  PixelLab MCP and this tool (for LLM agents and people). Point the game's
  `AGENTS.md` at `tools/art/docs/pixellab-mcp.md`.
- `engines/<engine>/README.md`: what the export writes and how the game
  loads it.

## Develop

```bash
npm test
```

runs an offline smoke test (import, build, export). See [AGENTS.md](AGENTS.md).
