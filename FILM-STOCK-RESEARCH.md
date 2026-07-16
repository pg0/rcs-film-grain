# Film-Stock-Research - Grain-Parameter je Format

Physikalische Herleitung der Stock-Presets (Super 8 / 16mm / 35mm / 65mm) für
`RCS Film Grain`. Recherchiert 2026-07-16, Werte per Fable-Review finalisiert.

## Kernidee

Kornkorn ist eine **feste physische Größe auf dem Negativ**. Sichtbare Korngröße im
fertigen Bild hängt fast nur davon ab, wie stark das Negativ auf ein gemeinsames
Ausgabeformat **vergrößert** wird. Kleines Negativ → mehr Vergrößerung → gröberes,
kontrastreicheres Korn. Die Filmstock-Presets skalieren Korngröße und -intensität
entlang genau dieses Vergrößerungsfaktors.

## 1. Aufnahme-Bildfeld (belichtete Negativfläche)

| Format | Bildfeld B×H (mm) | Seitenverhältnis | Notiz |
|---|---|---|---|
| Super 8 | 5.79 × 4.01 | 1.44:1 | Cartridge, Single-Perf |
| 16mm (Standard) | 10.26 × 7.49 | 1.37:1 | |
| Super 16 | 12.35 × 7.49 | 1.65:1 | Perf-versetzt, breiteres Gate |
| 35mm Academy (4-Perf) | 22.05 × 16.00 | 1.37:1 | Ton-Ära Kamera-Aperture |
| Super 35 (4-Perf Full-Ap) | 24.89 × 18.66 | 1.33:1 | wird in Post beschnitten |
| 65mm 5-Perf (Todd-AO) | 52.48 × 23.01 | ~2.20:1 | Kamera-Negativ |

Quellen: cinematography.net (16/Super16), matthewwagenknecht.com (35mm-Formate),
Wikipedia "Super 8 film" / "70 mm film".

## 2. Vergrößerungsfaktor (35mm Academy = 1.0)

Vergrößerung = 22.05 mm / Formatbreite. Das ist der physische Blow-up aufs
gemeinsame Ausgabeformat.

| Format | Breite (mm) | Vergrößerung vs 35mm |
|---|---|---|
| Super 8 | 5.79 | 3.81 |
| 16mm | 10.26 | 2.15 |
| Super 16 | 12.35 | 1.79 |
| 35mm Academy | 22.05 | 1.00 |
| Super 35 (Full-Ap) | 24.89 | 0.89 |
| 65mm 5-Perf | 52.48 | 0.42 |

## 3. RMS-Granularität / Filmempfindlichkeit

Kodak gibt in aktuellen Vision3-Datenblättern keine einzelne RMS-Zahl, sondern eine
Dichte-vs-Sigma-Kurve (48-µm-Apertur gescannt) - stock-spezifisch. Gesichert aus
Jahrzehnten Kodak-Daten: RMS-Granularität steigt grob mit Filmempfindlichkeit
(50D ganz unten, 200T/250D Mittelfeld, 500T ~doppeltes Sigma der 50er). Diese
Rohgranularität ist **unabhängig vom Kameraformat** - die physische Korngröße der
Emulsion ändert sich nicht mit dem Gauge. Was sich ändert ist die Vergrößerung.

Sekundär (Produktionskonvention, keine Physik): kleine Formate werden real oft auf
schnellerem/gröberem Stock gedreht (Super 8 / 16mm Run-and-Gun → 200T/500T),
Großformat 65mm eher auf feinem 50D/200T. Ein Per-Format-Preset darf diesen leichten
Speed-Bias mitnehmen.

## 4. Wahrnehmungs-Ranking (körnigst → sauberst)

1. **Super 8** - körnigst mit Abstand (~3.8-4.4× vs 35mm)
2. **16mm** - deutlich körnig (~2.1-2.3×), der klassische 16mm-Look
3. **Super 16** - sichtbar sauberer als 16mm (~1.8-1.9×), gleiche Emulsion aber breiteres Gate
4. **35mm Academy** - Referenz (1.0×)
5. **Super 35 (Full-Ap)** - minimal sauberer (~0.89×), nach Delivery-Crop faktisch wie Academy
6. **65mm 5-Perf** - sauberst mit Abstand (~0.4×), der Large-Format/IMAX-Look

## 5. Finale Preset-Werte (Fable-Review)

Größe = Vergrößerungsfaktor **verbatim** (reine Optik). Intensität ist **getempert**,
weil im Shader die "größeres Korn = sichtbarer"-Hälfte der Vergrößerung schon über
`sizeMul` geliefert wird - die volle Physik-Zahl obendrauf würde doppelt zählen und
den Slider überfahren.

| Stock | Negativ | Vergröß. | size × | intensity × | Charakter | Physik sagte |
|---|---|---|---|---|---|---|
| Super 8 | 5.79mm | 3.81 | **3.8** | **3.2** | boiling, chunky | 3.8 / 4.4 |
| 16mm | 10.26mm | 2.15 | **2.15** | **2.0** | gritty doc | 2.15 / 2.3 |
| 35mm | 22.05mm | 1.00 | **1.0** | **1.0** | reference, fine | 1.0 / 1.0 |
| 65mm | 52.48mm | 0.42 | **0.5** | **0.45** | whisper of texture | 0.42 / 0.4 |

Warum die Abweichungen:
- **35mm intMul = 1.0** (nicht 0.9): Referenz + Default, der Slider soll exakt heißen
  was draufsteht; sonst wäre Custom (1.0) körniger als 35mm - inkohärent.
- **Super 8 intMul 4.4 → 3.2**: bei 3.8× Größe spannt eine Kornzelle ~6px, volle
  Amplitude trifft den Schirm ohne Intra-Pixel-Mittelung → 3.2 reicht für "aggressiv
  körnig" und lässt die untere Slider-Hälfte nutzbar (bei 4.4 säße man bei 20%-Slider
  schon am Ceiling).
- **65mm nach oben genudged** (0.42→0.5 / 0.4→0.45): unter ~0.8px liest Korn wie
  digitales Sensorrauschen; Sub-Pixel-Zellen mitteln sich teilweise selbst weg →
  Intensität leicht anheben.

## 6. Umsetzung in beiden Tools

**Basis-Werte:** 35mm-Referenz = Intensity 0.2, Grain Size 1.6 px (bei 1080p).

**DCTL (`RCS Film Grain.dctl`):** DaVinci-DCTL kann keine Slider zurückschreiben
(keine Callbacks). Der Stock wirkt deshalb als **versteckter Multiplikator** in der
Mathematik (Zeilen ~109-112): `size = uSize × sizeMul × resScale`,
`amt = uIntensity × intMul × …`. Die Slider bleiben optisch bei 0.2 / 1.6, der
Output ändert sich trotzdem je Stock.

**Web-App (`film-grain-web`):** hier **befüllt** der Stock die Slider real (JS,
WYSIWYG). Kein versteckter Multiplikator - der Slider trägt den vollen Wert:

| Stock | Intensity-Slider | Grain-Size-Slider |
|---|---|---|
| Super 8 | 0.64 | 6.1 |
| 16mm | 0.40 | 3.44 |
| 35mm | 0.20 | 1.6 |
| 65mm | 0.09 | 0.8 |
| Custom | (unverändert) | (unverändert) |

(= 35mm-Basis × Multiplikator aus Abschnitt 5. Gleicher Look wie im DCTL, nur sind
die Zahlen hier sichtbar statt versteckt.)

## 7. Auflösungs-Normierung

Korn ist auf **1080p referenziert** und skaliert automatisch mit der Bildhöhe
(`resScale = Height / 1080`): 4K → ×2, 720p → ×0.67. Damit sieht das Korn auf jeder
Auflösung relativ zum Bild identisch aus (reale Filmkorn ist fixe Größe auf dem
Negativ - höhere Scan-Auflösung löst dasselbe Korn nur feiner auf). DCTL liest
`p_Height`, Web-App die Bildhöhe. Kein UI, komplett automatisch.
