# Shape Maker (Figma plugin)

Generates decorative shapes and stickers as native, editable Figma vectors: 42 types in three groups.

- **Geometric:** scallops, flowers, starbursts, sparkles, wavy bars, squiggles, arches, sunbursts…
- **Freeform:** blobs, puffs, splats, wobbly flowers, worms, curls, hand-drawn stars
- **Stickers:** hearts, speech/cloud bubbles, arrows, leaves, smileys, text badges and sale bursts (with a real, editable text layer)

What it does:

- **Insert** one shape or a sheet of up to 100. Select a frame first to insert into it.
- **Edit later.** Each shape's settings are saved on the layer as plugin data. Select it and open the plugin (or click **Edit shape** in Figma's right panel), and slider and color changes update it in place.
- **Scatter.** Select a frame, set the count, size range, overlap, bleed and random rotation, and fill it with shapes, grouped as "Scattered shapes" and optionally placed behind the content.
- **Document colors.** Switch the color picker from the built-in palette to the file's local paint styles and color variables. Inserted shapes stay linked to them.
- **Shortcuts:** Space shuffle · Enter insert · V new variations · ← → previous / next shape. Works fully offline.

No dependencies; needs only Node (for the build) and the Figma desktop app.

## Develop

```bash
npm run build      # inline the engine into dist/ui.html, copy dist/code.js
npm run watch      # rebuild on every change in src/
npm test           # engine fuzz test (≈7k shapes) + main-thread tests against a mock Figma API
npm run sheet      # contact sheet of all types → test/sheet.html
```

Figma desktop → main menu → **Plugins → Development → Import plugin from manifest…** → `manifest.json`, then run **Plugins → Development → Shape Maker**. Errors show in **Plugins → Development → Show/Hide console**.

## Publish to Figma Community

1. **Run the release build:** `npm run release` (tests + build). Figma uploads the files referenced by `manifest.json` (`dist/code.js`, `dist/ui.html`).
2. **Enable two-factor authentication** on your Figma account (required to publish).
3. **Get a real plugin ID.** The `id` in `manifest.json` is a local placeholder. In Figma desktop: **Plugins → Development → New plugin…** → "Figma design" → any template → save it anywhere. Copy the `"id"` from that generated `manifest.json` into this project's `manifest.json`, then delete the template folder and re-import this manifest.
4. **Smoke-test** the imported plugin once more:
   - insert a shape, a sheet, and a shape into a selected frame, then undo
   - select an inserted shape and open the plugin, and also try the **Edit shape** relaunch button: moving sliders and changing colors should update it in place
   - select a frame and scatter shapes into it (try "behind content" and bleed)
   - in a file with a local paint style and a color variable, pick each from the document colors and check the shape stays linked to it
   - insert a text badge and edit its text in Figma
5. **Publish:** **Plugins → Development → Manage plugins in development** → ⋯ next to Shape Maker → **Publish**. Fill in the fields from [store/LISTING.md](store/LISTING.md) and upload `store/icon.png` and `store/cover.png`.
6. Figma reviews new plugins (typically 5–10 business days). Later updates go through the same **Publish** menu.

## Layout

- `src/engine.js` — shape generators + SVG output (pure JS, no DOM)
- `src/ui.html` + `src/app.js` — plugin UI markup/styles and logic (engine and app are inlined into `dist/ui.html` at build time)
- `test/serve.js` — tiny static server for previewing the UI in a browser
- `src/code.js` — Figma main thread: SVG → vector nodes, outlines strokes, lays out sheets and scatter fills, saves/loads shape settings as plugin data, binds paint styles and variables, one undo step per insert
- `test/fuzz.js` — every type at defaults, slider extremes and random params must yield valid SVG
- `test/code.test.js` — runs `src/code.js` against a mock Figma API (insert, edit, scatter, styles/variables); `npm test` runs both
- `test/sheet.js` — renders a contact sheet of every type
- `store/` — listing copy, icon, cover, and the script that renders them
- `PRIVACY.md` — what the plugin does and doesn't do with data
