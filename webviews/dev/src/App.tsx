import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import { applyDevTheme, DEV_THEMES, isDevThemeId, type DevThemeId } from '../../../src/webviews/shared/theme';

import {
  DEV_EXPLORER_WEBVIEW,
  DEV_PREVIEW_WEBVIEWS,
  getDevWebviewLabel,
  isDevPreviewWebviewId,
  type DevPreviewWebviewId,
  type DevWebviewId
} from './webviewCatalog';
import './styles.css';

const WEBVIEW_PARAM = 'webview';
const THEME_PARAM = 'theme';
const OPEN_PREVIEW_EVENT_SOURCE = 'eda-webviews-dev';
const EXPLORER_MIN_WIDTH = 180;
const PREVIEW_MIN_WIDTH = 260;
const EXPLORER_DEFAULT_WIDTH = 380;

interface OpenPreviewMessage {
  source: typeof OPEN_PREVIEW_EVENT_SOURCE;
  command: 'openPreview';
  webview: string;
  params?: Record<string, unknown>;
}

function getInitialWebviewId(): DevPreviewWebviewId {
  const params = new URLSearchParams(window.location.search);
  const value = params.get(WEBVIEW_PARAM);

  if (value && isDevPreviewWebviewId(value)) {
    return value;
  }

  return DEV_PREVIEW_WEBVIEWS[0].id;
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

function sanitizePreviewParams(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      params[key] = value;
    }
  }
  return params;
}

function buildPreviewUrlWithParams(
  webviewId: DevWebviewId,
  themeId: DevThemeId,
  extraParams: Record<string, string>
): string {
  const baseUrl = new URLSearchParams({
    [WEBVIEW_PARAM]: webviewId,
    [THEME_PARAM]: themeId
  });

  for (const [key, value] of Object.entries(extraParams)) {
    baseUrl.set(key, value);
  }

  return `preview.html?${baseUrl.toString()}`;
}

export default function App() {
  const [webviewId, setWebviewId] = useState<DevPreviewWebviewId>(getInitialWebviewId);
  const [themeId, setThemeId] = useState<DevThemeId>(getInitialThemeId);
  const [previewParams, setPreviewParams] = useState<Record<string, string>>({});
  const [reloadVersion, setReloadVersion] = useState(0);
  const [explorerWidth, setExplorerWidth] = useState(EXPLORER_DEFAULT_WIDTH);
  const [isResizingExplorer, setIsResizingExplorer] = useState(false);
  const contentRef = useRef<HTMLElement | null>(null);

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

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as OpenPreviewMessage;
      if (
        !data
        || data.source !== OPEN_PREVIEW_EVENT_SOURCE
        || data.command !== 'openPreview'
        || !isDevPreviewWebviewId(data.webview)
      ) {
        return;
      }

      setWebviewId(data.webview);
      setPreviewParams(sanitizePreviewParams(data.params));
    };

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, []);

  const clampExplorerWidth = useCallback((proposedWidth: number): number => {
    const content = contentRef.current;
    if (!content) {
      return Math.max(EXPLORER_MIN_WIDTH, proposedWidth);
    }

    const maxWidth = Math.max(EXPLORER_MIN_WIDTH, content.clientWidth - PREVIEW_MIN_WIDTH);
    return Math.min(Math.max(proposedWidth, EXPLORER_MIN_WIDTH), maxWidth);
  }, []);

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || window.matchMedia('(max-width: 980px)').matches) {
      return;
    }
    event.preventDefault();

    const content = contentRef.current;
    if (!content) {
      return;
    }
    const { left } = content.getBoundingClientRect();
    setExplorerWidth(clampExplorerWidth(event.clientX - left));
    setIsResizingExplorer(true);
  }, [clampExplorerWidth]);

  useEffect(() => {
    if (!isResizingExplorer) {
      return;
    }

    const updateWidth = (clientX: number): void => {
      const content = contentRef.current;
      if (!content) {
        return;
      }
      const { left } = content.getBoundingClientRect();
      setExplorerWidth(clampExplorerWidth(clientX - left));
    };

    const handlePointerMove = (event: PointerEvent): void => {
      updateWidth(event.clientX);
    };

    const stopResize = (): void => {
      setIsResizingExplorer(false);
    };

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('blur', stopResize);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('blur', stopResize);
    };
  }, [clampExplorerWidth, isResizingExplorer]);

  const explorerUrl = useMemo(
    () => buildPreviewUrl(DEV_EXPLORER_WEBVIEW.id, themeId),
    [themeId]
  );
  const previewUrl = useMemo(
    () => buildPreviewUrlWithParams(webviewId, themeId, previewParams),
    [webviewId, themeId, previewParams]
  );
  const previewLabel = useMemo(() => getDevWebviewLabel(webviewId), [webviewId]);
  const contentStyle = useMemo(
    () => ({ '--dev-explorer-width': `${explorerWidth}px` } as CSSProperties),
    [explorerWidth]
  );

  return (
    <div className="dev-shell">
      <header className="dev-shell__toolbar">
        <h1 className="dev-shell__title">EDA Webview Style Lab</h1>

        <label className="dev-shell__field" htmlFor="webview-select">
          Webview
          <select
            id="webview-select"
            value={webviewId}
            onChange={(event) => {
              setPreviewParams({});
              setWebviewId(event.target.value as DevPreviewWebviewId);
            }}
          >
            {DEV_PREVIEW_WEBVIEWS.map(option => (
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

      <main
        ref={contentRef}
        className={`dev-shell__content${isResizingExplorer ? ' dev-shell__content--resizing' : ''}`}
        style={contentStyle}
      >
        <section className="dev-shell__pane dev-shell__pane--explorer">
          <h2 className="dev-shell__pane-title">{DEV_EXPLORER_WEBVIEW.label}</h2>
          <iframe
            key={`${DEV_EXPLORER_WEBVIEW.id}-${themeId}-${reloadVersion}`}
            src={explorerUrl}
            title="EDA Explorer Preview"
            className="dev-shell__iframe"
          />
        </section>

        <div
          className="dev-shell__splitter"
          role="separator"
          aria-label="Resize explorer width"
          aria-orientation="vertical"
          onPointerDown={handleResizeStart}
        />

        <section className="dev-shell__pane dev-shell__pane--preview">
          <h2 className="dev-shell__pane-title">{previewLabel}</h2>
          <iframe
            key={`${webviewId}-${themeId}-${reloadVersion}`}
            src={previewUrl}
            title={`${previewLabel} Preview`}
            className="dev-shell__iframe"
          />
        </section>
      </main>
    </div>
  );
}
