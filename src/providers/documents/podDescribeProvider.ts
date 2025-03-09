import * as vscode from 'vscode';
import { BaseDocumentProvider } from './baseDocumentProvider';

/**
 * Provides read-only text for "kubectl describe pod" output, under the "k8s-describe:" URI scheme.
 */
export class PodDescribeDocumentProvider extends BaseDocumentProvider {
  /**
   * Store the textual output for a given 'k8s-describe:' URI.
   */
  public setDescribeContent(uri: vscode.Uri, text: string): void {
    this.setContent(uri, text);
  }
}