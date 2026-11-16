# Changelog

All changes to QR Painter, newest first.

## 1.2.0 — 2026-11-16
### Changed
- **QR colour option removed.** The QR is always ink black (the most reliable colour to scan). Colour comes from painting. The brush still has its 12 scan-safe colours.
- **10 square shapes** instead of 3: Square, Rounded, Dots, Fluid (squares melt into their neighbours), Leaf, Diamond, Star, Heart, Vertical bars and Horizontal bars. Each button shows a small preview. The corner markers always stay solid.
- **Logo: choose a social media platform instead of uploading.** 16 platforms (Instagram, YouTube, WhatsApp, Facebook, X, LinkedIn, Telegram, Snapchat, Spotify, GitHub, Pinterest, Threads, Discord, Reddit, TikTok, Gmail), drawn as brand-coloured app tiles. The icon shapes come from Simple Icons (CC0) and live in the new file `logos.js`, so nothing is downloaded at runtime.
- **Smoother 3D look.** It's now a bevel (light top-left rim, dark bottom-right rim) cut from the stencil, so joined shapes like Fluid and the bars have no seams or stripes.

### Tested
- All 10 shapes × (plain / 3D / 3D + logo) with a painted stroke were decoded at camera-like sizes. ZXing read every combination. jsQR (a weaker reader) read most, but not Star. Star is the most decorative shape, so test-scan it before printing. PNG download works with a logo.

## 1.1.0 — 2026-11-16
### Added
- **Scan-safe colour swatches** for the QR colour and the brush: 12 ready-made colours (ink black, slate, navy, ocean blue, teal, forest green, mustard, burnt orange, red, raspberry, purple, brown). All are dark enough to scan on white (brightness 58–110 out of 255).
- **Square shape option:** Square, Rounded or Dots. The three big corner markers are always drawn as solid rings, because scanners locate a QR by them.
- **3D look switch:** each square gets a soft shadow, a light top-left edge and a darker bottom-right edge. The shading sits on a new top canvas (`#topCanvas`), above the paint, so painted squares look 3D too.
- **Logo in the centre:** upload any image. It sits on a white rounded plate covering 22% of the QR's width (about 5% of its area; level H error correction can repair up to 30%). Paint can't go under the logo. Change or remove it at any time.
- `CHANGELOG.md` and `PROJECT_OVERVIEW.md`.

### Changed
- **Light colours are no longer possible.** If a too-light colour is picked with the custom picker, it is darkened just enough to stay scannable (brightness ≤ 140) and a message explains why. The same rule applies to the brush, because paint covers the dark squares.
- The side panel is now four steps: 1 Content, 2 Style, 3 Paint, 4 Download.
- Downloads include all three layers (QR, paint, 3D/logo).

### Tested
- Every combination (square / rounded / dots × 3D × logo × painted strokes × the lightest swatch) was decoded with two QR readers (jsQR and ZXing) at camera-like sizes. All decoded. At the full 1024-pixel size, a painted QR doesn't decode with these readers, but the original version behaves exactly the same, so this isn't new.

## 1.0.1 — 2026-10-20
- Connected the page-view counter to HitCounter on Cloud Run.

## 1.0.0 — 2026-10-20
- First version: live QR generation (level H), brush and eraser with paint clipped to the dark squares, snap to squares, undo, PNG/JPEG download, light/dark mode and an easter egg.
