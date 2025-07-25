import * as vscode from 'vscode';
import { BaseDocumentProvider } from './baseDocumentProvider';

/**
 * File system provider for editable basket items under the `basket-edit:` scheme.
 */
export class BasketEditDocumentProvider extends BaseDocumentProvider {
  public stat(uri: vscode.Uri): vscode.FileStat {
    const data = this.contentMap.get(uri.toString());
    if (!data) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: data.byteLength
    };
  }

  public setContentForUri(uri: vscode.Uri, text: string): void {
    this.setContent(uri, text);
  }

  public writeFile(uri: vscode.Uri, content: Uint8Array): void {
    this.contentMap.set(uri.toString(), Buffer.from(content));
  }
}
