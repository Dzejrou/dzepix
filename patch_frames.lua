-- Replace frames of the "art" layer with fixed images; the replaced pixels
-- move to a hidden "before" layer so the fix can be compared or undone.
-- aseprite -b --script-param file=<x.aseprite> --script-param plan=<{"frames":[{"frame":n,"file":png}]}> --script patch_frames.lua
local spr = app.open(app.params.file)
local plan = json.decode(io.open(app.params.plan):read('a'))
local art, before
for _, l in ipairs(spr.layers) do
  if l.name == 'art' then art = l end
  if l.name == 'before' then before = l end
end
if not before then
  before = spr:newLayer()
  before.name = 'before'
end
for _, f in ipairs(plan.frames) do
  local frame = spr.frames[f.frame + 1]
  local old = art:cel(frame)
  if old then
    if before:cel(frame) then spr:deleteCel(before:cel(frame)) end
    spr:newCel(before, frame, old.image:clone(), old.position)
    spr:deleteCel(old)
  end
  spr:newCel(art, frame, Image{ fromFile = f.file }, Point(0, 0))
end
before.isVisible = false
spr:saveAs(app.params.file)
