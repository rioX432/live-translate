# Security Policy

## Supported Versions

This project is pre-1.0. Only the latest commit on `main` receives security updates.

| Version | Supported |
|---------|-----------|
| `main` (latest) | ✅ |
| Tagged releases | ❌ (none yet) |
| Older snapshots | ❌ |

## Reporting a Vulnerability

Please **do not** open a public GitHub Issue for security vulnerabilities. Use GitHub Security Advisories instead.

Report via [GitHub Security Advisories](https://github.com/rioX432/live-translate/security/advisories/new):

1. Open the **Security** tab on the repository → **Advisories** → **Report a vulnerability**.
2. Describe the vulnerability, steps to reproduce, the affected component, and the potential impact.
3. We aim to acknowledge reports within 7 days and produce a fix or mitigation plan within 30 days for confirmed issues.

## Scope

This project bundles or downloads several external runtimes (whisper.cpp, node-llama-cpp, GGUF model files, sherpa-onnx, MLX). Vulnerabilities specific to those upstream projects should also be reported upstream; in this repository, security reports are most useful when they concern:

- Electron main/preload code (`src/main/`, `src/preload/`) — IPC validation, sandbox escapes, file-path traversal, native-addon loading
- Renderer-side handling of untrusted content (transcripts, glossary CSV/JSON, plugin manifests)
- Cloud API key storage and transport (`src/main/store.ts`, `src/engines/translator/`)
- MDM / managed-preferences parsing (`src/main/mdm-config.ts`)
- Auto-update flow (`electron-updater` integration)

## Out of Scope

- DoS via large model downloads or memory-intensive engines — these are expected operational behaviors and gated by the user.
- Issues in upstream dependencies that have a published CVE without a project-specific exploitation path.
- Findings that require physical access to the user's machine.

## Disclosure Timeline

When a report is accepted, we aim to coordinate disclosure:

1. Acknowledgement within 7 days.
2. Fix or workaround within 30 days for confirmed Critical / High issues.
3. Public advisory and patched commit published together; reporter credited unless they request otherwise.
