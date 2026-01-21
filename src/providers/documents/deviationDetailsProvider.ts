// src/providers/documents/deviationDetailsProvider.ts
import type * as vscode from 'vscode';

import { BaseDocumentProvider } from './baseDocumentProvider';

/**
 * A read-only provider for "eda-deviation:" URIs that displays
 * EDA deviation details (often in Markdown).
 */
export class DeviationDetailsDocumentProvider extends BaseDocumentProvider {
  public setDeviationContent(uri: vscode.Uri, text: string): void {
    this.setContent(uri, text);
  }
}
