import * as vscode from 'vscode';

/**
 * Base class for read-only document providers implementing the vscode.FileSystemProvider interface
 */
export abstract class BaseDocumentProvider implements vscode.FileSystemProvider {
  protected contentMap = new Map<string, Buffer>();

  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

  /**
   * Store the content for a given URI
   */
  protected setContent(uri: vscode.Uri, content: string): void {
    this.contentMap.set(uri.toString(), Buffer.from(content, 'utf8'));
  }

  /**
   * Required by FileSystemProvider, but not needed for read-only providers
   */
  watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  /**
   * Get information about a file
   */
  stat(uri: vscode.Uri): vscode.FileStat {
    const data = this.contentMap.get(uri.toString());
    if (!data) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: data.byteLength,
      permissions: vscode.FilePermission.Readonly // Explicitly set read-only permission
    };
  }

  /**
   * Not supporting directory listing
   */
  readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] {
    return [];
  }

  /**
   * Not supporting directory creation (read-only)
   */
  createDirectory(_uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions('Read-only: cannot create directory');
  }

  /**
   * Read file content
   */
  readFile(uri: vscode.Uri): Uint8Array {
    const data = this.contentMap.get(uri.toString());
    if (!data) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return data;
  }

  /**
   * Not supporting write operations (read-only)
   */
  writeFile(_uri: vscode.Uri, _content: Uint8Array, _options: { create: boolean; overwrite: boolean }): void {
    throw vscode.FileSystemError.NoPermissions('This document is read-only. Use "Switch to Edit" to modify.');
  }

  /**
   * Not supporting delete operations (read-only)
   */
  delete(_uri: vscode.Uri, _options: { recursive: boolean }): void {
    throw vscode.FileSystemError.NoPermissions('Read-only: delete not supported');
  }

  /**
   * Not supporting rename operations (read-only)
   */
  rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { overwrite: boolean }): void {
    throw vscode.FileSystemError.NoPermissions('Read-only: rename not supported');
  }
}