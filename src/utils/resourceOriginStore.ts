import * as vscode from 'vscode';

const viewOrigins = new Map<string, boolean>();

export function setViewIsEda(uri: vscode.Uri, isEda: boolean): void {
  viewOrigins.set(uri.toString(), isEda);
}

export function getViewIsEda(uri: vscode.Uri): boolean | undefined {
  return viewOrigins.get(uri.toString());
}
