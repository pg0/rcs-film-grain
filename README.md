# Film Grain.dctl

Open-source (MIT) monochrome + colour **film grain** for DaVinci Resolve, plus a
matching browser tool. Built from scratch - not a decode of any commercial `.dctle`.

Physically grounded film-stock presets (Super 8 / 16mm / 35mm / 65mm), a filmic
luma-density response, automatic per-frame animation and automatic resolution
independence. Two twins that share the exact same grain math:

- **`RCS Film Grain.dctl`** - the Resolve plugin (DCTL 4, Resolve 17+).
- **`web/index.html`** - a self-contained WebGL2 app: drop an image, grain it, save. Fully offline, no build, no dependencies.

## Why "RCS" in the name

At least one common third-party pack (`utility-dctls`) also ships a `Film Grain.dctl`.
Identical names collide in Resolve's DCTL dropdown and you end up tweaking the wrong
one. This is deliberately **RCS Film Grain** so it's unmistakable.

## Install (DaVinci Resolve)

Copy the two `.dctl` files into Resolve's LUT folder (a subfolder is fine):

- Windows: `C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\LUT\`
- macOS: `/Library/Application Support/Blackmagic Design/DaVinci Resolve/LUT/`
- Linux: `/opt/resolve/LUT/` (or `/home/resolve/LUT/`)

`== RedCoralStudios ==.dctl` is an optional no-op passthrough that sorts to the top
of the dropdown as a label - skip it if you don't want it.

In Resolve: **Color page > right-click a node > DaVinci CTL > RCS Film Grain**, or add
a **DCTL** OFX effect and pick the file. Hit the refresh icon in the LUT browser if it
doesn't show up.

> Default parameter values only apply to newly-added nodes. An existing node keeps its
> saved values - add a fresh node to see new defaults.

## Web app

Open `web/index.html` in any modern browser (or host it anywhere - it's a single
static file). Drag an image in, pick a stock, save a JPEG. Nothing ever leaves your
machine. Scroll = zoom, drag = pan, double-click = reset, hold Space = A/B compare.

## Controls

| Control | What it does |
|---|---|
| **Film Stock** | Preset per format (see table below). Custom = neutral / freeform. In the web app the stock *fills* the Intensity + Grain Size sliders (WYSIWYG); in the DCTL it applies as a hidden multiplier (a DCTL combo box can't write back to sliders). |
| **Intensity** | Overall grain strength (0-1, internally capped so it never blows out). |
| **Grain Size (px)** | Grain clump size in pixels, at the 1080p reference. Auto-scaled to the timeline/image resolution. |
| **Softness** | Relaxes the particle shaper and blends in a low-frequency field - creamier. |
| **Roughness** | Mixes in per-pixel detail noise - grittier, sharper. |
| **Shadow / Midtone / Highlight Amount** | Per-zone weighting on top of a filmic density curve: grain peaks in the mids, rolls off to nothing at pure black and clipped white. |
| **Colour Grain** | 0 = pure monochrome (luma only). Up = RGB-decorrelated chroma grain. |
| **Colour Saturation** | How strongly the colour grain deviates per channel. |
| **Seed** | Manual pattern offset. Animation is automatic. |
| **Blend** | Crossfade the whole effect against the original. |
| **Clamp Output** | Keep result in 0-1 (turn off for float/HDR beyond 1.0). |

## Film-stock presets

Grain coarseness/visibility in the final image is dominated by **enlargement**: the
smaller the camera negative, the more it's blown up to a common output, so grain reads
bigger and hotter. Size multiplier = the enlargement factor; intensity multiplier =
the same, tempered so the slider range stays usable.

| Stock | Negative | Enlargement vs 35mm | size × | intensity × | Character |
|---|---|---|---|---|---|
| Super 8 | 5.79 mm | 3.81 | 3.8 | 3.2 | boiling, chunky |
| 16mm | 10.26 mm | 2.15 | 2.15 | 2.0 | gritty doc look |
| 35mm | 22.05 mm | 1.00 | 1.0 | 1.0 | reference, fine |
| 65mm | 52.48 mm | 0.42 | 0.5 | 0.45 | whisper of texture |

Equivalent WYSIWYG slider values (35mm base 0.2 / 1.6 × multiplier):

| Stock | Intensity | Grain Size px |
|---|---|---|
| Super 8 | 0.64 | 6.1 |
| 16mm | 0.40 | 3.44 |
| 35mm | 0.20 | 1.6 |
| 65mm | 0.09 | 0.8 |

Full derivation, frame dimensions and sources: [`FILM-STOCK-RESEARCH.md`](FILM-STOCK-RESEARCH.md).

## Automatic behaviour (no controls)

- **Animation** - grain reshuffles every frame via Resolve's built-in
  `TIMELINE_FRAME_INDEX`, so it "dances" like projected film with no keyframing. The
  web app increments the seed per animation frame instead.
- **Resolution independence** - grain is authored at a 1080p reference and scaled by
  the live frame height (`height / 1080`), so it looks identical at 720p, 1080p, 4K,
  8K. Real grain is a fixed size on the negative; a bigger scan just resolves it across
  more pixels.

## How it works

The full pipeline - integer bit-mix hash, Perlin gradient noise, rotated octaves,
particle shaping, the filmic density gate, colour decorrelation - is documented step by
step in [`MATH.md`](MATH.md).

Grain reads `p_X, p_Y` (and the frame index) per pixel, so it **cannot** be a 3D LUT: a
`.cube` is a pure `RGB → RGB` map with no spatial or temporal input. This has to be a
DCTL / shader.

## Node placement tips

- Put grain **late** in the pipe, after your grade, before the final output transform.
- For a filmic response, apply it in a display/log space rather than linear.

## Licence

MIT - see [`LICENSE`](LICENSE). Built by Patrick Gawron / Red Coral Studios.
