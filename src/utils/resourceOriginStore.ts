import * as vscode from 'vscode';

const viewOrigins = new Map<string, boolean>();
const resourceOrigins = new Map<string, boolean>();

export function setViewIsEda(uri: vscode.Uri, isEda: boolean): void {
  viewOrigins.set(uri.toString(), isEda);
}

export function getViewIsEda(uri: vscode.Uri): boolean | undefined {
  return viewOrigins.get(uri.toString());
}

function getKey(namespace: string, kind: string, name: string): string {
  return `${namespace}/${kind}/${name}`;
}

export function setResourceOrigin(
  namespace: string,
  kind: string,
  name: string,
  isEda: boolean
): void {
  resourceOrigins.set(getKey(namespace, kind, name), isEda);
}

export function getResourceOrigin(
  namespace: string,
  kind: string,
  name: string
): boolean | undefined {
  return resourceOrigins.get(getKey(namespace, kind, name));
}
