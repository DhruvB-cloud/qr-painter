// easter-egg.js - a secret "party mode" for QR Paint.
// How to find it: flip the light/dark switch 5 times, with no more than 10 seconds between flips.
// What happens: fireworks, stronger warm-pulsing background colours, glassier cards, and soft music.
// Nothing is saved, so refreshing the page turns it all off.

// ---------- Settings ----------
const FLIPS_NEEDED = 5; // how many flips unlock the secret
const MAX_GAP_MS = 10000; // the longest allowed pause between flips (10,000 milliseconds = 10 seconds)
const FIREWORKS_MS = 4000; // how long new fireworks keep launching (4 seconds - short and punchy)
const MUSIC_VOLUME = 0.06; // overall music loudness (0 = silent, 1 = full); kept low and mellow on purpose

// ---------- Counting the flips ----------
let flipCount = 0; // how many flips in a row so far
let lastFlipTime = 0; // when the last flip happened (in milliseconds)
let partyStarted = false; // stops the secret from starting twice

document.getElementById("themeToggle").addEventListener("change", () => { // runs on every flip of the switch
  const now = Date.now(); // the current time in milliseconds
  if (now - lastFlipTime > MAX_GAP_MS) flipCount = 0; // too long since the last flip? start counting again
  flipCount++; // count this flip
  lastFlipTime = now; // remember when it happened
  if (flipCount >= FLIPS_NEEDED && !partyStarted) startParty(); // 5 in a row and not started yet: go!
});

// ---------- Starting party mode ----------
function startParty() {
  partyStarted = true; // only ever start once per page load
  document.body.classList.add("party"); // style.css: stronger colours, warm pulse, glassier cards
  showToast("🎆 Secret found! Refresh to go back to normal."); // tell them what happened and how to undo it (kept short so it fits on phones)
  startMusic(); // soft background music
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches; // has the user asked their computer for less motion?
  if (!calm) startFireworks(); // only show fireworks if they haven't
}

// ---------- The "you found it" message ----------
function showToast(text) {
  const toast = document.createElement("div"); // a new box for the message
  toast.className = "egg-toast"; // styled in style.css
  toast.setAttribute("role", "status"); // screen readers will read it out
  toast.textContent = text; // the message
  document.body.append(toast); // put it on the page
  setTimeout(() => toast.classList.add("hide"), 6000); // after 6 seconds, start fading it out
  setTimeout(() => toast.remove(), 7000); // after 7 seconds, remove it completely
}

// =====================================================================
// FIREWORKS - drawn on a full-window canvas.
// A "rocket" flies up; when it slows down at the top it "explodes" into
// many "particles" that spread out, fall with gravity and fade away.
// =====================================================================
function startFireworks() {
  const canvas = document.createElement("canvas"); // the drawing surface for the show
  canvas.className = "fx-canvas"; // full-window, click-through (see style.css)
  document.body.append(canvas); // add it to the page
  const ctx = canvas.getContext("2d"); // its drawing toolbox
  const dpr = window.devicePixelRatio || 1; // screens with extra-sharp pixels report 2 or more; we draw at that detail
  let width = 0; // window width in CSS pixels
  let height = 0; // window height in CSS pixels

  function resize() { // matches the canvas to the window size
    width = window.innerWidth; // window width
    height = window.innerHeight; // window height
    canvas.width = width * dpr; // real pixel width (sharper on high-detail screens)
    canvas.height = height * dpr; // real pixel height
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale drawing so we can keep thinking in CSS pixels
  }
  resize(); // size it now
  window.addEventListener("resize", resize); // and again if the window changes size

  const rockets = []; // rockets still flying up
  const particles = []; // sparks from explosions
  const startTime = performance.now(); // when the show began (a precise clock, in milliseconds)
  let nextLaunch = 0; // time of the next launch, counted from the start
  const warmHues = [0, 15, 30, 45, 330, 345, 280, 200]; // colour-wheel positions to pick from (mostly warm, with a few cool accents)

  function random(min, max) { return min + Math.random() * (max - min); } // a random number between min and max

  function launch() { // send up one new rocket
    rockets.push({ // add a rocket object to the list
      x: random(width * 0.15, width * 0.85), // somewhere across the middle of the screen
      y: height, // starting at the bottom edge
      vx: random(-0.6, 0.6), // a little sideways drift
      vy: -random(height * 0.016, height * 0.021), // upward speed, scaled to the window so it peaks in the top half
      hue: warmHues[Math.floor(Math.random() * warmHues.length)], // pick one colour for this rocket's explosion
    });
  }

  function explode(rocket) { // turn a rocket into a burst of particles
    const count = Math.round(random(60, 90)); // how many sparks
    for (let i = 0; i < count; i++) { // make each spark
      const angle = random(0, Math.PI * 2); // a random direction (a full circle is 2π radians)
      const speed = random(1, 4.5); // a random speed, so the burst looks round and full
      particles.push({ // add the spark
        x: rocket.x, y: rocket.y, // starts where the rocket exploded
        vx: Math.cos(angle) * speed, // sideways part of the speed (cos turns an angle into an x amount)
        vy: Math.sin(angle) * speed, // up/down part of the speed (sin gives the y amount)
        life: 1, // fully visible at the start; fades to 0
        decay: random(0.010, 0.018), // how fast this spark fades
        hue: rocket.hue + random(-15, 15), // close to the rocket's colour, with slight variety
      });
    }
  }

  function frame(now) { // draws one frame of animation (about 60 times a second)
    const elapsed = now - startTime; // how long the show has been running

    // Fade the previous frame a little instead of wiping it, which leaves glowing trails behind moving sparks.
    ctx.globalCompositeOperation = "destination-out"; // drawing now ERASES what's there
    ctx.fillStyle = "rgba(0, 0, 0, 0.2)"; // erase 20% each frame
    ctx.fillRect(0, 0, width, height); // over the whole canvas
    ctx.globalCompositeOperation = "lighter"; // overlapping light ADDS up, so sparks glow where they cross

    if (elapsed < FIREWORKS_MS && elapsed > nextLaunch) { // still in the launch window and it's time for another?
      launch(); // send one up
      nextLaunch = elapsed + random(50, 130); // schedule the next one very soon (5x more often than before = a dense show)
    }

    for (let i = rockets.length - 1; i >= 0; i--) { // update each rocket (looping backwards so removing items is safe)
      const r = rockets[i]; // this rocket
      r.x += r.vx; // move sideways
      r.y += r.vy; // move up (vy is negative)
      r.vy += 0.15; // gravity slows it down each frame
      ctx.fillStyle = `hsla(${r.hue}, 100%, 75%, 1)`; // a bright dot in its colour
      ctx.beginPath(); ctx.arc(r.x, r.y, 2.2, 0, Math.PI * 2); ctx.fill(); // draw it as a small circle
      if (r.vy >= -1) { explode(r); rockets.splice(i, 1); } // nearly stopped at the top: explode and remove the rocket
    }

    for (let i = particles.length - 1; i >= 0; i--) { // update each spark
      const p = particles[i]; // this spark
      p.vx *= 0.98; // air slows it down a little...
      p.vy = p.vy * 0.98 + 0.05; // ...and gravity pulls it down
      p.x += p.vx; // move sideways
      p.y += p.vy; // move up/down
      p.life -= p.decay; // fade a bit
      if (p.life <= 0) { particles.splice(i, 1); continue; } // fully faded: remove it and skip to the next spark
      ctx.fillStyle = `hsla(${p.hue}, 100%, 65%, ${p.life})`; // its colour, as see-through as it is faded
      ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill(); // draw it
    }

    const finished = elapsed > FIREWORKS_MS && rockets.length === 0 && particles.length === 0; // launches over and everything has faded?
    if (finished) { // the show is over...
      window.removeEventListener("resize", resize); // ...stop listening for window resizes
      canvas.remove(); // ...and remove the canvas from the page
      return; // stop the animation loop
    }
    requestAnimationFrame(frame); // ask the browser to call frame() again for the next screen refresh
  }
  requestAnimationFrame(frame); // start the animation
}

// =====================================================================
// MUSIC - generated live with the Web Audio API (no music file needed).
// Slow, soft chords (like a warm synth pad), a gentle low note,
// and a few music-box notes on top, with a little echo for space.
// =====================================================================
function startMusic() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext; // the sound engine (older Safari uses the webkit name)
  if (!AudioCtx) return; // very old browser without Web Audio: skip the music quietly
  const audio = new AudioCtx(); // create the engine; allowed because the user just clicked the switch

  // The "mixing desk": everything flows  sounds -> soft filter -> echo -> master volume -> speakers
  const master = audio.createGain(); // master volume knob ("gain" = volume)
  master.gain.setValueAtTime(0, audio.currentTime); // start silent...
  master.gain.linearRampToValueAtTime(MUSIC_VOLUME, audio.currentTime + 4); // ...and fade in gently over 4 seconds
  master.connect(audio.destination); // destination = the speakers

  const soften = audio.createBiquadFilter(); // a filter that shapes the sound
  soften.type = "lowpass"; // "lowpass" lets low sounds through and cuts harsh high ones = mellow
  soften.frequency.value = 1100; // cut everything above about 1100 Hz (Hz = vibrations per second)
  soften.connect(master); // filtered sound goes to the master volume

  const echo = audio.createDelay(); // an echo effect: repeats the sound slightly later
  echo.delayTime.value = 0.4; // repeat after 0.4 seconds
  const echoFeedback = audio.createGain(); // how much of each echo is echoed again
  echoFeedback.gain.value = 0.3; // 30%, so the echoes die away quickly
  soften.connect(echo); // send the filtered sound into the echo
  echo.connect(echoFeedback); // echo output loops back...
  echoFeedback.connect(echo); // ...into the echo (that's what makes repeats)
  echo.connect(master); // and the echoes are heard too

  function freq(note) { return 440 * Math.pow(2, (note - 69) / 12); } // turns a note number (MIDI: 60 = middle C, 69 = A) into a pitch in Hz

  // Four relaxing chords, as note numbers (Fmaj7 → Em7 → Dm7 → Cmaj7), gently stepping down.
  const chords = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 55, 59, 64]];
  const melodyNotes = [72, 74, 76, 79, 81, 84]; // the "pentatonic" scale: five notes that always sound nice together, so random picks never clash
  const BAR = 4; // each chord lasts 4 seconds - slow and calm

  function padNote(note, start, length, volume, wave) { // plays one soft, slowly swelling note
    const osc = audio.createOscillator(); // an oscillator makes a pure tone
    osc.type = wave; // its tone colour: "sine" is smooth, "triangle" is a bit warmer
    osc.frequency.value = freq(note); // its pitch
    const env = audio.createGain(); // this note's own volume (its "envelope": how it fades in and out)
    env.gain.setValueAtTime(0, start); // silent at the start
    env.gain.linearRampToValueAtTime(volume, start + 1.5); // swell in slowly over 1.5 seconds
    env.gain.setValueAtTime(volume, start + length - 0.5); // hold steady...
    env.gain.linearRampToValueAtTime(0, start + length + 1.5); // ...then fade out, overlapping the next chord so there are no gaps
    osc.connect(env); // tone -> its volume
    env.connect(soften); // -> the mellow filter (and on to the echo and speakers)
    osc.start(start); // begin at the planned time
    osc.stop(start + length + 1.6); // and stop once it has faded out (frees the memory)
  }

  function bellNote(note, start) { // plays one music-box "ding"
    const osc = audio.createOscillator(); // the tone
    osc.type = "sine"; // pure and bell-like
    osc.frequency.value = freq(note); // its pitch
    const env = audio.createGain(); // its volume
    env.gain.setValueAtTime(0, start); // silent...
    env.gain.linearRampToValueAtTime(0.18, start + 0.02); // ...a quick "ding"...
    env.gain.exponentialRampToValueAtTime(0.0001, start + 2.2); // ...that rings out and fades, like a real bell
    osc.connect(env); // tone -> volume
    env.connect(soften); // -> filter -> echo -> speakers
    osc.start(start); // play it
    osc.stop(start + 2.3); // clean up after it fades
  }

  function playBar(start, index) { // plans one 4-second chord, with its low note and some dings
    const chord = chords[index % chords.length]; // which chord (% = remainder, so it loops 0,1,2,3,0,1...)
    chord.forEach((note) => padNote(note, start, BAR, 0.16, "triangle")); // the soft chord
    padNote(chord[0] - 12, start, BAR, 0.22, "sine"); // a deep note one octave (12 notes) below, for warmth
    for (let beat = 0; beat < 4; beat++) { // four beats in each bar
      if (Math.random() < 0.5) { // about half of the beats get a ding, so it feels relaxed, not busy
        const note = melodyNotes[Math.floor(Math.random() * melodyNotes.length)]; // pick a pentatonic note
        bellNote(note, start + beat + Math.random() * 0.15); // play it on the beat, very slightly loose so it feels human
      }
    }
  }

  // The scheduler: every half second, plan any bars that start in the next 2 seconds.
  // Planning a little ahead keeps the music perfectly in time even if the page is busy.
  let nextBarTime = audio.currentTime + 0.1; // first chord starts almost immediately
  let barIndex = 0; // which bar we're on
  function scheduler() {
    while (nextBarTime < audio.currentTime + 2) { // any bar due soon that isn't planned yet?
      playBar(nextBarTime, barIndex); // plan it
      nextBarTime += BAR; // the next one starts 4 seconds later
      barIndex++; // move to the next chord
    }
  }
  scheduler(); // plan the first bars now
  setInterval(scheduler, 500); // keep planning forever (until the page is refreshed)
}
