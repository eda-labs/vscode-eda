// providers/documents/deviationDetailsProvider.ts
import * as vscode from 'vscode';
import { BaseDocumentProvider } from './baseDocumentProvider';

export class DeviationDetailsDocumentProvider extends BaseDocumentProvider {
  public setDeviationContent(uri: vscode.Uri, text: string): void {
    this.setContent(uri, text);
  }
}
