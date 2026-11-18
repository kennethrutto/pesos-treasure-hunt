# Garden photographs

Drop tiles in here and the hunt uses them instead of the drawn textures in
`lib/gardenTextures.ts`. Each is optional and loaded independently, so one
photograph improves one surface without the others having to exist.

| File | Surface |
| --- | --- |
| `hedge.jpg` | the maze hedges, the tree's leaves, and the code's modules |
| `stone.jpg` | the paving the maze is walked on |
| `turf.jpg`  | the lawn |

**They must tile seamlessly.** These are repeated many times across a single
surface — the lawn alone repeats roughly forty times edge to edge. A photo
with a bright corner, an uneven exposure or a distinctive mark repeats as a
visible grid, which reads worse than the drawn texture it replaced. Run them
through a seamless-tile tool first.

Square, 1024 or 2048 px, shot square-on rather than at an angle: perspective
baked into the photo fights the scene's own camera. Keep them under ~400 KB
each — they are on the page's critical path for a visitor on Nairobi mobile
data.

One caveat on `hedge.jpg`: it also skins the QR code's modules. Anything very
light or very high-contrast reduces the separation between a dark module and
the bone plate behind it, which is what a scanner reads. Mid-to-dark foliage
is the safe choice; the scene applies its own darkening as the code forms,
but it cannot rescue a pale tile.
