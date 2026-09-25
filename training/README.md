# Vision training site

A scrollable, visual course that teaches students how this Jetson vision system works: the
camera, AprilTags, the Jetson hardware, Linux, CUDA, PhotonVision and our patches, calibration,
pose, latency and the match-day failsafes.

Plain HTML, CSS and JavaScript with no build step. three.js is vendored in `vendor/`, so the site
works offline except for the Google Fonts (it falls back to system fonts).

## View it locally

Chapters load with `fetch()` and the 3D views are ES modules, so open it through a web server,
not by double-clicking `index.html`:

```bash
python -m http.server 8347 --directory training
```

Then open http://localhost:8347/.

## Layout

| Path | What |
| --- | --- |
| `index.html` | The page shell: hero, course map, part dividers, one `<section>` per chapter |
| `chapters/NN-id.html` | Each chapter's content (and its own `<style>`) |
| `js/ch/NN-id.js` | Each chapter's labs and animations, registered with `Site.chapter('id', ...)` |
| `js/site.js` | Loader, navigation, and shared helpers (canvas, animation loops, AprilTag drawing) |
| `js/glossary.js` | Definitions for the hover-to-define words |
| `css/site.css` | Design system, using spectrum3847.org's colours and fonts |
| `assets/models/` | 3D models built from NVIDIA's and The Thrifty Bot's STEP files by `tools/build_models.py` |
| `assets/photos/` | Our bench photos and screenshots |

The AprilTags are real tag36h11 codes (from AprilRobotics/apriltag), checked pixel for pixel
against the official tag images, so a phone app or PhotonVision can detect them off the screen.

## Publishing on GitHub Pages (not done yet)

The simplest route: a GitHub Actions workflow that uploads `training/` with
`actions/upload-pages-artifact` and deploys it with `actions/deploy-pages`, with Pages set to
"GitHub Actions" in the repo settings.
