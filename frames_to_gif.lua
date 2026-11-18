-- Save PNG frames (same size) as one animated GIF.
-- aseprite -b --script-param plan=<{"out":..., "size":S, "files":[...]}> --script frames_to_gif.lua
local plan = json.decode(io.open(app.params.plan):read('a'))
local spr = Sprite(plan.size, plan.size, ColorMode.RGB)
for i, f in ipairs(plan.files) do
  local frame = (i == 1) and spr.frames[1] or spr:newEmptyFrame()
  spr:newCel(spr.layers[1], frame, Image{ fromFile = f }, Point(0, 0))
end
spr:saveAs(plan.out)
