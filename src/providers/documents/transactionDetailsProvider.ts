import * as vscode from 'vscode';
import { BaseDocumentProvider } from './baseDocumentProvider';

/**
 * A read-only provider for "eda-transaction:" URIs that displays
 * EDA transaction details text from "edactl transaction <id>".
 */
export class TransactionDetailsDocumentProvider extends BaseDocumentProvider {
  /**
   * Store the transaction details text for a given "eda-transaction:" URI
   */
  public setTransactionContent(uri: vscode.Uri, text: string): void {
    this.setContent(uri, text);
  }
}