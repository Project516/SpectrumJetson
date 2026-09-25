# Brief for chapter authors (temporary; deleted before publishing)

We're building a scrollable, highly visual training website that teaches FRC high-school students
how Spectrum 3847's Jetson vision system works. **Audience:** a student who has never seen a
single-board computer and doesn't know what an AprilTag is should walk away understanding the whole
system, basic and advanced. The owner explicitly said: *make it as visual as possible*; graphics,
animation, interactive labs, diagrams, flow charts. This is a showcase: aim for the best
explainer site these students have ever seen (think Bartosz Ciechanowski / Distill / Nicky Case
quality), accurate to the real system.

## Where things are

- Site root: `C:\GitHub\SpectrumJetson\training\` (served at http://localhost:8347/ by
  `python -m http.server 8347 --directory training`; it's already running. If it isn't, start it
  in the background yourself).
- `index.html`: the shell. Each chapter is `<section class="chapter" id="ID" data-src="chapters/NN-ID.html">`.
  **Do not edit** index.html, `css/site.css`, `js/site.js`, `js/glossary.js`, `js/hero.js`, or any
  chapter you don't own. If you need a shared change, say so in your final report.
- You own, per chapter: `chapters/NN-ID.html` (an HTML partial, no `<html>`/`<body>`; put
  chapter-specific CSS in a `<style>` block at its top, every selector prefixed with `#ID`) and
  `js/ch/NN-ID.js`.
- **Read first:** `chapters/01-mission.html`, `js/ch/01-mission.js` (the reference chapter),
  `css/site.css` (the design system: every class you can use), `js/site.js` (the helpers).
- Chapter JS pattern: `Site.chapter('ID', (root) => { ... })`. It runs once, when the chapter
  gets near the screen. Query inside `root`. Chapters 05 and 12 are loaded as ES modules
  (`<script type="module">`) so they can `import * as THREE from 'three'` and
  `import { OrbitControls } from 'three/addons/OrbitControls.js'` (import map in index.html;
  `three/addons/` maps to `vendor/addons/`, which has OrbitControls.js and RoundedBoxGeometry.js.
  If you need another three.js addon, copy it from
  https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/... into `vendor/addons/`, and fix its
  imports to `'three'`). A module script runs before the partials load, so still register with
  `Site.chapter`. All other chapter scripts are classic scripts.
- Helpers in `js/site.js`: `Site.canvas(cv, aspect)` (retina canvas, `{ctx,w,h}`, resizes itself),
  `Site.loop(el, fn(t, dt))` (rAF only while on screen; use it for every animation),
  `Site.onVisible`, `Site.scrolly(root, cb(i, stepEl))` (for `.scrolly` step layouts),
  `Site.range(input, fn, fmt)`, `Site.seg(el, fn)`, `Site.progress(el)`, `Site.clamp/lerp/ease`,
  AprilTags: `Site.tagGrid(id)` (real tag36h11 10x10 grid, 1 = white), `Site.drawTag`,
  `Site.tagSVG(id, px)`, `Site.tagCanvas(id, px)`, `Site.drawQuad(ctx, img, [[x,y]x4 TL,TR,BR,BL])`
  (perspective-warp an image into a quad), `Site._homog(quad, u, v)`. IDs 0–47 available.
- Glossary: hovering `<span class="term">word</span>` shows a definition from `js/glossary.js`.
  Add new terms from your chapter JS with `Object.assign(Site.glossary, {...})` at top level
  (outside `Site.chapter`) — don't edit glossary.js.

## Design system (Spectrum3847.org theme)

Purple `--p800 #3c0060`, lavender `--accent-soft #c4b5fd`, accent `--accent #8b5cf6`, ink
`#1f1b23`, Outfit headings, Plus Jakarta Sans body. Light content sections; interactive demos go
in dark `.lab` panels (`.lab-head` with `<span class="tag">Lab</span><h4>`, `.lab-grid` for
canvas + controls, `.ctl` sliders with `<label>Name <output></output></label>`, `.seg` segmented
buttons, `.readout` numbers, `.hint`). Other blocks: `.ch-head` (eyebrow with `.num`, h2 with an
`<em>` accent word, `p.lede`), `.prose`, `.split` / `.split.flip` / `.split.top`, `.fig` (white
framed figure), `.scrolly` (sticky visual + `.step` boxes), `.stats`/`.stat`, `.cards`/`.card`
(`.icon`, `.chip`), `.flow` (`.node` / `.arrow`), `table.data` in `.table-wrap`, callouts
`.callout.spectrum` ("What we did": our team's own work), `.callout.pitfall`, `.callout.idea`,
`.callout.analogy` (each with `<h5>`), `details.deep` ("Go deeper" collapsible for advanced
material: `<details class="deep"><summary>Title</summary><div>…</div></details>`), `.deeper`
(pill links; add class `video` for a video link), `.recap` (end-of-chapter summary, always
include one), `.reveal` (fade-in on scroll), `.photo`.

Colour conventions in visuals: detection green `#a3e635`, corner red `#f43f5e`, pose axes x red
`#ef4444`, y green `#22c55e`, z blue `#3b82f6`, warnings amber `#f59e0b`, lab backgrounds
`#0e0518` / `#1a0a2b`, lab text `#f4efff` / `#b8a9d4`. Draw with canvas 2D or inline SVG
(or three.js for 3D). No other libraries; no build step.

## Content rules

- **Accuracy first.** Facts about *our* system come from the repo:
  `C:\GitHub\SpectrumJetson\README.md` (start here), `docs/TECHNICAL.md`,
  `docs/VISION-RESEARCH.md`, `docs/LIMELIGHT-COMPARISON.md`, `docs/REWIND.md`,
  `docs/UPSTREAM-PORT.md`, `patches/*.patch`, `kernel/`, `detector/`, `scripts/`, `tests/`.
  Use our real measured numbers (e.g. 33 → 122 fps; 8.9 ms → 2.6 ms decode; ~6700 bytes per
  microframe USB budget; 62 s → 8 s restart). General facts (how a CMOS sensor works, CUDA,
  Linux, PnP) must be correct; verify anything you're unsure of on the web (WebSearch/WebFetch).
  Never invent a measurement. If a visual is a simplified illustration, say so in its caption.
- **Teach from zero, then go deep.** Start each topic with a plain-language explanation and an
  analogy or picture, then build up. Put the advanced/technical detail (exact APIs, formulas,
  patch names) in `details.deep` blocks or later sections so beginners aren't lost and advanced
  students still get the real thing. Define jargon with `.term` on first use.
- **Visual first.** Every chapter needs several real visuals, and at least one or two genuinely
  interactive labs where students change something and see the result. Prefer showing a
  mechanism over describing it. Animated diagrams beat static ones. Scroll-driven
  (`.scrolly`) sequences are great for step-by-step processes.
- **Tie it to us.** Use `.callout.spectrum` to show what our team found/fixed/measured, with the
  real numbers. Students should see real engineering: problems, measurement, fixes, lessons.
- Voice: friendly, direct, short sentences, concrete. Talk to the student ("you"). No hype words.
  American spelling in prose. Sentence-case headings.
- Photos you can use (in `assets/photos/`): `bench-setup.jpg` (Jetson + Thriftiest Cam + laptop on
  a desk), `before-99fps.jpg` (PhotonVision stream, tag 3 detected, "99 FPS – 19 ms latency",
  Sept 23), `after-123fps.jpg` (same after our fixes, "123 FPS – 14 ms latency", with 3D pose
  axes, Sept 24), `device-metrics.jpg` (PhotonVision Device Metrics: CPU 50%, temp 41 °C),
  `device-metrics-2cam.jpg` (CPU 23%, 41 °C), `camera-matching.jpg` (Camera Matching page with 5
  cameras streaming: 2 Thrifty, 2 Global Shutter, 1 USB colour camera, ~125 fps on the Thrifties),
  `pv-settings.jpg` (PhotonVision Settings page: Device Control, Device Metrics with GPU usage,
  static IP 10.85.15.15, team 8515), `field-3d.jpg` (the 3D field view on our Field Calibration
  page), `live-tracking-123fps.mp4` (9 s video: tag 3 tracked with pose axes at 121–123 FPS,
  13–18 ms latency). 3D models in `assets/models/`: `jetson-devkit.glb` (NVIDIA's devkit CAD,
  one named node per part group) and `thriftiest-cam.glb` (nodes `back`, `front`, `lens_mount`,
  `screws`), in metres, Z up.
- External links/videos: only link things you've verified exist (fetch the URL). YouTube embeds
  are OK if verified (`<iframe class="video-embed" src="https://www.youtube-nocookie.com/embed/ID" loading="lazy" allowfullscreen></iframe>`), but prefer our own visuals.
- Mobile: must work at 375 px wide (canvases scale via `Site.canvas`; no horizontal scroll).
  Respect `Site.reduced` (reduced motion) for big continuous motion where easy.
- Performance: use `Site.loop` so animations pause off-screen; keep canvas work light.

## Checking your work (required)

A screenshot script is ready:
`node "C:\Users\Allen\AppData\Local\Temp\claude\C--GitHub-SpectrumJetson\b8d8c618-58e8-4d87-b269-3755d3dd78d1\scratchpad\shot\shot.js" "#ID" 1280 C:\path\out.png 1500`
It loads the page in headless Chrome, scrolls through your chapter, screenshots the whole section,
and prints console errors (404s for other chapters' missing scripts are expected; errors from
yours are not). Use width 390 for a mobile check. Look at the screenshots (Read the PNG) and fix
what looks wrong: overlapping text, cramped labels, empty canvases, broken layout. For
interactive labs, you can also write a small variant of the script that clicks/drags and
screenshots. Iterate until it looks polished. `node --check` your JS.

## Final report

Reply with: what each chapter covers and its visuals/labs (2–4 lines each), any facts you weren't
sure of, any shared-file change you need, and the screenshot paths of your final versions.
