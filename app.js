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
const paintCanvas = document.getElementById("paintCanvas"); // top canvas layer (paint)

// A "context" is the drawing toolbox for a canvas: it has fillRect, lineTo, etc.
const qrCtx = qrCanvas.getContext("2d"); // toolbox for drawing the QR
const paintCtx = paintCanvas.getContext("2d"); // toolbox for drawing paint

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
  undoStack = []; // old undo snapshots are for the old QR, so throw them away

  drawQR(); // actually draw the squares
  checkContrast(); // warn the user if their colour choice might not scan
}

// ---------- Draw the QR squares onto the bottom canvas (and the hidden mask) ----------
function drawQR() {
  const count = qr.getModuleCount(); // number of squares across
  qrCtx.fillStyle = BACKGROUND; // the background is always white
  qrCtx.fillRect(0, 0, qrCanvas.width, qrCanvas.height); // fill the whole layer with it (this includes the quiet zone)
  maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height); // empty the stencil before redrawing it
  qrCtx.fillStyle = darkColor.value; // choose the dark-square colour for the visible layer
  maskCtx.fillStyle = "#000"; // the stencil's colour doesn't matter, only that it's solid
  for (let row = 0; row < count; row++) { // go through every row of the grid...
    for (let col = 0; col < count; col++) { // ...and every column in that row
      if (qr.isDark(row, col)) { // the library tells us if this square should be dark
        const x = (col + QUIET_ZONE) * cellPx; // pixel position: skip the border, then move col squares right
        const y = (row + QUIET_ZONE) * cellPx; // same for rows, moving down
        qrCtx.fillRect(x, y, cellPx, cellPx); // draw one dark square you can see
        maskCtx.fillRect(x, y, cellPx, cellPx); // and the same square on the hidden stencil
      }
    }
  }
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
    return; // done - paintCell already skips light squares, so no stencil is needed
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
  ctx.drawImage(paintCanvas, 0, 0); // ...then the paint layer on top, exactly like on screen
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
darkColor.addEventListener("input", () => { if (qr) { drawQR(); checkContrast(); } }); // new QR colour: redraw the QR only, paint stays

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
const LIVE_COUNTER_API = ""; // HitCounter's online address (e.g. "https://hitcounter-xxxx.onrender.com"); empty = no counter on the live site yet
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
