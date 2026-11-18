// Godot 4 exporter: not implemented yet. See README.md here for what it will
// write. The interface is the same as engines/phaser/export.mjs:
//   exportAsset(asset, ctx)   asset = { key, kind, data, png, normal }
//   exportIndex(assets, ctx)  assets = [{ key, kind }], ctx = { out, config, root }

const NOT_YET = 'the Godot exporter is not implemented yet (engines/godot/README.md); set "engine": "phaser" or implement it';

export function exportAsset() {
  throw new Error(NOT_YET);
}

export function exportIndex() {
  throw new Error(NOT_YET);
}
