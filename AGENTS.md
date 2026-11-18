# Working on dzepix

This repository is the art tool itself. Games include it as a submodule at
`tools/art/` and run it from their own root.

- `art.mjs` is the engine-neutral core: imports, built sheets
  (`art/.build/`), checks and fixes. Anything engine-specific belongs in
  `engines/<engine>/export.mjs` (`exportAsset`, `exportIndex`) and that
  engine's README.
- Several games depend on the export formats. Don't change what an engine
  writes, the built-sheet format or the `.aseprite` conventions without
  saying so in the commit message, and update the docs in the same commit.
- Run `npm test` before committing. It's offline; never spend PixelLab
  generations in tests.
- Keep `docs/pixellab-mcp.md` engine-neutral and in sync with the commands
  (`node art.mjs help` prints the header comment of `art.mjs`).
- Don't hardcode paths of a particular game or machine; everything
  game-specific comes from the game's `art.config.json`.
