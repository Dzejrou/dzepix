-- Named points as 1x1 slices "point:<name>" with the pivot on the point.
-- aseprite -b --script-param file=<x.aseprite> --script-param plan=<{"points":{"name":[x,y]}}> --script points.lua
local spr = app.open(app.params.file)
local plan = json.decode(io.open(app.params.plan):read('a'))
for name, xy in pairs(plan.points) do
  local id = 'point:' .. name
  for _, s in ipairs(spr.slices) do if s.name == id then spr:deleteSlice(s) end end
  local s = spr:newSlice(Rectangle(xy[1], xy[2], 1, 1))
  s.name = id
  s.pivot = Point(0, 0)
end
spr:saveAs(app.params.file)
