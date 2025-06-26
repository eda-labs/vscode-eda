import * as vscode from 'vscode';
import { BaseDocumentProvider } from './baseDocumentProvider';

/**
 * Provides read-only JSON view for transactions in the basket under the
 * `basket-tx:` URI scheme.
 */
export class BasketTransactionDocumentProvider extends BaseDocumentProvider {
  public setContentForUri(uri: vscode.Uri, text: string): void {
    this.setContent(uri, text);
  }
}
