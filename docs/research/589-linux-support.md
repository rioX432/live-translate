# Linux Support Feasibility Evaluation

**Issue:** #589
**Date:** 2026-04-09
**Status:** Research complete — Linux support is feasible but overlay transparency on Wayland requires significant workarounds; X11 path is more straightforward

---

## Summary

Linux support for live-translate is technically feasible, with native addons (whisper-node-addon, node-llama-cpp) providing pre-built Linux binaries. The main challenge is the subtitle overlay window: the current implementation uses `transparent: true, frame: false, alwaysOnTop: true` which works well on macOS but has known issues on both X11 and Wayland on Linux. Audio capture via PipeWire/PulseAudio is a non-issue with the existing `getUserMedia` approach.

---

## Platform Compatibility Matrix

| Component | X11 | Wayland (wlroots/Hyprland) | Wayland (GNOME) | Notes |
|-----------|-----|---------------------------|-----------------|-------|
| Electron app shell | Works | Works (Electron 38.2+) | Works | Native Wayland default in Electron 38.2+ |
| Transparent overlay window | Partial — requires `--enable-transparent-visuals --disable-gpu` | Partial — CSD support added in Electron 41 | Partial — flickering known | Black background on many setups without flags |
| `alwaysOnTop` | Works | Limited — apps cannot set global z-order unilaterally | Broken for non-GNOME-native apps | Core Wayland design restriction |
| `setIgnoreMouseEvents` | Works | Works | Works | No known issues |
| `win.setPosition(x, y)` | Works | **Broken** — Wayland forbids global screen coordinates | **Broken** | Affects subtitle window repositioning |
| `globalShortcut` | Works | Restricted — compositor dependent | Restricted | May not register across all apps |
| `getUserMedia` audio | Works (PulseAudio/PipeWire) | Works | Works | Standard Web API, no issues |
| whisper-node-addon | Pre-built x64/arm64 | Pre-built x64/arm64 | Pre-built x64/arm64 | CUDA not yet available |
| node-llama-cpp | Pre-built + CUDA/Vulkan | Pre-built + CUDA/Vulkan | Pre-built + CUDA/Vulkan | Auto-detects GPU backend |

---

## Detailed Findings

### 1. Electron Transparent Overlay on X11

**Known issues:**
- Transparency requires `--enable-transparent-visuals` and `--disable-gpu` launch flags on X11; without them, the window background renders black or gray.
- The `--disable-gpu` flag disables hardware acceleration, which degrades rendering performance.
- `setIgnoreMouseEvents` works on X11, but window manager behavior varies (some WMs re-decorate even frameless windows).
- Compositor configuration (compton/picom) may be needed for compositing effects; bare X11 without a compositor will not render transparency.

**Workaround:** Launch with `--enable-transparent-visuals --disable-gpu` in the Electron app args for Linux. This is a well-documented workaround but is not ideal (CPU rendering).

**References:**
- [electron/electron #15947](https://github.com/electron/electron/issues/15947)
- [electron/electron #25153](https://github.com/electron/electron/issues/25153)
- [electron/electron #40515](https://github.com/electron/electron/issues/40515)

---

### 2. Electron on Wayland

**Current status (as of Electron 41):**
- Electron 38.2+ defaults to native Wayland when `WAYLAND_DISPLAY` is set. Users can force XWayland via `--ozone-platform=x11`.
- Electron 41 added full client-side decoration (CSD) support for frameless windows on Wayland.
- Transparent windows: The Electron team notes that "colors, transparency, and hardware-accelerated rendering actually work better on Wayland than X11" with native Wayland.

**Critical limitations for live-translate:**
- `win.setPosition(x, y)` is **unsupported on Wayland** — Wayland deliberately forbids apps from accessing or setting global screen coordinates. This directly breaks the subtitle window's position-saving feature (`subtitlePositions` in store).
- `screen.getCursorScreenPoint()` is unavailable.
- `globalShortcut` is more restricted — compositors differ in how they expose global shortcuts.
- Window focusing and ordering: apps cannot unilaterally move, resize, or bring windows to front without user interaction.
- Multi-monitor handling: `screen.getAllDisplays()` works but window placement across displays requires workarounds.

**References:**
- [Electron Tech Talk: Wayland](https://www.electronjs.org/blog/tech-talk-wayland)
- [electron/electron #44607 — Native Wayland completely broken](https://github.com/electron/electron/issues/44607)
- [electron/electron #46843 — Multi-monitor ozone hints needed](https://github.com/electron/electron/issues/46843)

---

### 3. wlr-layer-shell for Overlay on Sway/Hyprland

`wlr-layer-shell` is a Wayland extension protocol implemented by wlroots-based compositors (Sway, Hyprland, Wayfire) and KDE Plasma, but **not GNOME Mutter**. It allows a surface to be assigned to a compositor layer (background, bottom, top, overlay) with defined z-depth relative to normal windows — exactly what a subtitle overlay needs.

**Key capabilities:**
- Anchor to screen edges (useful for subtitle positioning at bottom of display).
- Always-on-top rendering independent of window management stack.
- Click-through passthrough (input region can be set to zero).

**Electron cannot use wlr-layer-shell natively.** Electron uses standard `xdg_shell` surfaces. To use layer-shell, options are:
1. **Native module** (e.g., a custom C++ Node addon using `libwayland-client` + `wlr-layer-shell-unstable-v1` protocol) to create a separate layer surface and communicate rendering via shared memory/socket. High complexity.
2. **External overlay process**: Launch a separate Wayland layer-shell process (written in Rust/C using GTK4 + `gtk-layer-shell` or raw `libwayland`) and communicate via IPC. This is the approach taken by `whisper-overlay` (Rust).

**whisper-overlay approach (reference):**
- Uses `layer-shell` protocol + `virtual-keyboard-v1` for a fully Wayland-native overlay.
- Implements global hotkey detection via **evdev directly** (bypasses GlobalShortcuts portal which does not work with layer-shell windows).
- Works on Sway, Hyprland, and any wlroots compositor.
- **GNOME is not supported** — layer-shell requires wlroots or KDE.
- X11 support was attempted but proved impractical (GTK4 overlay + virtual input issues).

**References:**
- [wlr-layer-shell protocol spec](https://wayland.app/protocols/wlr-layer-shell-unstable-v1)
- [oddlama/whisper-overlay](https://github.com/oddlama/whisper-overlay)
- [wmww/gtk-layer-shell](https://github.com/wmww/gtk-layer-shell)

---

### 4. GNOME Mutter Limitations

GNOME Mutter does **not implement wlr-layer-shell**. This is a deliberate design decision — GNOME uses its own proprietary protocols for desktop shell components.

**Implications:**
- Applications that rely on wlr-layer-shell for always-on-top overlays do not work on GNOME Wayland.
- `alwaysOnTop` for standard xdg-shell windows works through Mutter's own window stacking, but is unreliable for overlay use cases (can be overridden by other windows).
- No standard Wayland API for programmatic always-on-top exists; the Wayland design explicitly leaves z-order to the compositor.
- Transparent window flickering is a known issue on Mutter (NW.js reports alternating ghost images when moving transparent windows, March 2025).

**GNOME is the most constrained compositor for overlay apps.** Ubuntu (GNOME default), Fedora GNOME, and Pop!_OS all use Mutter.

**References:**
- [GNOME Discourse: any way to set window always on top programmatically?](https://discourse.gnome.org/t/any-way-to-set-window-always-on-top-programmatically/31579)
- [Tauri #3117 — always on top not working on Wayland](https://github.com/tauri-apps/tauri/issues/3117)
- [nwjs #8257 — transparent window flickering on Wayland](https://github.com/nwjs/nw.js/issues/8257)

---

### 5. Audio Capture: PulseAudio vs PipeWire

**Meeting audio capture requirement:** live-translate needs to capture both microphone input and system audio (speaker loopback for meeting translation).

**PipeWire (modern standard):**
- Default on Fedora (since F34), Ubuntu 22.10+, Arch, Manjaro, and most current distros.
- Provides PulseAudio compatibility layer (`pipewire-pulse`) — existing `getUserMedia` mic capture works without changes.
- **Loopback/monitor capture:** PipeWire supports capturing monitor sources (system output) natively via `pw-loopback` or by selecting the monitor source in `getUserMedia` constraints.
- `module-loopback` passes output of a capture stream to a playback stream, enabling virtual sink creation for meeting audio capture.
- OBS uses PipeWire audio capture on Linux without issues.

**PulseAudio (legacy):**
- Still present on older Ubuntu LTS (20.04), Debian stable.
- Loopback via `pactl load-module module-loopback`.
- `getUserMedia` with `{ audio: { deviceId: 'monitor' } }` works on PulseAudio with the monitor source.

**Assessment:** Audio capture itself is not a blocker. Both PulseAudio and PipeWire expose monitor sources that `getUserMedia` can capture. The user needs to select the correct audio device (monitor/loopback) in settings — same UX as macOS's BlackHole/Soundflower requirement.

**Snap confinement caveat:** Snap packages have strict audio device access restrictions. AppImage or .deb are recommended over Snap for audio-dependent apps.

**References:**
- [PipeWire docs: module-loopback](https://docs.pipewire.org/page_module_loopback.html)
- [PipeWire ArchWiki](https://wiki.archlinux.org/title/PipeWire)

---

### 6. whisper-node-addon Linux Builds

**Status (v1.1.0, July 2025):**
- Pre-built `.node` binaries available for: Linux x64, Linux arm64, Windows x64, macOS x64/arm64.
- Automatic runtime detection — correct binary loads based on OS/arch.
- **CUDA: Not yet available.** The roadmap lists "Add CUDA backend binaries and installation scripts" as an incomplete TODO. The maintainer lacks an NVIDIA GPU for testing.
- Vulkan and OpenBLAS acceleration are available as alternatives.
- On Linux without CUDA, inference runs on CPU via OpenBLAS (acceptable for Whisper small/base models, ~300-700ms per segment).

**References:**
- [Kutalia/whisper-node-addon](https://github.com/Kutalia/whisper-node-addon)
- [@kutalia/whisper-node-addon on npm](https://www.npmjs.com/package/@kutalia/whisper-node-addon)

---

### 7. node-llama-cpp Linux Builds

**Status:**
- Pre-built binaries for Linux with **CUDA support** — automatically used when CUDA Toolkit is detected. Requires CUDA Toolkit 13.1+.
- **Vulkan support** available for AMD/Intel GPUs and NVIDIA without CUDA toolkit.
- **ROCm:** ROCm support was requested (issue #84) and merged. The underlying llama.cpp supports HIP/ROCm; node-llama-cpp inherits this. Requires ROCm to be installed from distro package manager.
- Falls back to source build with cmake if no pre-built binary matches.
- The shared `UtilityProcess` worker-pool pattern used in live-translate (`worker-pool.ts` → `slm-worker.ts`) is platform-agnostic and will work on Linux.

**References:**
- [node-llama-cpp CUDA guide](https://node-llama-cpp.withcat.ai/guide/CUDA)
- [withcatai/node-llama-cpp](https://github.com/withcatai/node-llama-cpp)
- [node-llama-cpp #84 — ROCm support](https://github.com/withcatai/node-llama-cpp/issues/84)

---

### 8. whisper-overlay (Rust) — Reference Implementation

**How it handles Wayland overlay:**
- Written in Rust, uses `layer-shell` and `virtual-keyboard-v1` Wayland protocols directly.
- Creates a layer surface (not a standard xdg_shell window) assigned to the compositor's overlay layer — always on top by protocol design.
- Global hotkey detection bypasses the GlobalShortcuts portal entirely, using **evdev directly** to monitor raw keyboard input. This avoids the portal's incompatibility with layer-shell windows.
- Audio capture via PipeWire/PulseAudio.
- Uses RealtimeSTT Python library + faster-whisper for transcription.

**Key insight for live-translate:** whisper-overlay solves the always-on-top problem on Wayland by using layer-shell (not `alwaysOnTop` on a regular window). For Electron-based live-translate to achieve equivalent behavior on Wayland (wlroots), a separate layer-shell helper process would be needed. This is complex but achievable.

**GNOME limitation acknowledged by whisper-overlay:** The GlobalShortcuts portal issue with layer-shell windows remains unresolved upstream. GNOME is not supported.

**References:**
- [oddlama/whisper-overlay](https://github.com/oddlama/whisper-overlay)
- [whisper-overlay on crates.io](https://crates.io/crates/whisper-overlay)

---

### 9. Competitor Linux Support

| Competitor | Linux Support | Overlay Approach | Notes |
|-----------|---------------|-----------------|-------|
| **whisper-overlay** | Yes (Wayland only, wlroots) | wlr-layer-shell (Rust) | STT only, no translation |
| **Speech-Translate** | Yes (install from pip/git) | Tkinter window (no true overlay) | No prebuilt Linux binary; speaker input needs loopback workaround |
| **Synthalingua** | Yes (Python, cross-platform) | CLI/web-based (no overlay) | No native overlay; outputs to web UI or stream captions |
| **waystt** | Yes (Wayland) | Minimal PipeWire + STT daemon | No overlay; types text into focused window |

**Observation:** No Linux competitor provides a live-translate style transparent overlay with translation on GNOME. whisper-overlay comes closest but is Wayland/wlroots-only and STT-only. This represents a genuine gap.

**References:**
- [Dadangdut33/Speech-Translate](https://github.com/Dadangdut33/Speech-Translate)
- [cyberofficial/Synthalingua](https://github.com/cyberofficial/Synthalingua)
- [sevos/waystt](https://github.com/sevos/waystt)

---

## Blockers

### Hard blockers

| Blocker | Scope | Mitigation |
|---------|-------|-----------|
| `win.setPosition()` broken on Wayland | Subtitle window positioning | Fall back to XWayland mode (`--ozone-platform=x11`) or use relative positioning relative to display bounds without absolute coordinates |
| `alwaysOnTop` unreliable on GNOME Wayland | Subtitle overlay | No reliable fix without wlr-layer-shell or proprietary GNOME protocol; XWayland is the practical workaround |
| Transparent window requires `--disable-gpu` on X11 | Subtitle overlay visual quality | Acceptable trade-off for Linux; GPU rendering not strictly required |

### Soft blockers (workarounds exist)

| Issue | Mitigation |
|-------|-----------|
| whisper-node-addon: no CUDA on Linux | Use Vulkan or CPU+OpenBLAS; CUDA is a TODO upstream |
| `globalShortcut` restricted on Wayland | Document limitation; expose keyboard shortcut config for users to set compositor-level shortcuts |
| Snap audio confinement | Use AppImage or .deb as primary packaging format |
| GNOME Mutter layer-shell missing | Document GNOME as "limited support"; recommend wlroots compositors for full overlay functionality |

---

## Recommendation

**Linux support is feasible with the following strategy:**

### Phase 1: X11 + XWayland baseline (3-4 days effort)

Force XWayland mode by default on Linux (`--ozone-platform=x11` + `--enable-transparent-visuals`). This gives a functional overlay on all Linux desktop environments (X11, GNOME Wayland via XWayland, KDE Wayland via XWayland, wlroots via XWayland). Subtitle window transparency and `alwaysOnTop` work reliably under XWayland.

Tasks:
- Add `--enable-transparent-visuals` + `--ozone-platform=x11` to Linux launch args in `package.json` / Electron entrypoint
- Add AppImage packaging via electron-builder
- Add `.deb` packaging as secondary
- Linux CI pipeline (GitHub Actions `ubuntu-latest`)
- Test whisper-node-addon and node-llama-cpp on Ubuntu x64

### Phase 2: Native Wayland (wlroots) — optional, high effort (5-7 days)

For users on Sway/Hyprland who want native Wayland (no XWayland), implement a companion `layer-shell` helper process (Rust or C with `gtk4-layer-shell`) that renders the subtitle overlay as a layer surface. Communicate with Electron main via Unix socket or stdin/stdout IPC.

This requires a separate binary and is optional. whisper-overlay's open-source Rust implementation can serve as a reference.

### Phase 3: GNOME native Wayland — not recommended

No reliable solution exists for always-on-top transparent overlays on GNOME Wayland without GNOME-specific protocols. The XWayland fallback (Phase 1) covers GNOME users adequately.

### STT Engine on Linux

| Engine | Linux Status |
|--------|-------------|
| Whisper Local (whisper-node-addon) | Pre-built x64/arm64, CPU+Vulkan+OpenBLAS, no CUDA yet |
| MLX Whisper | macOS-only (Apple Silicon) — not available |
| Apple SpeechTranscriber | macOS 26+ only — not available |
| SenseVoice (sherpa-onnx) | Works on Linux (ONNX Runtime is cross-platform) |
| Moonshine Tiny JA | Requires evaluation for Linux build |

SenseVoice via sherpa-onnx is the recommended STT fallback for Linux users until whisper-node-addon gains CUDA support.

### Translation Engine on Linux

All translation engines work on Linux:
- HY-MT1.5-1.8B, LFM2, PLaMo-2, Hunyuan-MT: node-llama-cpp pre-built Linux binaries with CUDA/Vulkan/ROCm
- Google Translate, DeepL, Gemini: cloud-based, platform-agnostic

---

## Effort Estimate

| Phase | Effort | Value |
|-------|--------|-------|
| Phase 1: X11/XWayland baseline | 3-4 days | High — covers all Linux DE |
| Phase 2: Wayland-native (wlroots) | 5-7 days | Medium — covers Sway/Hyprland power users |
| Phase 3: GNOME native Wayland | Not feasible | — |

**Total recommended:** Phase 1 only for initial Linux release. Phase 2 as a follow-up based on user demand.

---

## References

- [Kutalia/whisper-node-addon](https://github.com/Kutalia/whisper-node-addon)
- [withcatai/node-llama-cpp](https://github.com/withcatai/node-llama-cpp)
- [node-llama-cpp CUDA guide](https://node-llama-cpp.withcat.ai/guide/CUDA)
- [Electron Tech Talk: Wayland](https://www.electronjs.org/blog/tech-talk-wayland)
- [electron/electron #15947 — Transparency on Linux](https://github.com/electron/electron/issues/15947)
- [electron/electron #44607 — Native Wayland broken](https://github.com/electron/electron/issues/44607)
- [oddlama/whisper-overlay — Wayland overlay reference](https://github.com/oddlama/whisper-overlay)
- [wlr-layer-shell protocol](https://wayland.app/protocols/wlr-layer-shell-unstable-v1)
- [wmww/gtk-layer-shell](https://github.com/wmww/gtk-layer-shell)
- [GNOME Discourse: always-on-top programmatically](https://discourse.gnome.org/t/any-way-to-set-window-always-on-top-programmatically/31579)
- [PipeWire module-loopback](https://docs.pipewire.org/page_module_loopback.html)
- [Dadangdut33/Speech-Translate](https://github.com/Dadangdut33/Speech-Translate)
- [cyberofficial/Synthalingua](https://github.com/cyberofficial/Synthalingua)
- [Tauri #3117 — always-on-top broken on Wayland](https://github.com/tauri-apps/tauri/issues/3117)
