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

- EDA Explorer is always rendered in a fixed left pane.
- Select any other webview entrypoint for the right-side preview pane.
- Switch between `VS Code Dark` and `VS Code Light` dev themes.
- Mocked extension `postMessage` bridge with fixture data for each webview.

## Notes

- The preview runs with mocked data only.
- Extension side effects (opening editors, SSH, clipboard API, etc.) are intentionally no-op in this lab.
