// src/providers/documents/transactionDetailsProvider.ts
import * as vscode from 'vscode';
import { BaseDocumentProvider } from './baseDocumentProvider';

/**
 * A read-only provider for "eda-transaction:" URIs that displays
 * EDA transaction details text from `edactl transaction <id>`.
 */
export class TransactionDetailsDocumentProvider extends BaseDocumentProvider {
  public setTransactionContent(uri: vscode.Uri, text: string): void {
    this.setContent(uri, text);
  }
}
