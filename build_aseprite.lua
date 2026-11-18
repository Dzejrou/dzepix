-- Build a .aseprite file from a plan written by tools/art/art.mjs.
-- Run headless: aseprite -b --script-param plan=<plan.json> --script build_aseprite.lua
--
-- plan = { out, width, height, anchor = {x, y} | nil,
--          frames = [{ file, ms, x, y }], tags = [{ name, from, to, repeats }],
--          nine = { center = {x, y, w, h}, tile } | nil }
local plan = json.decode(io.open(app.params.plan):read('a'))

local spr = Sprite(plan.width, plan.height, ColorMode.RGB)
local layer = spr.layers[1]
layer.name = 'art'

for i, f in ipairs(plan.frames) do
  local frame = (i == 1) and spr.frames[1] or spr:newEmptyFrame()
  frame.duration = f.ms / 1000
  spr:newCel(layer, frame, Image{ fromFile = f.file }, Point(f.x, f.y))
end

-- Plan indices are 0-based; Aseprite frames are 1-based. A tag without
-- `repeats` loops forever (Aseprite's default); repeats = 1 plays once.
for _, t in ipairs(plan.tags) do
  local tag = spr:newTag(t.from + 1, t.to + 1)
  tag.name = t.name
  if t.repeats then tag.repeats = t.repeats end
end

-- The ground point (or effect origin), as a slice pivot that can be moved in Aseprite.
if plan.anchor then
  local slice = spr:newSlice(Rectangle(0, 0, plan.width, plan.height))
  slice.name = 'anchor'
  slice.pivot = Point(plan.anchor.x, plan.anchor.y)
end

-- A 9-slice: the slice's centre is the part that stretches; the frame
-- around it keeps its size. User data "tile" repeats the edges instead.
if plan.nine then
  local c = plan.nine.center
  local slice = spr:newSlice(Rectangle(0, 0, plan.width, plan.height))
  slice.name = 'nine'
  slice.center = Rectangle(c.x, c.y, c.w, c.h)
  if plan.nine.tile then slice.data = 'tile' end
end

-- The project palette, so hand edits pick from the same colours.
if plan.palette then
  local pal = Palette(#plan.palette)
  for i, c in ipairs(plan.palette) do
    pal:setColor(i - 1, Color{ r = tonumber(c:sub(2, 3), 16), g = tonumber(c:sub(4, 5), 16), b = tonumber(c:sub(6, 7), 16) })
  end
  spr:setPalette(pal)
end

spr:saveAs(plan.out)
