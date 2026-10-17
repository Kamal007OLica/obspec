# Figma Community listing — Obspec

Copy-paste source for the "Publish plugin" dialog. Keep in sync with the README.

## 1 · Describe your resource

**Name**
Obspec

**Tagline** (≤100 chars)
Search your Obsidian vault inside Figma. Drop notes as specs. Two-way sync, fully local.

**Description**
Obspec puts your Obsidian vault one search away from the canvas, and keeps notes and designs in sync — without any of it leaving your computer.

What you can do
• Search every note by title, path, tag or body, with filters like tag:, path:, "exact phrase" and -exclude. Results come back in milliseconds, with thumbnails of embedded images.
• Drag a result onto the canvas, or press Insert, and the note becomes a spec card: a real Figma frame with the note's headings, lists, code, quotes and images. Drop it inside a frame or section and it lands right there.
• Link any layer to a note. A status chip on the card shows In sync, Note changed or Design changed.
• Edit the note in Obsidian and Figma notices while the file is still open. Pull brings the change in.
• Change the design and Send it back: size, fill, label, component props and a deep link travel into the note's Design section.
• Save any note as a Spec-ready Markdown file and drop it on the canvas to make a native Figma Spec.
• Three result layouts (cards, list, compact), light and dark themes, resizable window.

How it works
Obspec reads your notes through a tiny helper that runs on your own computer, the Obspec Bridge. The first-run screen walks you through it: start the bridge with one command (or double-click the launcher), then pick a vault from the ones Obsidian already knows about. Nothing is uploaded, there is no account, and there are no analytics in the plugin.

Requirements
• Obsidian vault (any folder of Markdown files works)
• Node.js 18 or newer on your computer for the bridge
• Figma desktop or web

Open source, MIT. Not affiliated with Figma or Obsidian.
Website: https://kamal007olica.github.io/obspec/
Source and issues: https://github.com/Kamal007OLica/obspec

**Category**
Productivity (alternatives if asked for more: Files & organization, Development)

**Tags / keywords**
obsidian, markdown, notes, specs, documentation, sync, knowledge base, pkm, local-first, handoff

## 2 · Choose some images

- Icon (128 × 128): `publishing/icon.png`  (also `icon@2x.png` at 256 × 256)
- Cover (1920 × 960): `publishing/cover.png`
- Optional carousel: screenshots in `preview/shots/` — 01 (search + insert), 03 (drag to canvas), 05 (edit in Obsidian → pull), 07c (cards view), 09 (dark theme)

## 3 · Data security

**Network access** (shown from the manifest)
http://localhost:27123 — "Obspec talks only to the Obspec Bridge running on your own machine (localhost:27123), which indexes your Obsidian vault. No data leaves your computer."

**Does the plugin collect, store or transmit user data?**
No. Obspec reads notes from a folder on the user's own computer through a local helper (the Obspec Bridge) over localhost. Nothing is sent to any server, there is no account or sign-in, and the plugin contains no analytics or trackers. Settings (bridge address, chosen vault, window size, theme) are stored in Figma's clientStorage on the device.

**Does the plugin write to the user's files?**
Only when the user clicks "Send to Obsidian", and only inside the "Figma" folder of the vault they chose (configurable in Settings). Searching, previewing, inserting and linking are read-only.

**Third-party services / AI**
None.

**Privacy policy (optional)**
https://github.com/Kamal007OLica/obspec#notes--limits

## 4 · Add the final details

- Support contact: kr07.work@gmail.com
- Website: https://kamal007olica.github.io/obspec/
- Source code: https://github.com/Kamal007OLica/obspec
- Comments: enabled
- Version notes (v1.1.0): First public release. Vault search with thumbnails and three layouts, spec cards with images and live status, drag-and-drop from results to canvas, link / pull / send sync, Spec-ready Markdown export, first-run onboarding with vault picker, light and dark themes, resizable window.
