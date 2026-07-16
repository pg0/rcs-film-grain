# FilmGrain - mathematical logic

The effect is: **additive, luma-weighted, band-limited pseudo-random noise**, generated per pixel on the GPU. Below is every step, in order, exactly as the DCTL and the WebGL shader compute it.

Notation: `p_X, p_Y` = integer pixel coords; `R,G,B` = input channel values (0-1 in display space); `frac(x) = x - floor(x)`.

---

## 1. Grain size → coordinate scaling

Grain "size" is controlled by sampling the noise on a coarser lattice. Divide pixel coords by the grain size in pixels:

```
resScale = MatchResolution ? (p_Height / 1080) : 1
size = max(0.3, GrainSize * stockSizeMul * resScale)
fx = p_X / size
fy = p_Y / size
```

Bigger `size` → lower spatial frequency → larger grain clumps. Default is 1.6 px **at the 1080p reference**.

**Resolution normalisation.** Real film grain is a fixed physical size on the negative, so a higher-resolution scan of the same frame resolves the *same* grain across *more* pixels - grain size relative to the frame is constant, only the pixel count changes. To reproduce that, grain px scales with the actual frame height / 1080 (reference = 1080p). At 4K (2160) `resScale = 2`, so a 1.6 px authored grain becomes 3.2 px and looks identical relative to the image; at 720p it shrinks to ~1.07 px. `p_Height` is the live timeline height, so no manual resolution picker is needed - the shader reads the frame size itself. Toggle **Match Resolution** off to lock grain to a fixed pixel size instead (authoring mode). The web twin uses the source image height in place of `p_Height`. `stockSizeMul` comes from the Film Stock preset and is grounded in the physical enlargement factor (35mm_frame_width / format_frame_width): the smaller the negative, the more it must be blown up to a common output, so grain reads bigger. Frame widths: Super 8 = 5.79 mm, 16mm = 10.26 mm, 35mm Academy = 22.05 mm, 65mm 5-perf = 52.48 mm → enlargement vs 35mm = 3.8 / 2.15 / 1.0 / 0.42. Size multipliers adopt these ratios verbatim: Super 8 = 3.8, 16mm = 2.15, 35mm = 1.0, 65mm = 0.5 (65mm nudged up off the 0.42 floor so it stays ≥ ~0.8 px and reads as texture, not sub-pixel sensor noise).

---

## 2. Hash — integer-quality bit mixing

A hash maps a 2D integer coordinate + seed to a reproducible value in `[0,1)`. Float fract-of-product hashes (`sin(a*x+b*y)`, Dave Hoskins) keep weak periodicity when sampled on the exact integer pixel lattice — it reads as a faint cross-hatch weave on flat midtones. So the hash is a **bit-mixing integer hash** (multiply-xor fold of the coords, then the lowbias32 finalizer), which is fully decorrelated on integer grids:

```
hash(x, y, seed):
    h  = uint(floor(x)) * 0x9E3779B1
       ^ uint(floor(y)) * 0x85EBCA77
       ^ uint(floor(seed)) * 0xC2B2AE3D
    h ^= h >> 16;  h *= 0x7FEB352D
    h ^= h >> 15;  h *= 0x846CA68B
    h ^= h >> 16
    return float(h & 0xFFFFFF) / 2^24
```

Used for both the per-pixel white noise and the gradient directions below. Seed offsets between fields are all ≥ 1, so the `floor(seed)` never collides.

---

## 3. Gradient noise — band-limited granularity

Value noise (interpolated random *values*) has most of its energy at DC and low frequencies — it looks like soft clouds, which is why the old grain read as flat and muddy. **Gradient noise (Perlin)** stores a random *direction* per lattice corner and interpolates the dot products with the sample offset. It is zero-mean and band-limited: the energy sits at the lattice frequency, so a lattice of `size` px produces actual `size`-px granularity:

```
gdot(cx, cy, dx, dy) = cos(θ)*dx + sin(θ)*dy      where θ = hash(cx,cy,seed) * 2π

ix = floor(x), iy = floor(y),  fx = x-ix, fy = y-iy
a = gdot(ix,   iy,   fx,   fy  )
b = gdot(ix+1, iy,   fx-1, fy  )
c = gdot(ix,   iy+1, fx,   fy-1)
d = gdot(ix+1, iy+1, fx-1, fy-1)

fade(t) = t³(6t² - 15t + 10)                      # quintic, C2 across cells
ux = fade(fx),  uy = fade(fy)

gnoise = mix( mix(a,b,ux), mix(c,d,ux), uy ) * 1.6   # ≈ [-1,1]
```

`mix(a,b,t) = a + (b-a)*t`.

---

## 4. Grain field — rotated octaves + particle shaping

Real emulsion has energy spread around the grain size (1/f-ish), not at a single frequency, and its texture is *particulate*, not smooth. Three parts:

**Clumps** = 3 gradient-noise octaves, each rotated to an incommensurate angle (grid-free): the base cell, a 2.1× finer one for bite, and a 0.53× coarser one for organic clumping. Weights 1 / 0.55 / 0.35, renormalised by 0.84:

```
rot(x,y,a) = ( x*cos a - y*sin a,  x*sin a + y*cos a )
a = rot(x,y,0.7);  b = rot(x,y,2.4);  c = rot(x,y,3.9)
n = ( gnoise(a) + 0.55*gnoise(2.1*b) + 0.35*gnoise(0.53*c) ) * 0.84
```

**Detail** = true per-pixel white noise from the raw pixel coord, kept subordinate (`Roughness²` so the default adds bite, not fizz):

```
fine = hash(p_X, p_Y, seed*1.7) * 2 - 1
g = mix(n, fine, Roughness²)                      # 0 = clumps ... 1 = crisp per-pixel
```

**Shaping** = a signed power law raises the kurtosis of the near-Gaussian field, so it reads as discrete silver particles with real punch instead of low-contrast fog. Softness relaxes the shaper and adds a slow low-frequency "breathing" layer:

```
shape = mix(0.55, 1.0, Softness)                  # 0.55 = crunchy ... 1 = untouched
g = sign(g) * |g|^shape

lo = gnoise(x*0.35, y*0.35, seed - 9.1)
g = mix(g, lo, Softness * 0.35)
grain = g                                         # signed, ~[-1,1]
```

---

## 5. Luma-adaptive weighting — film density response

Real grain amplitude follows the density curve: strongest through the mid-densities, subtler toward deep shadow and rolled off to nothing at clipped white. Compute Rec.709 luma, three smoothstepped zone weights, and a mid-peaked **gate** that kills grain at pure black (no digital noise-floor look) and clipped white (silky highlights):

```
L = clamp(0.2126*R + 0.7152*G + 0.0722*B, 0, 1)
ss(t) = t*t*(3 - 2t)

wShadow = ss( clamp(1 - 2L,             0, 1) )
wHigh   = ss( clamp(2L - 1,             0, 1) )
wMid    = ss( clamp(1 - 2.2*|L - 0.45|, 0, 1) )

gate    = ( 4*L*(1-L) )^0.35             # 1 at mid-grey, → 0 at L = 0 and L = 1

lumaAmt = (ShadowAmt*wShadow + MidAmt*wMid + HighAmt*wHigh) * gate
```

---

## 6. Amount

```
amt = Intensity * stockIntMul * lumaAmt * 0.15
```

The `0.15` is a fixed ceiling so Intensity=1 on 35mm is strong-but-sane rather than blowing out. `stockIntMul` from the preset: S8=3.2, 16mm=2.0, 35mm=1.0, 65mm=0.45.

Intensity multipliers do NOT equal the raw enlargement×speed-bias figures (4.4 / 2.3 / 1.0 / 0.4). Reason: in this shader the "bigger grain is more visible" half of enlargement is *already delivered by `sizeMul`* - a 3.8× cell spans ~6 px so its full per-cell amplitude hits the display with no intra-pixel averaging. Stacking the full physical visibility figure on top would double-count and overdrive (S8 at 20% slider would already sit near the single-unit ceiling, wasting the top 80% of the slider). So intensity is tempered ~27% on Super 8 (4.4→3.2) and trimmed slightly on 16mm (2.3→2.0), while 35mm is the true reference at exactly 1.0 (so the slider means what it says, and Custom=1.0/1.0 aligns with 35mm rather than being grainier than it). 65mm is nudged up (0.4→0.45) because sub-pixel cells partially self-average, dropping effective amplitude below nominal.

---

## 7. Per-frame animation

DCTL exposes the current frame via the built-in `TIMELINE_FRAME_INDEX`. Folding it into the seed reshuffles the whole field every frame — this is what makes grain "move" like projected film, with no keyframing. It's always on (video is a moving picture):

```
seed = Seed + TIMELINE_FRAME_INDEX * 17
```

(The web version has no timeline, so it increments the seed each `requestAnimationFrame` tick instead.)

---

## 8. Colour grain

Monochrome grain uses one field for all channels. Colour grain uses three decorrelated fields (seed offset by different primes), blended back toward mono by two controls:

```
gM = grainField(fx, fy, seed)                     # mono field
gR = grainField(fx, fy, seed + 101)               # per-channel fields
gG = grainField(fx, fy, seed + 227)
gB = grainField(fx, fy, seed + 353)

# pull channels toward mono by ColourSaturation, then toward mono by ColourGrain
gR = mix(gM, gR, ColourSaturation);  dR = mix(gM, gR, ColourGrain) * amt
gG = mix(gM, gG, ColourSaturation);  dG = mix(gM, gG, ColourGrain) * amt
gB = mix(gM, gB, ColourSaturation);  dB = mix(gM, gB, ColourGrain) * amt
```

At ColourGrain=0 all three deltas collapse to `gM*amt` → pure luma grain.

---

## 9. Composite

Additive grain, then a global blend against the original, then optional clamp:

```
out_c = mix( src_c, src_c + d_c, Blend )          # for c in {R,G,B}
if Clamp: out_c = clamp(out_c, 0, 1)
```

---

## Why this is a shader, not a LUT

Every step above reads `p_X, p_Y` (and, for animation, the frame index). A 3D LUT is a pure `RGB → RGB` map with no spatial or temporal input, so it structurally cannot produce grain. That is why this must be a DCTL / WebGL shader / OFX, never a `.cube`.
