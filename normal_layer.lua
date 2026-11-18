-- Put normal-map frames into a hidden "normal" layer of a .aseprite file.
-- aseprite -b --script-param file=<x.aseprite> --script-param plan=<plan.json> --script normal_layer.lua
-- plan = { frames = [{ frame = <0-based frame index>, file = <png> }] }
local spr = app.open(app.params.file)
local plan = json.decode(io.open(app.params.plan):read('a'))
local layer
for _, l in ipairs(spr.layers) do if l.name == 'normal' then layer = l end end
if not layer then
  layer = spr:newLayer()
  layer.name = 'normal'
end
for _, f in ipairs(plan.frames) do
  local frame = spr.frames[f.frame + 1]
  local old = layer:cel(frame)
  if old then spr:deleteCel(old) end
  spr:newCel(layer, frame, Image{ fromFile = f.file }, Point(0, 0))
end
-- Hidden: the colour export only takes visible layers; the tool exports this
-- one on its own into <key>_n.png.
layer.isVisible = false
spr:saveAs(app.params.file)
