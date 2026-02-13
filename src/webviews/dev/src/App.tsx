import { useEffect, useMemo, useState } from 'react';

import { applyDevTheme, DEV_THEMES, isDevThemeId, type DevThemeId } from './devTheme';
import { DEV_WEBVIEWS, isDevWebviewId, type DevWebviewId } from './webviewCatalog';
import './styles.css';

const WEBVIEW_PARAM = 'webview';
const THEME_PARAM = 'theme';

function getInitialWebviewId(): DevWebviewId {
  const params = new URLSearchParams(window.location.search);
  const value = params.get(WEBVIEW_PARAM);

  if (value && isDevWebviewId(value)) {
    return value;
  }

  return DEV_WEBVIEWS[0].id;
}

function getInitialThemeId(): DevThemeId {
  const params = new URLSearchParams(window.location.search);
  const value = params.get(THEME_PARAM);

  if (value && isDevThemeId(value)) {
    return value;
  }

  return 'vscode-dark';
}

function buildPreviewUrl(webviewId: DevWebviewId, themeId: DevThemeId): string {
  const params = new URLSearchParams({
    [WEBVIEW_PARAM]: webviewId,
    [THEME_PARAM]: themeId
  });

  return `preview.html?${params.toString()}`;
}

export default function App() {
  const [webviewId, setWebviewId] = useState<DevWebviewId>(getInitialWebviewId);
  const [themeId, setThemeId] = useState<DevThemeId>(getInitialThemeId);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    applyDevTheme(themeId);
  }, [themeId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set(WEBVIEW_PARAM, webviewId);
    params.set(THEME_PARAM, themeId);

    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}?${nextQuery}`;
    window.history.replaceState(null, '', nextUrl);
  }, [webviewId, themeId]);

  const previewUrl = useMemo(() => buildPreviewUrl(webviewId, themeId), [webviewId, themeId]);

  return (
    <div className="dev-shell">
      <header className="dev-shell__toolbar">
        <h1 className="dev-shell__title">EDA Webview Style Lab</h1>

        <label className="dev-shell__field" htmlFor="webview-select">
          Webview
          <select
            id="webview-select"
            value={webviewId}
            onChange={(event) => setWebviewId(event.target.value as DevWebviewId)}
          >
            {DEV_WEBVIEWS.map(option => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="dev-shell__field" htmlFor="theme-select">
          Theme
          <select
            id="theme-select"
            value={themeId}
            onChange={(event) => setThemeId(event.target.value as DevThemeId)}
          >
            {DEV_THEMES.map(option => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="dev-shell__reload"
          onClick={() => setReloadVersion(previous => previous + 1)}
        >
          Reload Preview
        </button>
      </header>

      <main className="dev-shell__content">
        <iframe
          key={`${webviewId}-${themeId}-${reloadVersion}`}
          src={previewUrl}
          title="EDA Webview Preview"
          className="dev-shell__iframe"
        />
      </main>
    </div>
  );
}
