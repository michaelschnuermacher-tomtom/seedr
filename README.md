# Seedr

Draws balanced, rotating 2-vs-2 teams for a fixed number of rounds on a limited number of
courts, records wins and ranks players. Runs completely in the browser and works offline.

## Use on a laptop

```bash
npm run build
```

Open `dist/index.html` in a browser (double-click works). Data is saved in that browser.

## Use on an iPad

1. Run `npm run build`, then upload the whole `dist/` folder to a static host, e.g. drag the `dist` folder onto
   https://app.netlify.com/drop or push it to GitHub Pages.
2. Open the URL in Safari, tap **Share → Add to Home Screen**.
3. Start Seedr from the home screen. After the first start it also works offline.

Tournament data stays on the device. The host only serves the empty app.

## Players file

On the setup screen, **Load players file** reads a plain text file (e.g. from Dropbox or
iCloud Drive) with one player per line, name and skill (1 = best, 10 = weakest)
separated by a colon:

```
Anna: 3
Ben Miller: 7
Müller, Jörg: 1
```

The players appear in the text box, where they can still be edited. You can also type
or paste players in the same format.

## Keeping data safe

Browser storage can be lost (clearing Safari data, a new device). Use **Manage → Export**
to save a `.seedr.json` file (e.g. to Dropbox or iCloud Drive) and **Import** to load it
on any device.

## Photos and logo

The tournament screen shows a rotating photo banner. The originals live in `img/`
(not committed); after adding or changing photos run

```bash
python3 tools/optimize-photos.py   # needs Pillow; writes src/ui/photos and the photo list
```

It shrinks them to 1200 px and removes all metadata, including GPS locations. Photo 13 is
the first banner image. The logo lives in `src/ui/logo.js`; after changing it run
`node tools/make-icons.mjs` (needs Google Chrome) to render the app icons.

The build writes `dist/index.html`, `sw.js`, `manifest.webmanifest`, `photos/` and `icons/`.
Keep the `dist` folder together, and upload all of it when hosting.

## Development

```bash
npm test        # engine and build tests (node --test)
npm run build   # writes dist/
```

Source: `src/engine` (pure logic, tested), `src/ui` (screens). Design:
`docs/superpowers/specs/2026-10-14-seedr-free-rounds-design.md`.
