// QR Paint - turns text into a QR code and lets you colour in its dark squares.
// The page uses TWO canvases stacked like layers:
//   qrCanvas    (bottom) - only ever shows the QR code (always on a white background)
//   paintCanvas (top)    - only ever holds the user's paint
// Keeping them separate means the eraser can remove paint without damaging the QR.

// ---------- Settings ----------
const QUIET_ZONE = 4; // QR rules say leave a 4-square empty border around the code so scanners can find its edges
const TARGET_PX = 1024; // roughly how many real pixels wide the canvas is (big = sharp downloads)
const MAX_UNDO = 5; // how many undo steps we remember (each step uses memory, so we cap it)
const BACKGROUND = "#ffffff"; // the QR background is always white (best for scanning)
const MAX_BRIGHTNESS = 140; // colours brighter than this (0 = black, 255 = white) are too light for cameras to tell apart from white
const LOGO_SHARE = 0.22; // the logo takes up 22% of the QR's width (about 5% of its area): safe, because level H can repair 30%
// Ready-made colours. Every one is dark enough to scan reliably on white (brightness 58-110 out of 255).
const PALETTE = [
  { hex: "#1b1b1f", name: "Ink black" }, { hex: "#374151", name: "Slate" }, { hex: "#1e3a8a", name: "Navy" },
  { hex: "#0369a1", name: "Ocean blue" }, { hex: "#0f766e", name: "Teal" }, { hex: "#15803d", name: "Forest green" },
  { hex: "#a16207", name: "Mustard" }, { hex: "#c2410c", name: "Burnt orange" }, { hex: "#b91c1c", name: "Red" },
  { hex: "#be185d", name: "Raspberry" }, { hex: "#6d28d9", name: "Purple" }, { hex: "#7c2d12", name: "Brown" },
];

// ---------- Grab the page elements we need (by their id in index.html) ----------
const textInput = document.getElementById("textInput"); // the text box the user types in
const message = document.getElementById("message"); // the line where we show tips and errors
const brushBtn = document.getElementById("brushBtn"); // the Brush tool button
const eraserBtn = document.getElementById("eraserBtn"); // the Eraser tool button
const brushColor = document.getElementById("brushColor"); // colour picker for the paint
const brushSize = document.getElementById("brushSize"); // slider for brush thickness
const sizeDot = document.getElementById("sizeDot"); // the circle that previews the brush size
const sizeValue = document.getElementById("sizeValue"); // the "14 px" number next to the slider label
const darkColor = document.getElementById("darkColor"); // colour picker for the QR's dark squares
const snapToggle = document.getElementById("snapToggle"); // checkbox for "snap to squares" mode
const undoBtn = document.getElementById("undoBtn"); // the Undo button
const clearBtn = document.getElementById("clearBtn"); // the Clear paint button
const formatButtons = document.querySelectorAll("[data-format]"); // the PNG and JPEG buttons (every element with a data-format attribute)
const downloadStatus = document.getElementById("downloadStatus"); // message line in the Download section
const qrCanvas = document.getElementById("qrCanvas"); // bottom canvas layer (QR)
const paintCanvas = document.getElementById("paintCanvas"); // middle canvas layer (paint)
const topCanvas = document.getElementById("topCanvas"); // top canvas layer (3D shading and logo)
const depthToggle = document.getElementById("depthToggle"); // the "3D look" switch
const shapeGroup = document.getElementById("shapeGroup"); // where the shape buttons go
const logoGroup = document.getElementById("logoGroup"); // where the logo buttons go

// A "context" is the drawing toolbox for a canvas: it has fillRect, lineTo, etc.
const qrCtx = qrCanvas.getContext("2d"); // toolbox for drawing the QR
const paintCtx = paintCanvas.getContext("2d"); // toolbox for drawing paint
const topCtx = topCanvas.getContext("2d"); // toolbox for the 3D shading and logo

// A hidden "mask" canvas (never shown on the page). It holds ONLY the dark squares, filled solid.
// After every brush stroke we use it like a stencil: paint is kept where the mask has a square, and removed everywhere else.
const maskCanvas = document.createElement("canvas"); // create the hidden canvas in memory
const maskCtx = maskCanvas.getContext("2d"); // its drawing toolbox

// ---------- State: values that change while the app runs ----------
let qr = null; // the current QR object from the library (null = no QR yet)
let cellPx = 0; // how many canvas pixels wide one QR square is
let tool = "brush"; // which tool is selected: "brush" or "eraser"
let isDrawing = false; // true while the mouse button / finger is held down
let lastX = 0; // where the pointer was last time (x), so we can draw a line to the new spot
let lastY = 0; // same, for y
let undoStack = []; // list of saved snapshots of the paint layer, newest last
let typingTimer = null; // used to wait until the user pauses typing before rebuilding the QR
let shape = "square"; // how each dark square is drawn (one of the ids in SHAPES below)
let logoImg = null; // the chosen logo, ready to draw (null = no logo)
// The square shapes on offer. Every one keeps the middle of each square dark, so scanners can still read it.
const SHAPES = [
  { id: "square", name: "Square" }, { id: "rounded", name: "Rounded" }, { id: "dots", name: "Dots" },
  { id: "fluid", name: "Fluid" }, { id: "leaf", name: "Leaf" }, { id: "diamond", name: "Diamond" },
  { id: "star", name: "Star" }, { id: "heart", name: "Heart" }, { id: "vbars", name: "Vertical bars" },
  { id: "hbars", name: "Horizontal bars" },
];
const NO_NEIGHBOURS = { up: false, down: false, left: false, right: false }; // used when a shape doesn't care about the squares next to it

// ---------- Build the QR code from the text ----------
function generateQR() {
  const text = textInput.value; // read what the user typed
  if (text.trim() === "") { // if the box is empty (or only spaces)...
    qr = null; // ...forget any old QR
    qrCtx.clearRect(0, 0, qrCanvas.width, qrCanvas.height); // wipe the QR layer
    paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height); // wipe the paint layer
    showMessage("Type something to make a QR code.", false); // tell the user what to do
    return; // stop here - nothing to draw
  }

  try { // "try" lets us catch errors instead of the page crashing
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"]; // tell the library to support emoji and all languages (UTF-8)
    const newQr = qrcode(0, "H"); // 0 = pick the size automatically; "H" = highest error correction (about 30% can be damaged and still scan)
    newQr.addData(text); // give it our text
    newQr.make(); // do the maths that turns the text into a grid of dark/light squares
    qr = newQr; // it worked, so make it the current QR
  } catch (err) { // the library throws an error if the text is too long to fit in any QR size
    showMessage("That's too long for a QR code. Try something shorter.", true); // explain the problem in plain words
    return; // stop - keep showing the old QR
  }

  const count = qr.getModuleCount(); // how many squares across the QR is (e.g. 25, 29, 33...)
  const totalCells = count + QUIET_ZONE * 2; // add the empty border on both sides
  cellPx = Math.floor(TARGET_PX / totalCells); // whole-number square size so edges stay crisp (no half pixels)
  const size = cellPx * totalCells; // final canvas width/height in pixels

  qrCanvas.width = qrCanvas.height = size; // new text = new pattern, so resize the QR layer (resizing also clears it)
  paintCanvas.width = paintCanvas.height = size; // resize the paint layer too (old paint wouldn't line up with the new squares)
  maskCanvas.width = maskCanvas.height = size; // and the hidden mask, so the stencil lines up with the layers
  topCanvas.width = topCanvas.height = size; // and the 3D/logo layer
  undoStack = []; // old undo snapshots are for the old QR, so throw them away

  drawQR(); // actually draw the squares
  checkContrast(); // warn the user if their colour choice might not scan
}

// ---------- Is this square part of one of the three big corner markers ("finder patterns")? ----------
function isFinder(row, col, count) { // the 7x7 blocks in the top-left, top-right and bottom-left corners
  return (row < 7 && col < 7) || (row < 7 && col >= count - 7) || (row >= count - 7 && col < 7); // true inside any of the three
}

// ---------- Draw one whole corner marker as a SOLID ring plus a centre block ----------
// Scanners find a QR by these three markers, so they must have no gaps, even when the other squares are dots.
function drawFinder(ctx, x, y, s) { // (x, y) = the marker's top-left corner, s = one square's size
  const r = shape === "square" ? 0 : s; // corner roundness: none for the classic look, soft otherwise
  if (!ctx.roundRect) { ctx.fillRect(x, y, 7 * s, s); ctx.fillRect(x, y + 6 * s, 7 * s, s); ctx.fillRect(x, y, s, 7 * s); ctx.fillRect(x + 6 * s, y, s, 7 * s); ctx.fillRect(x + 2 * s, y + 2 * s, 3 * s, 3 * s); return; } // old browsers: plain squares
  ctx.beginPath(); // the outer ring...
  ctx.roundRect(x, y, 7 * s, 7 * s, r * 1.6); // ...is a 7x7 block...
  ctx.roundRect(x + s, y + s, 5 * s, 5 * s, r); // ...with a 5x5 hole cut out of it...
  ctx.fill("evenodd"); // ..."evenodd" fills only the part between the two outlines
  ctx.beginPath(); ctx.roundRect(x + 2 * s, y + 2 * s, 3 * s, 3 * s, r * 0.8); ctx.fill(); // the solid 3x3 centre block
}
function finderCorners(count) { // top-left corners (in pixels) of the three markers
  const far = (count - 7 + QUIET_ZONE) * cellPx, near = QUIET_ZONE * cellPx; // right/bottom and left/top positions
  return [[near, near], [far, near], [near, far]]; // top-left, top-right, bottom-left
}

// ---------- Which neighbours of a square are also dark? (the "Fluid" and "bars" shapes join up with them) ----------
function neighbours(row, col, count) {
  const dark = (r, c) => r >= 0 && c >= 0 && r < count && c < count && qr.isDark(r, c) && !isFinder(r, c, count); // inside the grid, dark, and not a corner marker
  return { up: dark(row - 1, col), down: dark(row + 1, col), left: dark(row, col - 1), right: dark(row, col + 1) }; // one true/false per side
}

// ---------- Draw ONE dark square in the chosen shape ----------
function drawModule(ctx, x, y, s, n = NO_NEIGHBOURS) { // ctx = which canvas, (x, y) = top-left corner, s = square size, n = dark neighbours
  if (shape === "square" || !ctx.roundRect) { ctx.fillRect(x, y, s, s); return; } // plain square (also the fallback for old browsers)
  const cx = x + s / 2, cy = y + s / 2; // the middle of the square
  const k = s * 0.5, b = s * 0.38; // corner sizes: half a square (fluid), and half a bar's width (bars)
  ctx.beginPath(); // start a new outline
  switch (shape) { // pick the outline for this shape
    case "rounded": ctx.roundRect(x + s * 0.04, y + s * 0.04, s * 0.92, s * 0.92, s * 0.32); break; // square with soft corners
    case "dots": ctx.arc(cx, cy, s * 0.46, 0, Math.PI * 2); break; // a circle
    case "leaf": ctx.roundRect(x + s * 0.04, y + s * 0.04, s * 0.92, s * 0.92, [s * 0.46, 0, s * 0.46, 0]); break; // top-left and bottom-right corners round, like a leaf
    case "fluid": // squares melt into their neighbours: a corner is only rounded when both sides touching it are empty
      ctx.roundRect(x, y, s, s, [!n.up && !n.left ? k : 0, !n.up && !n.right ? k : 0, !n.down && !n.right ? k : 0, !n.down && !n.left ? k : 0]); break; // corner order: top-left, top-right, bottom-right, bottom-left
    case "diamond": ctx.moveTo(cx, y); ctx.lineTo(x + s, cy); ctx.lineTo(cx, y + s); ctx.lineTo(x, cy); ctx.closePath(); break; // a square turned 45 degrees
    case "star": // a five-pointed star
      for (let i = 0; i < 10; i++) { // 10 corners: 5 outer points and 5 inner dips
        const rad = i % 2 ? s * 0.34 : s * 0.6, ang = -Math.PI / 2 + (i * Math.PI) / 5; // distance from the middle, and direction
        ctx.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad); // draw to that corner
      }
      ctx.closePath(); break; // join back to the start
    case "heart": // two bumps on top, a point at the bottom
      ctx.moveTo(cx, y + s); // the bottom point (touches the bottom edge)
      ctx.bezierCurveTo(x - s * 0.2, y + s * 0.52, x + s * 0.02, y - s * 0.1, cx, y + s * 0.24); // left half, curving up to the dip in the top
      ctx.bezierCurveTo(x + s * 0.98, y - s * 0.1, x + s * 1.2, y + s * 0.52, cx, y + s); break; // right half, back down to the point
    case "vbars": ctx.roundRect(x + s * 0.12, y, s * 0.76, s, [!n.up ? b : 0, !n.up ? b : 0, !n.down ? b : 0, !n.down ? b : 0]); break; // joins the squares above and below into upright bars
    case "hbars": ctx.roundRect(x, y + s * 0.12, s, s * 0.76, [!n.left ? b : 0, !n.right ? b : 0, !n.right ? b : 0, !n.left ? b : 0]); break; // joins left/right neighbours into lying bars
  }
  ctx.fill(); // fill the outline with the current colour
}

// ---------- Where the logo goes (in canvas pixels), or null if there's no logo ----------
function logoBox() {
  if (!logoImg || !qr) return null; // no logo, or no QR yet
  const count = qr.getModuleCount(); // squares across
  let cells = Math.round(count * LOGO_SHARE); // logo plate width, in squares
  if (cells % 2 !== count % 2) cells += 1; // same odd/even as the QR, so the plate sits exactly in the middle of the grid
  const start = QUIET_ZONE + (count - cells) / 2; // first square the plate covers (from the canvas edge)
  return { x: start * cellPx, y: start * cellPx, size: cells * cellPx }; // its position and size in pixels
}

// ---------- Draw the QR squares onto the bottom canvas (and the hidden mask) ----------
function drawQR() {
  const count = qr.getModuleCount(); // number of squares across
  const depth = depthToggle.checked; // is the 3D look on?
  qrCtx.fillStyle = BACKGROUND; // the background is always white
  qrCtx.fillRect(0, 0, qrCanvas.width, qrCanvas.height); // fill the whole layer with it (this includes the quiet zone)
  maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height); // empty the stencil before redrawing it
  qrCtx.fillStyle = darkColor.value; // choose the dark-square colour for the visible layer
  maskCtx.fillStyle = "#000"; // the stencil's colour doesn't matter, only that it's solid
  if (depth) { // 3D look: each square casts a small soft shadow down and to the right
    qrCtx.shadowColor = "rgba(0, 0, 0, 0.16)"; // very light grey shadow, so the white gaps stay clearly white to a scanner
    qrCtx.shadowOffsetX = qrCtx.shadowOffsetY = cellPx * 0.1; // shadow shifted a little right and down
    qrCtx.shadowBlur = cellPx * 0.2; // soft edge
  }
  for (let row = 0; row < count; row++) { // go through every row of the grid...
    for (let col = 0; col < count; col++) { // ...and every column in that row
      if (qr.isDark(row, col) && !isFinder(row, col, count)) { // a dark square that isn't part of a corner marker (those are drawn whole, below)
        const x = (col + QUIET_ZONE) * cellPx; // pixel position: skip the border, then move col squares right
        const y = (row + QUIET_ZONE) * cellPx; // same for rows, moving down
        const n = neighbours(row, col, count); // which sides touch other dark squares
        drawModule(qrCtx, x, y, cellPx, n); // draw one dark square you can see
        drawModule(maskCtx, x, y, cellPx, n); // and the same shape on the hidden stencil
      }
    }
  }
  for (const [x, y] of finderCorners(count)) { drawFinder(qrCtx, x, y, cellPx); drawFinder(maskCtx, x, y, cellPx); } // the three corner markers, solid
  qrCtx.shadowColor = "transparent"; // switch shadows off again for anything drawn later
  const box = logoBox(); // where the logo sits, if there is one
  if (box) { // keep paint out from under the logo
    maskCtx.clearRect(box.x, box.y, box.size, box.size); // no stencil there, so paint can't stick
    applyMask(); // and remove any paint that's already there
  }
  drawTop(); // redraw the 3D shading and logo on the top layer
}

// ---------- One bevel rim: the part of every shape that a copy shifted by (dx, dy) does NOT cover ----------
// Shift right/down and you get the top-left rims; shift left/up and you get the bottom-right rims.
// Built from the stencil, so it follows every shape and joined-up shapes have no seams.
const bevelCanvas = document.createElement("canvas"); // hidden scratch canvas (reused)
function bevel(dx, dy, colour) {
  bevelCanvas.width = maskCanvas.width; bevelCanvas.height = maskCanvas.height; // same size as the stencil (this also clears it)
  const b = bevelCanvas.getContext("2d"); // its toolbox
  b.drawImage(maskCanvas, 0, 0); // copy all the shapes
  b.globalCompositeOperation = "destination-out"; // next drawing cuts holes instead of painting
  b.drawImage(maskCanvas, dx, dy); // cut away a shifted copy: only a thin rim on one side of each shape is left
  b.globalCompositeOperation = "source-in"; // next drawing only colours what's left
  b.fillStyle = colour; b.fillRect(0, 0, bevelCanvas.width, bevelCanvas.height); // colour the rim
  topCtx.drawImage(bevelCanvas, 0, 0); // put it on the top layer
}

// ---------- Top layer: 3D bevel on every shape, then the logo ----------
function drawTop() {
  topCtx.clearRect(0, 0, topCanvas.width, topCanvas.height); // start empty
  if (!qr) return; // nothing to decorate yet
  const count = qr.getModuleCount(); // squares across
  if (depthToggle.checked) { // 3D look is on: a bevel along the edges of every shape
    const d = Math.max(1, Math.round(cellPx * 0.14)); // bevel width in pixels
    bevel(d, d, "rgba(255, 255, 255, 0.3)"); // light rim on the top-left edges, as if lit from the top-left
    bevel(-d, -d, "rgba(0, 0, 0, 0.4)"); // dark rim on the bottom-right edges (darker is always safe for scanning)
  }
  const box = logoBox(); // where the logo goes
  if (!box) return; // no logo: done
  topCtx.fillStyle = BACKGROUND; // a white plate behind the logo, so it doesn't mix with the squares
  topCtx.beginPath(); // start the plate outline
  if (topCtx.roundRect) topCtx.roundRect(box.x, box.y, box.size, box.size, cellPx * 0.8); else topCtx.rect(box.x, box.y, box.size, box.size); // rounded plate (plain square on old browsers)
  topCtx.fill(); // paint the plate
  const pad = cellPx * 0.7; // empty space between the plate edge and the logo
  const room = box.size - pad * 2; // the space the logo can use
  const scale = Math.min(room / logoImg.width, room / logoImg.height); // shrink to fit without stretching
  const w = logoImg.width * scale, h = logoImg.height * scale; // the logo's drawn size
  topCtx.drawImage(logoImg, box.x + (box.size - w) / 2, box.y + (box.size - h) / 2, w, h); // draw it centred on the plate
}

// ---------- Keep paint ONLY on the dark squares ----------
function applyMask() {
  paintCtx.globalCompositeOperation = "destination-in"; // special mode: keep existing paint only where the new image has pixels
  paintCtx.drawImage(maskCanvas, 0, 0); // "draw" the stencil - paint outside the dark squares disappears
  paintCtx.globalCompositeOperation = "source-over"; // switch back to normal drawing mode for the next stroke
}

// ---------- Warn if the QR colour is too light for a scanner to read ----------
function brightness(hex) { // turns a colour like "#1b1b1f" into a brightness from 0 (black) to 255 (white)
  const r = parseInt(hex.slice(1, 3), 16); // red part (characters 1-2), read as a base-16 number
  const g = parseInt(hex.slice(3, 5), 16); // green part
  const b = parseInt(hex.slice(5, 7), 16); // blue part
  return 0.299 * r + 0.587 * g + 0.114 * b; // standard formula: eyes (and cameras) see green as brightest
}

function scanSafe(hex) { // returns the colour, darkened just enough if it's too light to scan
  const bright = brightness(hex); // how light it is (0-255)
  if (bright <= MAX_BRIGHTNESS) return hex; // dark enough already: keep it
  const f = MAX_BRIGHTNESS / bright; // how much to darken by (e.g. 0.7 = 30% darker)
  const part = (i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * f).toString(16).padStart(2, "0"); // darken one of red/green/blue and turn it back into 2 hex digits
  return "#" + part(1) + part(3) + part(5); // the darker colour, e.g. "#a3307a"
}

function checkContrast() {
  const diff = brightness(BACKGROUND) - brightness(darkColor.value); // how much darker the code is than the white background
  if (diff < 100) { // too close to white - a camera may not tell the squares apart
    showMessage("Heads up: that QR colour is quite light. Darker colours scan more reliably.", true); // gentle warning
  } else { // the colour is fine
    showMessage(`QR ready: ${qr.getModuleCount()} × ${qr.getModuleCount()} squares. Start painting!`, false); // confirmation with the grid size
  }
}

// ---------- Show a message ----------
function showMessage(text, isError, element = message) { // element defaults to the top message line
  element.textContent = text; // put the words on the page
  element.classList.toggle("error", isError); // add the red "error" style only when isError is true
}

// ---------- Brush size preview circle ----------
function updateSizeDot() {
  const size = brushSize.value + "px"; // the slider value is in screen pixels, which is exactly how big the brush looks on the canvas
  sizeDot.style.width = size; // set the circle's width...
  sizeDot.style.height = size; // ...and height to the brush size
  sizeDot.style.background = tool === "eraser" ? "#999" : brushColor.value; // show the brush colour (grey for the eraser)
  sizeValue.textContent = brushSize.value + " px"; // show the exact number next to the "Brush size" label
  const percent = ((brushSize.value - brushSize.min) / (brushSize.max - brushSize.min)) * 100; // how far along the slider is, from 0% to 100%
  brushSize.style.setProperty("--fill", percent + "%"); // tell style.css how much of the bar to colour in
}

// ---------- Turn a mouse/finger position into canvas pixel coordinates ----------
function toCanvasPoint(event) {
  const rect = paintCanvas.getBoundingClientRect(); // where the canvas is on screen and how big it looks
  const scale = paintCanvas.width / rect.width; // the canvas has more real pixels than it looks, so we scale (e.g. 1024 / 512 = 2)
  return { // send back an object with x and y
    x: (event.clientX - rect.left) * scale, // pointer x minus the canvas's left edge, then scaled
    y: (event.clientY - rect.top) * scale, // pointer y minus the canvas's top edge, then scaled
  };
}

// ---------- Draw paint from one point to another ----------
function drawSegment(x0, y0, x1, y1) {
  if (snapToggle.checked) { // "snap to squares" mode: fill whole QR squares instead of a smooth line
    const dist = Math.hypot(x1 - x0, y1 - y0); // length of the movement (Pythagoras)
    const steps = Math.max(1, Math.ceil(dist / (cellPx / 2))); // check every half-square so fast moves don't skip squares
    for (let i = 0; i <= steps; i++) { // walk along the line in small steps
      const t = i / steps; // how far along we are, from 0 (start) to 1 (end)
      paintCell(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); // fill the square at this point on the line
    }
    if (tool === "brush" && (shape !== "square" || logoImg)) applyMask(); // round shapes and the logo area need trimming to the exact stencil
    return; // done
  }

  const scale = paintCanvas.width / paintCanvas.getBoundingClientRect().width; // same scaling idea as toCanvasPoint
  paintCtx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over"; // "destination-out" makes pixels see-through (erases); "source-over" paints normally
  paintCtx.strokeStyle = brushColor.value; // the paint colour (ignored by the eraser)
  paintCtx.lineWidth = Number(brushSize.value) * scale; // slider size in screen pixels, converted to canvas pixels
  paintCtx.lineCap = "round"; // round line ends make strokes look like a real brush
  paintCtx.lineJoin = "round"; // round corners where line pieces meet
  paintCtx.beginPath(); // start a new line shape
  paintCtx.moveTo(x0, y0); // put the pen at the old position
  paintCtx.lineTo(x1 + 0.01, y1); // draw to the new position (the tiny 0.01 makes a single click still leave a dot)
  paintCtx.stroke(); // actually put the ink down
  if (tool === "brush") applyMask(); // trim the new paint so it only covers dark squares (the eraser doesn't need this)
  paintCtx.globalCompositeOperation = "source-over"; // always leave the toolbox in normal mode
}

// ---------- Fill (or erase) the one QR square under a point ----------
function paintCell(x, y) {
  const col = Math.floor(x / cellPx); // which square column the point is in
  const row = Math.floor(y / cellPx); // which square row the point is in
  const qrRow = row - QUIET_ZONE; // the same row counted inside the QR (the border squares don't count)
  const qrCol = col - QUIET_ZONE; // the same column counted inside the QR
  const count = qr.getModuleCount(); // how many squares across the QR is
  const inside = qrRow >= 0 && qrRow < count && qrCol >= 0 && qrCol < count; // is the point actually on the QR, not the border?
  if (!inside || !qr.isDark(qrRow, qrCol)) return; // light square or border: do nothing, so only dark squares get coloured
  const px = col * cellPx; // left edge of that square, in pixels
  const py = row * cellPx; // top edge of that square, in pixels
  if (tool === "eraser") { // eraser tool...
    paintCtx.clearRect(px, py, cellPx, cellPx); // ...makes that square of the paint layer see-through again
  } else { // brush tool...
    paintCtx.fillStyle = brushColor.value; // ...use the paint colour
    paintCtx.fillRect(px, py, cellPx, cellPx); // ...fill the whole square
  }
}

// ---------- Undo ----------
function saveUndo() { // call this BEFORE changing the paint, so we can go back to how it was
  undoStack.push(paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height)); // copy every pixel of the paint layer
  if (undoStack.length > MAX_UNDO) undoStack.shift(); // too many? drop the oldest one (shift removes the first item)
}

function undo() {
  const snapshot = undoStack.pop(); // take the newest snapshot off the list (pop removes the last item)
  if (snapshot) paintCtx.putImageData(snapshot, 0, 0); // if there was one, paste it back over the paint layer
}

// ---------- Pointer events (work for mouse, pen and touch) ----------
function startStroke(event) { // begins a new brush stroke at the pointer's position
  saveUndo(); // remember the paint before this stroke, so Undo removes the whole stroke
  isDrawing = true; // we are now in the middle of a stroke
  paintCanvas.setPointerCapture(event.pointerId); // keep receiving moves even if the pointer leaves the canvas mid-stroke
  const p = toCanvasPoint(event); // where on the canvas they pressed
  lastX = p.x; // remember it as the starting point
  lastY = p.y; // (both x and y)
  drawSegment(p.x, p.y, p.x, p.y); // draw a dot right away, so a single click paints something
}

paintCanvas.addEventListener("pointerdown", (event) => { // the button/finger goes down on the canvas
  if (!qr) return; // no QR yet, so there's nothing to paint on
  event.preventDefault(); // stop the browser's own reactions to a press (text selection, drag-and-drop) from taking over
  startStroke(event); // begin painting
});

paintCanvas.addEventListener("pointermove", (event) => { // the pointer moves over the canvas
  if (!qr) return; // nothing to paint on yet
  if (!isDrawing) { // we think the stroke has ended...
    if ((event.buttons & 1) === 0) return; // ...and the main button really is up (buttons is a bit pattern; & 1 checks the left button), so do nothing
    startStroke(event); // ...but the button is still held! Something interrupted us, so pick the stroke back up
    return; // the dot is drawn; the next move continues the line
  }
  const p = toCanvasPoint(event); // the new position
  drawSegment(lastX, lastY, p.x, p.y); // connect the old position to the new one with paint
  lastX = p.x; // the new position becomes the "old" one for next time
  lastY = p.y; // (both x and y)
});

function stopDrawing() { isDrawing = false; } // ends the current stroke
paintCanvas.addEventListener("pointerup", stopDrawing); // button/finger lifted
paintCanvas.addEventListener("pointercancel", stopDrawing); // the browser interrupted (e.g. a phone call or gesture)
paintCanvas.addEventListener("contextmenu", (event) => event.preventDefault()); // block the right-click menu, which Windows opens on a ~1 second press-and-hold (touchpad, pen, touchscreen)
paintCanvas.addEventListener("dragstart", (event) => event.preventDefault()); // block the browser from treating a held press as "drag this picture somewhere"

// ---------- Tool buttons ----------
function selectTool(name) { // switch between "brush" and "eraser"
  tool = name; // remember the choice
  brushBtn.classList.toggle("active", name === "brush"); // highlight Brush only if it's selected
  eraserBtn.classList.toggle("active", name === "eraser"); // highlight Eraser only if it's selected
  paintCanvas.classList.toggle("eraser-cursor", name === "eraser"); // swap the mouse cursor: brush picture or eraser picture (see style.css)
  updateSizeDot(); // the preview circle turns grey for the eraser
}
brushBtn.addEventListener("click", () => selectTool("brush")); // clicking Brush selects the brush
eraserBtn.addEventListener("click", () => selectTool("eraser")); // clicking Eraser selects the eraser
brushSize.addEventListener("input", updateSizeDot); // moving the slider resizes the preview circle live
brushColor.addEventListener("input", updateSizeDot); // changing the paint colour recolours the preview circle
undoBtn.addEventListener("click", undo); // clicking Undo runs undo()

clearBtn.addEventListener("click", () => { // clicking Clear paint...
  saveUndo(); // ...first saves a snapshot so even "clear" can be undone
  paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height); // ...then wipes the paint layer (the QR stays)
});

document.addEventListener("keydown", (event) => { // listen for keyboard presses anywhere on the page
  const typing = document.activeElement === textInput; // is the user typing in the text box?
  if ((event.ctrlKey || event.metaKey) && event.key === "z" && !typing) { // Ctrl+Z (Cmd+Z on Mac), but not while typing text
    event.preventDefault(); // stop the browser's own undo from also running
    undo(); // undo the last stroke
  }
});

// ---------- Download: merge both layers into one image file ----------
function makeImageBlob(mimeType) { // builds the final picture; returns a "Promise" (a value that arrives a little later)
  const merged = document.createElement("canvas"); // a hidden, temporary canvas (never added to the page)
  merged.width = qrCanvas.width; // same size as our layers
  merged.height = qrCanvas.height; // (width and height)
  const ctx = merged.getContext("2d"); // its drawing toolbox
  ctx.drawImage(qrCanvas, 0, 0); // copy the QR layer first (bottom, includes the white background)...
  ctx.drawImage(paintCanvas, 0, 0); // ...then the paint layer on top...
  ctx.drawImage(topCanvas, 0, 0); // ...then the 3D shading and logo, exactly like on screen
  return new Promise((resolve) => merged.toBlob(resolve, mimeType, 0.95)); // turn it into a file in memory; 0.95 = JPEG quality (95%), PNG ignores it
}

async function saveImage(format) { // "async" means this function can wait (await) for slow things like the save dialog
  if (!qr) return; // nothing to save yet
  const mimeType = "image/" + format; // the official file-type name, e.g. "image/png" or "image/jpeg"
  const extension = format === "jpeg" ? ".jpg" : ".png"; // the file ending people expect
  const fileName = "qr-paint" + extension; // suggested name for the file
  const blob = await makeImageBlob(mimeType); // wait for the picture to be built

  if ("showSaveFilePicker" in window) { // newer browsers (Chrome, Edge) can show a proper "Save as" dialog
    try { // the user might press Cancel, which counts as an error
      const handle = await window.showSaveFilePicker({ // open the dialog and wait for the user to choose
        suggestedName: fileName, // pre-fill the file name
        types: [{ description: format.toUpperCase() + " image", accept: { [mimeType]: [extension] } }], // only offer this file type
      });
      const writable = await handle.createWritable(); // open the chosen file for writing
      await writable.write(blob); // write the picture into it
      await writable.close(); // finish and save the file
      showMessage(`Saved ${handle.name}.`, false, downloadStatus); // confirm with the name they chose
    } catch (err) { // something stopped the save
      if (err.name !== "AbortError") { // AbortError just means they pressed Cancel, which is fine
        showMessage("Couldn't save the file. Please try again.", true, downloadStatus); // a real problem
      }
    }
    return; // done - don't also run the fallback below
  }

  // Fallback for browsers without the dialog (Firefox, Safari): a normal download to the Downloads folder.
  const link = document.createElement("a"); // make an invisible download link
  link.href = URL.createObjectURL(blob); // point the link at the in-memory file
  link.download = fileName; // the file name the browser will save it as
  link.click(); // "click" the link for the user, which starts the download
  setTimeout(() => URL.revokeObjectURL(link.href), 1000); // free the memory a second later (doing it instantly can cancel the download in some browsers)
  showMessage(`Downloaded ${fileName}.`, false, downloadStatus); // confirm it happened
}

formatButtons.forEach((button) => { // for each format button (PNG and JPEG)...
  button.addEventListener("click", () => saveImage(button.dataset.format)); // ...clicking it saves in that button's format ("png" or "jpeg")
});

// ---------- Rebuild the QR when the user types or changes its colour ----------
textInput.addEventListener("input", () => { // runs on every key press in the text box
  clearTimeout(typingTimer); // cancel the previous wait, because they're still typing
  typingTimer = setTimeout(generateQR, 300); // rebuild 300ms after they stop typing (new text = fresh paint)
});
// ---------- Colour swatches ----------
function buildSwatches(box, input) { // fills a swatch row with the PALETTE circles; clicking one sets the given colour input
  const custom = box.querySelector(".custom"); // the "pick your own" circle stays last
  PALETTE.forEach((c) => { // one button per colour
    const b = document.createElement("button"); // make the button
    b.type = "button"; b.className = "swatch"; b.title = c.name; // style and tooltip
    b.setAttribute("aria-label", c.name); b.dataset.hex = c.hex; // name for screen readers, colour for our code
    b.style.background = c.hex; // show the colour
    b.addEventListener("click", () => { input.value = c.hex; input.dispatchEvent(new Event("input")); }); // choose it (and run the input's normal reaction)
    box.insertBefore(b, custom); // add it before the custom circle
  });
  markSwatch(box, input.value); // tick the starting colour
}
function markSwatch(box, hex) { // puts the tick on the matching circle (or on the custom one if none match)
  let found = false; // did a ready-made colour match?
  box.querySelectorAll(".swatch[data-hex]").forEach((b) => { const on = b.dataset.hex === hex.toLowerCase(); b.classList.toggle("active", on); found = found || on; }); // tick the match only
  box.querySelector(".custom").classList.toggle("active", !found); // otherwise the custom circle is the active one
}
function keepScannable(input, label) { // darkens a too-light custom colour and says so; returns true if it changed
  const safe = scanSafe(input.value); // the scannable version
  if (safe === input.value.toLowerCase()) return false; // it was fine
  input.value = safe; // swap in the darker colour
  showMessage(`That ${label} colour was too light to scan, so it was darkened a little.`, true); // explain why it changed
  return true; // it changed
}
const brushSwatches = document.getElementById("brushSwatches"); // the brush colour row
buildSwatches(brushSwatches, brushColor); // fill it with the scan-safe colours
brushColor.addEventListener("input", () => { keepScannable(brushColor, "brush"); markSwatch(brushSwatches, brushColor.value); }); // paint covers the dark squares, so it must be dark enough too

// ---------- Shape buttons (each shows a small preview of the shape) ----------
function previewShape(canvas, id) { // draws a 3x3 sample pattern in the given shape
  const sample = [[1, 1, 0], [0, 1, 1], [1, 1, 0]]; // which sample squares are dark (1)
  const ctx = canvas.getContext("2d"), s = canvas.width / 3; // toolbox and the size of one sample square
  const on = (r, c) => !!(sample[r] && sample[r][c]); // is this sample square dark? (false outside the 3x3)
  const saved = shape; shape = id; // borrow drawModule with this shape for a moment
  ctx.fillStyle = "#1b1b1f"; // ink black
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { // every sample square
    if (on(r, c)) drawModule(ctx, c * s, r * s, s, { up: on(r - 1, c), down: on(r + 1, c), left: on(r, c - 1), right: on(r, c + 1) }); // draw the dark ones
  }
  shape = saved; // put the real choice back
}
SHAPES.forEach((sh) => { // one button per shape
  const b = document.createElement("button"); // the button
  b.type = "button"; b.className = "pick" + (sh.id === shape ? " active" : ""); b.title = sh.name; // style, starting highlight and tooltip
  b.setAttribute("aria-pressed", sh.id === shape); // tells screen readers which one is chosen
  const c = document.createElement("canvas"); c.width = c.height = 54; // small preview picture (drawn at 54px, shown at 27px for sharpness)
  previewShape(c, sh.id); // draw the sample
  const label = document.createElement("span"); label.textContent = sh.name; // the name under it
  b.append(c, label); // put both in the button
  b.addEventListener("click", () => { // choosing this shape
    shape = sh.id; // remember it
    shapeGroup.querySelectorAll(".pick").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", x === b); }); // highlight only this one
    if (qr) { drawQR(); applyMask(); } // redraw, and trim existing paint to the new shapes
  });
  shapeGroup.appendChild(b); // add it to the grid
});
depthToggle.addEventListener("change", () => { if (qr) drawQR(); }); // 3D on/off: redraw the shadows and shading

// ---------- Logo buttons (social media platforms from logos.js) ----------
function logoSvg(L) { // the logo as an app-style tile: brand-coloured rounded square with the icon on top
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 24 24">` + // 240px picture, drawn in a 24-unit box
    `<rect width="24" height="24" rx="5.5" fill="${L.hex}"/>` + // the coloured tile
    `<path transform="translate(4.8 4.8) scale(0.6)" fill="${L.glyph}" d="${L.path}"/></svg>`; // the icon, shrunk to 60% and centred
}
function chooseLogo(L, button) { // L = a logo from SOCIAL_LOGOS, or null for "None"
  logoGroup.querySelectorAll(".pick").forEach((x) => { x.classList.toggle("active", x === button); x.setAttribute("aria-pressed", x === button); }); // highlight the chosen button
  if (!L) { logoImg = null; if (qr) { drawQR(); checkContrast(); } return; } // "None": remove the logo and redraw
  const img = new Image(); // a picture object for the tile
  img.onload = () => { // once it's ready...
    logoImg = img; // ...use it
    if (qr) drawQR(); // draw it in the middle
    showMessage(`${L.name} logo added. Test-scan your QR with a phone before printing it.`, false); // gentle reminder
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(logoSvg(L)); // turn the SVG text into a picture (no download needed)
}
[null, ...SOCIAL_LOGOS].forEach((L) => { // "None" first, then every platform
  const b = document.createElement("button"); // the button
  b.type = "button"; b.className = "pick" + (L ? "" : " active"); b.title = L ? L.name : "No logo"; // "None" starts selected
  b.setAttribute("aria-pressed", !L); // screen readers: is it chosen?
  b.innerHTML = L ? logoSvg(L).replace('width="240" height="240"', 'width="27" height="27" aria-hidden="true"') : '<span class="none-icon" aria-hidden="true">∅</span>'; // small icon (our own fixed SVG text, never user input)
  const label = document.createElement("span"); label.textContent = L ? L.name : "None"; // the name under it
  b.appendChild(label); // add the name
  b.addEventListener("click", () => chooseLogo(L, b)); // clicking chooses it
  logoGroup.appendChild(b); // add it to the grid
});

// ---------- Light / dark mode switch ----------
const themeToggle = document.getElementById("themeToggle"); // the sliding switch in the header
themeToggle.checked = document.documentElement.dataset.theme === "dark"; // start the switch in the right position (the script in index.html already chose the theme)
themeToggle.addEventListener("change", () => { // runs when the user flips the switch
  const theme = themeToggle.checked ? "dark" : "light"; // ticked = dark, unticked = light
  document.documentElement.dataset.theme = theme; // update <html data-theme="...">, and style.css swaps the colours instantly
  try { localStorage.setItem("qrpaint-theme", theme); } catch (e) {} // remember the choice for next visit (ignored if the browser blocks storage)
});

// ---------- Page view counter (talks to the HitCounter Java API) ----------
// Every time this page is opened (or reloaded), we tell the counter API, which adds 1 and sends back the total.
const LIVE_COUNTER_API = "https://hitcounter-847387196162.asia-southeast1.run.app"; // HitCounter on Google Cloud Run (project fridgechef-56971, Singapore); "" = no counter on the live site
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname); // are we running on your own computer?
const COUNTER_API = isLocal ? "http://localhost:8081" : LIVE_COUNTER_API; // your PC talks to your local API; the live site talks to the online one
const COUNTER_SITE = isLocal ? "qrpaint-dev" : "qrpaint"; // local testing gets its own count, so your test reloads don't inflate the real number
const viewCount = document.getElementById("viewCount"); // the spot in the tip where the number goes

async function loadViewCount() { // "async" so we can wait for the API without freezing the page
  if (!COUNTER_API) return; // no API address set (live site before HitCounter is online): skip quietly
  try { // if anything goes wrong (API offline, asleep, refused), we just quietly show no number
    const controller = new AbortController(); // lets us cancel the request...
    const timer = setTimeout(() => controller.abort(), 8000); // ...if it takes longer than 8 seconds
    const response = await fetch(`${COUNTER_API}/hit/${COUNTER_SITE}`, { method: "POST", signal: controller.signal }); // count this page view
    clearTimeout(timer); // it answered in time, so cancel the timeout
    if (!response.ok) return; // e.g. 429 Too Many Requests or 404: show nothing
    const data = await response.json(); // read the answer, e.g. { site: "qrpaint", count: 1284 }
    const times = data.count === 1 ? "time" : "times"; // "1 time" but "2 times"
    viewCount.textContent = `👀 QR Paint has been opened ${data.count.toLocaleString()} ${times}.`; // toLocaleString adds commas: 1284 -> "1,284"
    viewCount.hidden = false; // show it
  } catch (err) { // network error or timeout
    // Do nothing: the tip still shows, just without the number.
  }
}

// ---------- Start ----------
loadViewCount(); // count this visit and show the total in the tip (runs in the background)
updateSizeDot(); // draw the size preview circle at its starting size
if (typeof qrcode === "undefined") { // the library didn't load (e.g. no internet)
  showMessage("Couldn't load the QR library. Check your internet connection and refresh.", true); // explain instead of failing silently
} else { // the library is ready
  generateQR(); // draw the example QR straight away
}
