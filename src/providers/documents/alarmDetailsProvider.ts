// providers/documents/alarmDetailsProvider.ts
import * as vscode from 'vscode';
import { BaseDocumentProvider } from './baseDocumentProvider';

export class AlarmDetailsDocumentProvider extends BaseDocumentProvider {
  public setAlarmContent(uri: vscode.Uri, text: string): void {
    this.setContent(uri, text);
  }
}
