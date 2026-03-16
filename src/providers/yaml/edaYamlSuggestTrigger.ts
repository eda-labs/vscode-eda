import * as vscode from 'vscode';

function getCompletionLabel(item: vscode.CompletionItem): string {
  return typeof item.label === 'string' ? item.label : item.label.label;
}

export function isSuggestTriggerPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  const lineText = document.lineAt(position.line).text;
  const beforeCursor = lineText.slice(0, position.character);
  const afterCursor = lineText.slice(position.character);

  if (afterCursor.trim().length > 0) {
    return false;
  }

  const trimmedBefore = beforeCursor.trimStart();
  if (beforeCursor.trim().length === 0) {
    return true;
  }

  return trimmedBefore === '-' || trimmedBefore === '- ';
}

export async function collectSuggestibleCompletions(
  provider: vscode.CompletionItemProvider,
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<{ labels: string[]; shouldTrigger: boolean }> {
  if (!isSuggestTriggerPosition(document, position)) {
    return { labels: [], shouldTrigger: false };
  }

  const items = await provider.provideCompletionItems(
    document,
    position,
    {} as vscode.CancellationToken,
    {} as vscode.CompletionContext
  );
  const completionItems = Array.isArray(items) ? items : [];
  return {
    labels: completionItems.map(getCompletionLabel),
    shouldTrigger: completionItems.length > 0
  };
}

export function registerEdaYamlCursorSuggest(
  context: vscode.ExtensionContext,
  provider: vscode.CompletionItemProvider
): void {
  let lastTriggerKey: string | undefined;

  const maybeTriggerSuggest = async (editor?: vscode.TextEditor) => {
    if (!editor || editor !== vscode.window.activeTextEditor) {
      lastTriggerKey = undefined;
      return;
    }

    const selection = editor.selection;
    if (!selection || !selection.isEmpty) {
      lastTriggerKey = undefined;
      return;
    }

    const position = selection.active;
    const result = await collectSuggestibleCompletions(provider, editor.document, position);
    if (!result.shouldTrigger) {
      lastTriggerKey = undefined;
      return;
    }

    const triggerKey = `${editor.document.uri.toString()}:${editor.document.version}:${position.line}:${position.character}`;
    if (triggerKey === lastTriggerKey) {
      return;
    }

    lastTriggerKey = triggerKey;
    await vscode.commands.executeCommand('editor.action.triggerSuggest');
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      void maybeTriggerSuggest(editor);
    }),
    vscode.window.onDidChangeTextEditorSelection(event => {
      void maybeTriggerSuggest(event.textEditor);
    })
  );
}
