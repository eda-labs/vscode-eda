import React from 'react';
import { renderToString } from 'react-dom/server';

import { ExplorerRenderBenchmarkView } from '../../src/webviews/explorer/explorerRenderBenchmark';
import type { ExplorerSectionSnapshot } from '../../src/webviews/shared/explorer/types';

export function renderExplorerSectionsMarkup(sections: ExplorerSectionSnapshot[], expandAll: boolean): string {
  return renderToString(React.createElement(ExplorerRenderBenchmarkView, {
    sections,
    expandAll
  }));
}
