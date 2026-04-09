# Demo GIF/Video Creation for README

**Issue:** #586
**Date:** 2026-04-09
**Status:** Research complete — Kap + gifski pipeline recommended

---

## Summary

README demo GIFs are the single highest-impact documentation improvement for GitHub discoverability. Research across popular Electron apps (Buzz, Hyper) and GitHub best-practice guides confirms: a 15–30 second GIF under 5 MB, recorded at 15 fps, hosted via GitHub's CDN (drag-and-drop upload), is the optimal approach. Direct MP4 upload via GitHub's issue/PR drag-and-drop interface is also viable and produces smaller files, but animated GIF remains the gold standard for inline display.

**Recommended approach:** Record with Kap (macOS, free, open-source) → export MP4 → convert to GIF with gifski → upload to GitHub CDN via issue comment drag-and-drop → embed in README.

---

## Research Findings

### 1. GIF Best Practices for GitHub READMEs

| Property | Recommended value | Notes |
|----------|------------------|-------|
| Duration | 15–30 seconds | 20s max; loops cleanly |
| Dimensions | 600×400 – 800×500 px | Crop to app window, not full screen |
| Frame rate | 15 fps | Half of 30fps; minimal quality loss for UI demos |
| File size | Under 5 MB | GitHub CDN limit for drag-and-drop: 10 MB |
| Colors | 256 | Standard GIF limit; gifski handles per-frame palettes |

Cropping to the app window (e.g. 800×600) instead of recording full-screen (1440×900) reduces file size by ~75% before any compression. One focused interaction per GIF is more effective than a full walkthrough.

**Key rule:** Never commit GIFs directly to the repo — use GitHub's CDN (drag-and-drop into an issue or PR comment). GitHub auto-hosts the file and returns a `https://user-images.githubusercontent.com/...` URL.

### 2. Recording Tools

#### Kap (macOS) — Recommended for this project
- Free, open-source: https://getkap.co/
- Exports directly to GIF, MP4, WebM, APNG
- No watermark, minimal UI
- `brew install --cask kap`
- Best for: quick GUI app recordings with direct GIF export

#### OBS Studio — Overkill for README demos
- Full broadcast-level recorder; complex setup
- System audio capture on macOS 13+
- Best for: full-feature video production, not README GIFs

#### vhs (charm.sh) — CLI/terminal demos only
- Declarative `.tape` script → reproducible GIF output
- Requires `ttyd` + `ffmpeg`
- `brew install vhs`
- **Not applicable** for Electron GUI apps; designed for terminal/CLI sessions only

#### asciinema — Terminal recording only
- SVG output via `svg-term-cli`
- Not applicable for GUI Electron apps

#### Screen Studio / Rotato — Paid
- Adds automatic zoom-on-click, cursor effects
- Useful for polished product demos; $80–$99

### 3. GIF Optimization Tools

#### gifski — Highest quality
- Open-source Rust-based encoder: https://github.com/ImageOptim/gifski
- Supports thousands of colors per frame via cross-frame palette optimization
- `brew install gifski`
- Command: `gifski --fps 15 --width 800 -o output.gif input.mp4`
- Produces visually superior GIFs vs standard ffmpeg → gifsicle pipeline

#### gifsicle — Aggressive size reduction
- `brew install gifsicle`
- Post-process gifski output for additional savings:
  ```
  gifsicle -O3 --lossy=80 --colors 256 input.gif -o output.gif
  ```
- `-O3`: most aggressive optimization (stores only changed frame regions)
- `--lossy=80`: up to 20% quality loss; usually imperceptible for UI demos

#### ffmpeg — Video → GIF with palette optimization
- Two-pass approach for quality:
  ```
  ffmpeg -i input.mp4 -vf "fps=15,scale=800:-1:flags=lanczos,palettegen" palette.png
  ffmpeg -i input.mp4 -i palette.png -vf "fps=15,scale=800:-1:flags=lanczos,paletteuse" output.gif
  ```
- Lower quality than gifski but available without additional installs

#### Recommended pipeline: Kap → gifski → gifsicle
```bash
# 1. Record with Kap, export as MP4
# 2. Convert to optimized GIF
gifski --fps 15 --width 800 -o demo-raw.gif recording.mp4

# 3. Further compress (optional, if >5 MB)
gifsicle -O3 --lossy=60 --colors 256 demo-raw.gif -o demo.gif
```

### 4. Video Hosting for GitHub READMEs

#### GitHub CDN (drag-and-drop) — Recommended
- Drag GIF/MP4/MOV into any issue or PR comment editor
- GitHub uploads to `https://user-images.githubusercontent.com/...`
- Returns markdown embed code automatically
- File size limits: 10 MB (GIF), 100 MB (video) on paid plans
- Keeps repo size clean; no binary in git history

#### Direct MP4 upload (GitHub native video)
- GitHub supports MP4/MOV embedding via drag-and-drop since 2021
- Renders as an inline `<video>` player in issues and PRs
- **Not supported in README.md on GitHub.com** — the `<video>` tag is stripped by GitHub's markdown sanitizer
- Workaround: embed a thumbnail image that links to the video

#### External hosting (YouTube, Vimeo)
- YouTube: use `[![thumbnail](img)](https://youtu.be/...)` pattern
- No direct `<video>` or `<iframe>` support in GitHub markdown
- Best for long demos (>60s) or when embedding a tutorial video

#### GitHub Releases — Good secondary option
- Attach MP4 to release assets
- Link from README: `[Watch demo](https://github.com/user/repo/releases/latest)`

### 5. GitHub Video Embed Support (2026 state)

- `<video>` tag: **stripped** by GitHub's markdown sanitizer in READMEs
- `<iframe>`: **stripped**
- Animated GIF: **fully supported** inline via `![](url)` or `<img src="...">`
- MP4 drag-and-drop: works in **issues/PRs only**, not README rendering
- SVG animation: supported inline (must be self-contained CSS, no JS)
- Lottie: **not supported** natively; must be converted to GIF first

### 6. Examples from Popular Electron/Desktop Apps

| Project | Approach | Notes |
|---------|----------|-------|
| Buzz (18.6k stars) | 6 static screenshots in horizontal gallery | No GIF; screenshots of each feature screen |
| Hyper terminal | Single banner GIF + screenshots | Full-width GIF at top, followed by install instructions |
| awesome-readme curated list | Various: GIF, screenshots, video thumbnails | Multi-approach; GIF most common for UI demos |

**Takeaway for live-translate:** Buzz uses static screenshots (no GIF) which is still effective. For a real-time translation app, an animated GIF demonstrating the live overlay is far more compelling than screenshots — the motion is the product.

### 7. SVG Animation / Lottie Alternatives

- **Animated SVG**: works in GitHub READMEs if CSS-only (no JS). Tools: `svg-term-cli` (terminal only), readme-SVG-typing-generator
- **Lottie**: requires JS runtime; GitHub strips it. Must convert to GIF via `tvg-lottie2gif` or similar
- **Verdict**: Not suitable for demonstrating a GUI desktop app. GIF remains the only viable inline animated format for GitHub READMEs

---

## Recommended Approach for live-translate

### What to record (Issue #586 tasks)
1. **Main demo GIF** (15–20s): App launch → click "Start" → speak Japanese → subtitle overlay appears with EN translation
2. **Settings screenshot**: Settings panel showing engine selection (STT + Translator dropdowns)
3. **Overlay screenshot**: Subtitle overlay on top of a browser/meeting window

### Step-by-step recording guide

```bash
# Prerequisites
brew install --cask kap
brew install gifski gifsicle
```

1. Launch live-translate in dev mode or from the built app
2. Open Kap, set capture area to the app window (~800×600 px)
3. Start recording, perform demo flow:
   - Open settings panel (briefly show engine selection)
   - Close settings, show subtitle overlay positioned on screen
   - Speak or play Japanese audio → overlay shows real-time JA→EN translation
4. Stop recording in Kap, export as **MP4** (not GIF directly from Kap)
5. Convert to GIF:
   ```bash
   gifski --fps 15 --width 800 -o demo-raw.gif demo-recording.mp4
   ```
6. Check file size: `du -sh demo-raw.gif`
7. If over 5 MB, compress further:
   ```bash
   gifsicle -O3 --lossy=60 --colors 256 demo-raw.gif -o demo.gif
   ```
8. Upload to GitHub CDN:
   - Create or open any GitHub Issue in this repo
   - Drag `demo.gif` into the comment box
   - Copy the resulting `![demo](https://user-images.githubusercontent.com/...)` URL
9. Add to README.md:
   ```markdown
   ## Demo

   ![live-translate demo](https://user-images.githubusercontent.com/YOUR_URL_HERE)
   ```
   Or with controlled width:
   ```markdown
   <img src="https://user-images.githubusercontent.com/YOUR_URL_HERE" width="800" alt="live-translate demo">
   ```

### Optional: add video to releases
Attach full MP4 to GitHub Releases for users who want higher quality playback.

---

## Tool Summary

| Tool | Purpose | Install | Cost |
|------|---------|---------|------|
| Kap | Screen recording → MP4/GIF | `brew install --cask kap` | Free |
| gifski | High-quality MP4 → GIF | `brew install gifski` | Free |
| gifsicle | GIF size optimization | `brew install gifsicle` | Free |
| ffmpeg | Video processing (alternative) | `brew install ffmpeg` | Free |
| OBS | Full-featured recording (overkill) | `brew install --cask obs` | Free |
| vhs | Terminal CLI demos (not for GUI) | `brew install vhs` | Free |
| Screen Studio | Polished demos with zoom effects | Download | $79+ |
