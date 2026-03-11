const { test, expect } = require('@playwright/test');

const READY_EVENT_NAME = 'eda-dev-explorer-ready';
const READY_EVENT_GLOBAL_KEY = '__EDA_DEV_EXPLORER_READY__';
const READY_TARGET_MS = Number(process.env.EDA_PLAYWRIGHT_READY_TARGET_MS || 2200);
const MIN_RESOURCE_COUNT = Number(process.env.EDA_PLAYWRIGHT_MIN_RESOURCE_COUNT || 1);
const BOOTSTRAP_MIN_RESOURCES = Number(process.env.EDA_PLAYWRIGHT_BOOTSTRAP_MIN_RESOURCES || 1000);
const BATCH_SIZE = Number(process.env.EDA_PLAYWRIGHT_BATCH_SIZE || 6);

function buildExplorerPreviewUrl() {
  const params = new URLSearchParams({
    webview: 'edaExplorer',
    theme: 'vscode-dark',
    explorerDataSource: 'real',
    explorerRealMinResources: String(BOOTSTRAP_MIN_RESOURCES),
    explorerRealBatchSize: String(BATCH_SIZE)
  });

  if (process.env.EDA_PLAYWRIGHT_TARGET) {
    params.set('target', process.env.EDA_PLAYWRIGHT_TARGET);
  }
  if (process.env.EDA_PLAYWRIGHT_API_PREFIX) {
    params.set('explorerRealApiPrefix', process.env.EDA_PLAYWRIGHT_API_PREFIX);
  }
  if (process.env.EDA_PLAYWRIGHT_STREAM_LIMIT) {
    params.set('explorerRealStreamLimit', process.env.EDA_PLAYWRIGHT_STREAM_LIMIT);
  }

  return `/preview.html?${params.toString()}`;
}

async function waitForExplorerReadyEvent(page) {
  return page.evaluate(({ eventName, globalKey }) => {
    const maybeGlobal = globalThis;
    const existing = maybeGlobal[globalKey];
    if (existing && typeof existing === 'object') {
      return existing;
    }

    return new Promise((resolve) => {
      window.addEventListener(eventName, (event) => {
        const customEvent = event;
        resolve(customEvent.detail ?? null);
      }, { once: true });
    });
  }, {
    eventName: READY_EVENT_NAME,
    globalKey: READY_EVENT_GLOBAL_KEY
  });
}

test('real EDA explorer reaches resource-ready SLA', async ({ page }) => {
  const previewUrl = buildExplorerPreviewUrl();
  await page.goto(previewUrl, { waitUntil: 'domcontentloaded' });

  const readyDetail = await waitForExplorerReadyEvent(page);
  expect(readyDetail).toBeTruthy();

  const resourcesHeader = page.getByText(/^Resources \(\d+\)$/).first();
  await expect(resourcesHeader).toBeVisible();

  const resourcesHeaderText = (await resourcesHeader.textContent()) || '';
  const resourceCountMatch = /\((\d+)\)/.exec(resourcesHeaderText);
  const resourceCount = resourceCountMatch ? Number(resourceCountMatch[1]) : 0;

  expect(resourceCount).toBeGreaterThanOrEqual(MIN_RESOURCE_COUNT);

  const readyMs = typeof readyDetail.readyMs === 'number' ? readyDetail.readyMs : Number.POSITIVE_INFINITY;
  const loadMs = typeof readyDetail.loadMs === 'number' ? readyDetail.loadMs : undefined;
  const renderMs = typeof readyDetail.renderMs === 'number' ? readyDetail.renderMs : undefined;
  // Keep a plain log line so perf runs are visible in CI and local terminal output.
  console.log(
    `[eda-playwright] readyMs=${readyMs} loadMs=${loadMs ?? 'n/a'} renderMs=${renderMs ?? 'n/a'} resources=${resourceCount}`
  );
  expect(readyMs).toBeLessThanOrEqual(READY_TARGET_MS);

  test.info().annotations.push({
    type: 'real-eda-perf',
    description: JSON.stringify({
      readyMs,
      loadMs,
      renderMs,
      resourceLeafCount: readyDetail.resourceLeafCount,
      discoveredStreams: readyDetail.discoveredStreams,
      loadedStreams: readyDetail.loadedStreams,
      namespaceCount: readyDetail.namespaceCount,
      targetUrl: readyDetail.targetUrl,
      apiBaseUrl: readyDetail.apiBaseUrl
    })
  });
});
