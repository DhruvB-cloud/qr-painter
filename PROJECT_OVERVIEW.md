# Project Overview: QR Painter

Turn any link or message into a QR code, style it (10 square shapes, 3D look, a social media logo in the centre), then paint on its dark squares. It always stays scannable.
**Live:** https://dhruvb-cloud.github.io/qr-painter/

## Languages and tools
| Tool | Version | Used for |
|---|---|---|
| HTML, CSS, JavaScript | plain, no framework, no build step | The whole app |
| qrcode-generator | 1.4.4 (from jsDelivr) | Turning text into a QR grid |
| Simple Icons | 13.21.0 (copied into `logos.js`, CC0) | Social media logo shapes and brand colours |
| Canvas 2D API | built into browsers | Drawing the QR, paint, 3D shading and logo |
| Web Audio API | built into browsers | Easter-egg music |
| HitCounter (own Java Spring Boot API) | on Google Cloud Run | Page-view counter |
| Python 3 | any | `serve.py`, a local server with caching off |
| GitHub Pages | n/a | Hosting |

## Architecture and design
- **Three stacked canvases (layers):** `qrCanvas` (bottom: white background and dark squares), `paintCanvas` (middle: the user's paint) and `topCanvas` (top: 3D shading and the logo; clicks pass through it). Keeping them apart lets the eraser remove paint without harming the QR.
- **Stencil (mask) canvas:** a hidden canvas holds the exact dark shapes. After each stroke, paint outside the shapes is removed (`destination-in`), and the logo area is cut out of the stencil.
- **Shapes:** `drawModule()` draws one square in the chosen shape. Fluid and the bars look at which neighbours are dark (`neighbours()`) to join up. `SHAPES` lists them, and the buttons draw their own previews.
- **3D bevel:** `bevel()` copies the stencil, cuts away a shifted copy, and colours the thin rim that's left (light top-left, dark bottom-right).
- **Scan safety rules:** level H error correction. The corner markers are always solid (`drawFinder`). The QR is always ink black, and brush colours are limited to brightness ≤ 140 (`scanSafe`). The logo is limited to 22% of the width. The 3D shadow is light, so the gaps stay clearly white.
- **State in a few variables:** `qr`, `cellPx`, `tool`, `shape`, `logoImg` and the undo stack.

## Folder structure
```
qr-painter/
├── index.html          Page structure: 1 Content, 2 Style, 3 Paint, 4 Download
├── style.css           Layout, light/dark themes, swatches, the 16-colour background
├── app.js              QR generation, shapes, 3D, logo picker, brush swatches, painting, undo, download, theme, view counter
├── logos.js            16 social media logos (name, brand colour, icon shape) from Simple Icons
├── easter-egg.js       Fireworks, warm pulse and generated music
├── serve.py            Local development server (no caching)
├── README.md           Short readme
├── CHANGELOG.md        Version history
└── PROJECT_OVERVIEW.md This file
```

## How to run
```bash
cd /run/media/tipsy/DATA/Projects/github-repos/qr-painter
python3 serve.py   # then open http://localhost:8080
```
Going live = commit and push to `main`. GitHub Pages publishes it.
