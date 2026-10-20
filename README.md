# QR Painter

Turn any link or message into a QR code, then colour it in. Paint only sticks to the QR's dark squares, so the code still scans.

**Live:** https://dhruvb-cloud.github.io/qr-painter/

## Features

- QR code generated live as you type (error correction level H, so about 30% can be painted over and it still scans)
- Brush and eraser, brush colour and size, "snap to squares" pixel mode, undo (Ctrl+Z) and clear
- Paint is clipped to the dark squares using a hidden mask canvas
- Download as PNG or JPEG
- Light / dark mode switch (remembers your choice)
- Page-view counter powered by my own Java Spring Boot API (HitCounter)
- A hidden easter egg (hint: the switch)

## How it's built

Plain HTML, CSS and JavaScript - no framework, no build step.

| File | Job |
| --- | --- |
| `index.html` | Page structure |
| `style.css` | Layout, themes, the 16-colour background |
| `app.js` | QR generation, painting, undo, download, theme, view counter |
| `easter-egg.js` | Fireworks, warm pulse and generated music (Web Audio API) |
| `serve.py` | Local development server that disables caching |

QR codes are made with [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator).

## Run it locally

```
python serve.py
```

Then open http://localhost:8080.
