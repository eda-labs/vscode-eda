import * as vscode from 'vscode';

import type { SchemaProviderService } from '../../services/schemaProviderService';
import { serviceManager } from '../../services/serviceManager';
import { log, LogLevel } from '../../extension';

import type { ResolvedJsonSchema } from './types';
import { parseYamlContext } from './yamlContextParser';
import {
  walkSchemaToPath,
  getKeyCompletions,
  getValueCompletions,
  getAutoCompleteHints,
  isLabelSelector,
} from './schemaWalker';
import { DynamicValueProvider } from './dynamicValueProvider';

const EDA_API_PATTERN = /apiVersion:\s*\S*eda\.nokia\.com/;

/**
 * VS Code CompletionItemProvider for EDA YAML files.
 * Provides context-aware property keys, enum values, defaults,
 * and live cluster data from ui-auto-completes hints.
 */
export class EdaYamlCompletionProvider implements vscode.CompletionItemProvider {
  private dynamicProvider = new DynamicValueProvider();

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _completionContext: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[] | undefined> {
    if (!this.isEdaYaml(document)) {
      return undefined;
    }

    try {
      const ctx = parseYamlContext(document, position);

      // Root-level completions when no kind is identified yet
      if (ctx.path.length === 0 && ctx.isKey && !ctx.kind) {
        return this.getRootKeyCompletions(ctx.existingSiblingKeys);
      }

      // Value completions for root-level special fields
      if (ctx.path.length === 0 && ctx.isValue) {
        return this.getRootValueCompletions(ctx.currentKey);
      }

      // Need a kind to proceed with schema-based completions
      if (!ctx.kind) {
        return undefined;
      }

      const schema = this.getResolvedSchema(ctx.kind);
      if (!schema) {
        return undefined;
      }

      // Walk schema to cursor path
      const { schema: schemaAtPath } = walkSchemaToPath(schema, ctx.path);

      if (ctx.isKey) {
        return this.getSchemaKeyCompletions(schemaAtPath, ctx.existingSiblingKeys, position);
      }

      if (ctx.isValue && ctx.currentKey) {
        // Find the schema for the specific key we're providing values for
        const keyPath = [...ctx.path, ctx.currentKey];
        const { schema: valueSchema } = walkSchemaToPath(schema, keyPath);
        return this.getSchemaValueCompletions(valueSchema, ctx.namespace, position);
      }

      return undefined;
    } catch (err) {
      log(`YAML completion error: ${err}`, LogLevel.DEBUG);
      return undefined;
    }
  }

  /** Check if the first 50 lines contain an EDA apiVersion */
  private isEdaYaml(document: vscode.TextDocument): boolean {
    if (document.languageId !== 'yaml') return false;

    const maxLine = Math.min(50, document.lineCount);
    const text = document.getText(new vscode.Range(0, 0, maxLine, 0));
    return EDA_API_PATTERN.test(text);
  }

  /** Get the resolved schema for a given kind from SchemaProviderService */
  private getResolvedSchema(kind: string): ResolvedJsonSchema | null {
    try {
      const service = serviceManager.getService<SchemaProviderService>('schema-provider');
      return service.getResolvedSchemaForKindSync(kind);
    } catch {
      return null;
    }
  }

  /** Root key completions (apiVersion, kind, metadata, spec) */
  private getRootKeyCompletions(existingSiblings: string[]): vscode.CompletionItem[] {
    const siblingSet = new Set(existingSiblings);
    const items: vscode.CompletionItem[] = [];

    const rootKeys = [
      { key: 'apiVersion', detail: 'API version for this resource', sortOrder: '0' },
      { key: 'kind', detail: 'Resource kind', sortOrder: '1' },
      { key: 'metadata', detail: 'Resource metadata (name, namespace, labels)', sortOrder: '2' },
      { key: 'spec', detail: 'Resource specification', sortOrder: '3' },
    ];

    for (const { key, detail, sortOrder } of rootKeys) {
      if (siblingSet.has(key)) continue;
      const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
      item.detail = detail;
      item.sortText = sortOrder;

      if (key === 'metadata' || key === 'spec') {
        item.insertText = new vscode.SnippetString(`${key}:\n  $0`);
      } else {
        item.insertText = new vscode.SnippetString(`${key}: $0`);
      }

      items.push(item);
    }

    return items;
  }

  /** Value completions for root-level fields */
  private getRootValueCompletions(currentKey: string | undefined): vscode.CompletionItem[] | undefined {
    if (!currentKey) return undefined;

    if (currentKey === 'kind') {
      return this.getKindCompletions();
    }

    if (currentKey === 'apiVersion') {
      return this.getApiVersionCompletions();
    }

    return undefined;
  }

  /** Suggest all known CRD kinds */
  private getKindCompletions(): vscode.CompletionItem[] {
    try {
      const service = serviceManager.getService<SchemaProviderService>('schema-provider');
      const kinds = service.getAvailableKinds();
      return kinds.map((kind, i) => {
        const item = new vscode.CompletionItem(kind, vscode.CompletionItemKind.EnumMember);
        item.sortText = String(i).padStart(4, '0');
        return item;
      });
    } catch {
      return [];
    }
  }

  /** Suggest known API versions */
  private getApiVersionCompletions(): vscode.CompletionItem[] {
    try {
      const service = serviceManager.getService<SchemaProviderService>('schema-provider');
      const versions = service.getAvailableApiVersions();
      return versions.map((version, i) => {
        const item = new vscode.CompletionItem(version, vscode.CompletionItemKind.EnumMember);
        item.sortText = String(i).padStart(4, '0');
        return item;
      });
    } catch {
      return [];
    }
  }

  /** Generate key completions from schema */
  private getSchemaKeyCompletions(
    schema: ResolvedJsonSchema,
    existingSiblings: string[],
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const completions = getKeyCompletions(schema, existingSiblings);
    return completions.map((comp) => {
      const item = new vscode.CompletionItem(comp.key, vscode.CompletionItemKind.Property);

      // Documentation
      item.documentation = this.buildDocumentation(comp.schema);

      // Detail line
      const parts: string[] = [];
      if (comp.schema.type) parts.push(comp.schema.type);
      if (comp.required) parts.push('required');
      const title = comp.schema['x-eda-nokia-com']?.['ui-title'] ?? comp.schema.title;
      if (title) parts.push(title);
      if (parts.length > 0) item.detail = parts.join(' · ');

      // Sort order: required first, then by schema order, then alphabetical
      item.sortText = `${comp.required ? '0' : '1'}${String(comp.orderPriority).padStart(5, '0')}${comp.key}`;

      // Insert text with type-aware snippets
      item.insertText = this.buildKeySnippet(comp.key, comp.schema, position);

      // Don't add a filter on the key - let VS Code handle fuzzy matching
      item.filterText = comp.key;

      return item;
    });
  }

  /** Generate value completions from schema */
  private async getSchemaValueCompletions(
    schema: ResolvedJsonSchema,
    namespace: string | undefined,
    _position: vscode.Position
  ): Promise<vscode.CompletionItem[]> {
    const items: vscode.CompletionItem[] = [];

    // Static value completions (enums, booleans, defaults)
    const staticValues = getValueCompletions(schema);
    for (let i = 0; i < staticValues.length; i++) {
      const vc = staticValues[i];
      const item = new vscode.CompletionItem(vc.value, vscode.CompletionItemKind.Value);
      if (vc.isDefault) {
        item.detail = 'default';
        item.preselect = true;
      }
      if (vc.description) {
        item.documentation = new vscode.MarkdownString(vc.description);
      }
      item.sortText = String(i).padStart(4, '0');
      items.push(item);
    }

    // Dynamic values from auto-complete hints
    const hints = getAutoCompleteHints(schema);
    for (const hint of hints) {
      try {
        const values = await this.dynamicProvider.getValuesForHint(hint, namespace);
        for (const value of values) {
          const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Reference);
          item.detail = `from ${hint.resource ?? hint.kind ?? hint.type}`;
          items.push(item);
        }
      } catch {
        // ignore dynamic fetch errors
      }
    }

    // Label selector format: fetch label key=value pairs
    if (isLabelSelector(schema)) {
      try {
        // Extract GVR info from the closest parent with auto-complete hints
        const values = await this.dynamicProvider.getLabelSelectorValues(
          '', '', '', namespace
        );
        for (const value of values) {
          const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Reference);
          item.detail = 'label selector';
          items.push(item);
        }
      } catch {
        // ignore
      }
    }

    return items;
  }

  /** Build a SnippetString for a key insertion with type-aware templates */
  private buildKeySnippet(
    key: string,
    schema: ResolvedJsonSchema,
    _position: vscode.Position
  ): vscode.SnippetString {
    const type = schema.type;

    // Object type: add colon and newline with indent
    if (type === 'object') {
      return new vscode.SnippetString(`${key}:\n  $0`);
    }

    // Array type: add colon and array item
    if (type === 'array') {
      return new vscode.SnippetString(`${key}:\n  - $0`);
    }

    // Boolean type: offer choice
    if (type === 'boolean') {
      const def = schema.default !== undefined ? String(schema.default) : 'true';
      return new vscode.SnippetString(`${key}: \${1|${def === 'true' ? 'true,false' : 'false,true'}|}`);
    }

    // Enum type: offer choices
    if (schema.enum && schema.enum.length > 0) {
      const choices = schema.enum.map(v => v === null ? 'null' : String(v)).join(',');
      return new vscode.SnippetString(`${key}: \${1|${choices}|}`);
    }

    // Default with value placeholder
    if (schema.default !== undefined) {
      return new vscode.SnippetString(`${key}: \${1:${String(schema.default)}}`);
    }

    return new vscode.SnippetString(`${key}: $0`);
  }

  /** Build rich Markdown documentation for a schema property */
  private buildDocumentation(schema: ResolvedJsonSchema): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    const ext = schema['x-eda-nokia-com'];
    const title = ext?.['ui-title'] ?? schema.title;
    if (title) {
      md.appendMarkdown(`**${title}**\n\n`);
    }

    if (schema.description) {
      md.appendMarkdown(`${schema.description}\n\n`);
    }

    const details: string[] = [];
    if (schema.type) details.push(`**Type:** \`${schema.type}\``);
    if (schema.format) details.push(`**Format:** \`${schema.format}\``);
    if (schema.default !== undefined) details.push(`**Default:** \`${JSON.stringify(schema.default)}\``);
    if (schema.pattern) details.push(`**Pattern:** \`${schema.pattern}\``);
    if (schema.enum) details.push(`**Values:** ${schema.enum.map(v => `\`${v}\``).join(', ')}`);
    if (schema.minimum !== undefined) details.push(`**Min:** ${schema.minimum}`);
    if (schema.maximum !== undefined) details.push(`**Max:** ${schema.maximum}`);
    if (schema.minLength !== undefined) details.push(`**Min length:** ${schema.minLength}`);
    if (schema.maxLength !== undefined) details.push(`**Max length:** ${schema.maxLength}`);

    if (details.length > 0) {
      md.appendMarkdown(details.join('  \n'));
    }

    return md;
  }
}
