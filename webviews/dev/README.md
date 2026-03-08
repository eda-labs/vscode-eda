# Webview Style Lab (Vite)

This folder contains a Vite-powered dev shell for styling all React webviews without launching the full extension runtime.

## Run

```bash
npm run webviews:dev
```

If Vite is not installed yet in your environment, add it once:

```bash
npm install -D vite @vitejs/plugin-react
```

Then open the printed local URL (default `http://localhost:5173`).

## Features

- EDA Explorer is always rendered in a resizable left pane.
- Select any other webview entrypoint for the right-side preview pane.
- Switch between `VS Code Dark` and `VS Code Light` dev themes.
- Mocked extension `postMessage` bridge with fixture data for each webview.

## Playwright (Real EDA)

Install Playwright Chromium once:

```bash
npm run test:webviews:playwright:install
```

Run the real-EDA explorer performance check:

```bash
npm run test:webviews:playwright
```

Optional environment variables:

- `EDA_PLAYWRIGHT_TARGET`: explicit target URL from `~/.eda-tui/targets.json`
- `EDA_PLAYWRIGHT_READY_TARGET_MS`: SLA threshold in ms (default `2200`)
- `EDA_PLAYWRIGHT_BOOTSTRAP_MIN_RESOURCES`: real-loader target resource count (default `1000`)
- `EDA_PLAYWRIGHT_MIN_RESOURCE_COUNT`: assertion floor for rendered count (default `1`; set `1000` for large fabrics)
- `EDA_PLAYWRIGHT_API_PREFIX`: override API prefix probing
- `EDA_PLAYWRIGHT_STREAM_LIMIT`: cap streams for debugging
- `EDA_PLAYWRIGHT_BATCH_SIZE`: fast-bootstrap batch size (default `6`)

The test opens:

`preview.html?webview=edaExplorer&explorerDataSource=real`

## Notes

- Most previews run with mocked data.
- Explorer supports live data mode via `explorerDataSource=real` and reads credentials from `~/.eda-tui/targets.json` through a Vite dev middleware endpoint.
- Extension side effects (opening editors, SSH, clipboard API, etc.) are intentionally no-op in this lab.
