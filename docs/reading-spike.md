# The reading spike — findings

Before any architecture was built, a throwaway spike (`spikes/reading/`, since
removed — this file preserves its findings) answered one question:

> Can you read a real PDF, page by page, on a curved 3D page mesh, at 60 fps,
> without leaning into the screen?

**Verdict: yes.** The production reader in `src/reader/` is a port of that
spike. The measurements and hard-won lessons below are why the reader is shaped
the way it is.

## What was measured

Windows 11, Chrome, 1600×1000 css viewport at DPR 1.5, integrated GPU,
`supersample 2×`, max anisotropy 16×.

| | |
|---|---|
| Page height on screen, docked | **1431 device px** (954 css) |
| Page texture height | 2560 px (≈233 DPI for US Letter) |
| Texel ratio | 1.8–2.1× |
| Steady-state frame rate | **60 fps** |
| 10 s of continuous page turning | **avg 59.8 fps, min 56.3** |
| Frame-rate floor while rasterising a new page | **~40 fps** |
| Texture memory, one spread | ~104 MB |
| Texture memory walking all 16 pages (400 MB budget, LRU) | 388 MB, stable |

At that page size, 9.5pt body copy lands at roughly 26 device px per line.
Anisotropy off visibly muddies the far half of a page viewed at 37° obliquity
and costs nothing to leave on.

## Three findings that shaped the reader

**1. Legibility is capped by screen pixels, not texture DPI.** A real book page
at a real reading distance is ~500 device px tall, which is illegible no matter
how sharp the texture. Read mode has to be a camera dock so the open spread
fills the viewport — "hold the book up while you walk around and read it" will
never be readable and shouldn't be promised.

**2. A 150 DPI page cache is a preview tier, not a reading tier.** Filling a
1000px-tall viewport needs ~2560 px of page height, ~233 DPI for US Letter.
150 DPI is for covers, thumbnails and shelf peeks; budget 250–300 DPI for the
page actually being read.

**3. Rasterising on the main thread is the only thing that breaks 60 fps.**
Every measured drop below 60 traced to pdf.js rendering a fresh 2560 px page
inline — never to the mesh, the skinning, or the shadows. Rendering has
headroom; decoding does not.

## Three bugs worth remembering

These cost real time in the spike and recur in this kind of code.

- **Gutter curl must decay to zero.** A constant per-bone rotation keeps
  accumulating along the sheet, so the page dives through the page block behind
  it. Shape the *cumulative* angle as `amount · exp(-i/falloff)` and give the
  bones the differences.
- **Rotation sign.** A positive rotation about +Y swings +X toward −Z — the
  leaf sweeps down through the desk instead of lifting toward the reader. The
  turn base angle has to be negative.
- **LOD target must be reactive.** Holding the required texture resolution in a
  ref means the loader never re-fires when it changes, so quality changes
  silently no-op. It has to be state.
