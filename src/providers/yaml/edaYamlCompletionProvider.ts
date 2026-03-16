import * as vscode from 'vscode';

import type { SchemaProviderService } from '../../services/schemaProviderService';
import { serviceManager } from '../../services/serviceManager';
import { log, LogLevel } from '../../extension';

import type { ResolvedJsonSchema, AutoCompleteHint } from './types';
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
const SELECTOR_KIND_FALLBACKS: Record<string, AutoCompleteHint> = {
  Fabric: { type: 'gvr', group: 'fabrics.eda.nokia.com', version: 'v1alpha1', resource: 'fabrics', kind: 'Fabric' },
  Interface: { type: 'gvr', group: 'interfaces.eda.nokia.com', version: 'v1alpha1', resource: 'interfaces', kind: 'Interface' },
  TopoLink: { type: 'gvr', group: 'core.eda.nokia.com', version: 'v1', resource: 'topolinks', kind: 'TopoLink' },
  TopoNode: { type: 'gvr', group: 'core.eda.nokia.com', version: 'v1', resource: 'toponodes', kind: 'TopoNode' },
};

interface ArrayItemEditContext {
  insertPrefix: string;
  filterPrefix: string;
  replaceRange: vscode.Range;
}

interface KeyEditContext {
  childIndent: number;
  filterPrefix: string;
  replaceRange: vscode.Range;
}

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
      const keyEditContext = this.getKeyEditContext(document, position, ctx);
      const rootCompletions = this.getRootCompletions(ctx, keyEditContext);
      if (rootCompletions) {
        return rootCompletions;
      }

      if (!ctx.kind) {
        return undefined;
      }

      const schema = this.getResolvedSchema(ctx.kind);
      if (!schema) {
        return undefined;
      }

      return this.getSchemaCompletions(document, schema, ctx, position, keyEditContext);
    } catch (err) {
      log(`YAML completion error: ${err}`, LogLevel.DEBUG);
      return undefined;
    }
  }

  private getRootCompletions(
    ctx: ReturnType<typeof parseYamlContext>,
    keyEditContext: KeyEditContext
  ): vscode.CompletionItem[] | undefined {
    if (ctx.path.length === 0 && ctx.isKey && !ctx.kind) {
      return this.getRootKeyCompletions(ctx.existingSiblingKeys, keyEditContext);
    }

    if (ctx.path.length === 0 && ctx.isValue) {
      return this.getRootValueCompletions(ctx.currentKey);
    }

    return undefined;
  }

  private getSchemaCompletions(
    document: vscode.TextDocument,
    rootSchema: ResolvedJsonSchema,
    ctx: ReturnType<typeof parseYamlContext>,
    position: vscode.Position,
    keyEditContext: KeyEditContext
  ): Promise<vscode.CompletionItem[] | undefined> | vscode.CompletionItem[] | undefined {
    const { schema: schemaAtPath } = walkSchemaToPath(rootSchema, ctx.path);
    const arrayItemEdit = this.getScalarArrayItemEditContext(document, position, ctx, schemaAtPath);
    if (arrayItemEdit) {
      return this.getArrayItemValueCompletions(
        document,
        rootSchema,
        ctx.path,
        schemaAtPath,
        ctx.namespace,
        position,
        arrayItemEdit
      );
    }

    if (ctx.isKey) {
      return this.getSchemaKeyCompletions(schemaAtPath, ctx.existingSiblingKeys, keyEditContext);
    }

    if (!ctx.isValue || !ctx.currentKey) {
      return undefined;
    }

    const keyPath = [...ctx.path, ctx.currentKey];
    const { schema: valueSchema } = walkSchemaToPath(rootSchema, keyPath);
    return this.getSchemaValueCompletions(
      rootSchema,
      keyPath,
      valueSchema,
      ctx.namespace,
      position,
      {
        filterPrefix: ctx.currentValue ?? '',
        replaceRange: this.createValueReplaceRange(position, ctx.currentValue),
        insertPrefix: ''
      }
    );
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
  private getRootKeyCompletions(
    existingSiblings: string[],
    editContext: KeyEditContext
  ): vscode.CompletionItem[] {
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
      item.filterText = this.buildFilterText(key, editContext.filterPrefix);
      item.range = editContext.replaceRange;

      if (key === 'metadata' || key === 'spec') {
        item.insertText = new vscode.SnippetString(`${key}:\n${' '.repeat(editContext.childIndent)}$0`);
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
    editContext: KeyEditContext
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
      item.filterText = this.buildFilterText(comp.key, editContext.filterPrefix);
      item.range = editContext.replaceRange;

      // Insert text with type-aware snippets
      item.insertText = this.buildKeySnippet(comp.key, comp.schema, editContext.childIndent);

      return item;
    });
  }

  /** Generate value completions from schema */
  private async getSchemaValueCompletions(
    rootSchema: ResolvedJsonSchema,
    fieldPath: string[],
    schema: ResolvedJsonSchema,
    namespace: string | undefined,
    _position: vscode.Position,
    editContext: ArrayItemEditContext
  ): Promise<vscode.CompletionItem[]> {
    return this.buildValueCompletions(
      rootSchema,
      fieldPath,
      schema,
      [schema],
      namespace,
      editContext
    );
  }

  /** Generate value completions for scalar array items */
  private async getArrayItemValueCompletions(
    document: vscode.TextDocument,
    rootSchema: ResolvedJsonSchema,
    fieldPath: string[],
    arraySchema: ResolvedJsonSchema,
    namespace: string | undefined,
    position: vscode.Position,
    editContext: ArrayItemEditContext
  ): Promise<vscode.CompletionItem[]> {
    const existingValues = this.getExistingScalarArrayValues(document, fieldPath, position.line);
    return this.buildValueCompletions(
      rootSchema,
      fieldPath,
      arraySchema.items ?? arraySchema,
      [arraySchema, arraySchema.items ?? arraySchema],
      namespace,
      editContext,
      existingValues
    );
  }

  /** Build static + dynamic value completions for a field */
  private async buildValueCompletions(
    rootSchema: ResolvedJsonSchema,
    fieldPath: string[],
    staticSchema: ResolvedJsonSchema,
    hintSchemas: ResolvedJsonSchema[],
    namespace: string | undefined,
    editContext: ArrayItemEditContext,
    existingValues: Set<string> = new Set<string>()
  ): Promise<vscode.CompletionItem[]> {
    const items: vscode.CompletionItem[] = [];
    const seenValues = new Set<string>(existingValues);
    let sortIndex = this.appendStaticValueCompletions(items, seenValues, staticSchema, editContext, 0);

    const labelSelectorSchema = hintSchemas.find(candidate => isLabelSelector(candidate));
    if (labelSelectorSchema) {
      await this.appendLabelSelectorValueCompletions(
        items,
        seenValues,
        rootSchema,
        fieldPath,
        labelSelectorSchema,
        namespace,
        editContext,
        sortIndex
      );
      return items;
    }

    await this.appendHintValueCompletions(items, seenValues, hintSchemas, namespace, editContext, sortIndex);
    return items;
  }

  private appendStaticValueCompletions(
    items: vscode.CompletionItem[],
    seenValues: Set<string>,
    schema: ResolvedJsonSchema,
    editContext: ArrayItemEditContext,
    startIndex: number
  ): number {
    let sortIndex = startIndex;
    for (const vc of getValueCompletions(schema)) {
      if (seenValues.has(vc.value)) {
        continue;
      }
      seenValues.add(vc.value);
      const item = new vscode.CompletionItem(vc.value, vscode.CompletionItemKind.Value);
      if (vc.isDefault) {
        item.detail = 'default';
        item.preselect = true;
      }
      if (vc.description) {
        item.documentation = new vscode.MarkdownString(vc.description);
      }
      item.sortText = String(sortIndex++).padStart(4, '0');
      item.filterText = this.buildFilterText(vc.value, editContext.filterPrefix);
      item.range = editContext.replaceRange;
      if (editContext.insertPrefix) {
        item.insertText = `${editContext.insertPrefix}${vc.value}`;
      }
      items.push(item);
    }
    return sortIndex;
  }

  private async appendLabelSelectorValueCompletions(
    items: vscode.CompletionItem[],
    seenValues: Set<string>,
    rootSchema: ResolvedJsonSchema,
    fieldPath: string[],
    labelSelectorSchema: ResolvedJsonSchema,
    namespace: string | undefined,
    editContext: ArrayItemEditContext,
    startIndex: number
  ): Promise<number> {
    try {
      const hint = await this.resolveLabelSelectorTargetHint(rootSchema, fieldPath, labelSelectorSchema);
      if (!hint) {
        return startIndex;
      }
      const values = await this.dynamicProvider.getLabelSelectorValuesForHint(hint, namespace);
      return this.appendSuggestedValues(
        items,
        seenValues,
        values,
        `label selector from ${hint.resource ?? hint.kind ?? hint.type}`,
        editContext,
        startIndex
      );
    } catch {
      return startIndex;
    }
  }

  private async appendHintValueCompletions(
    items: vscode.CompletionItem[],
    seenValues: Set<string>,
    hintSchemas: ResolvedJsonSchema[],
    namespace: string | undefined,
    editContext: ArrayItemEditContext,
    startIndex: number
  ): Promise<number> {
    let sortIndex = startIndex;
    const hints = this.collectUniqueHints(hintSchemas);
    for (const hint of hints) {
      try {
        const values = await this.dynamicProvider.getValuesForHint(hint, namespace);
        sortIndex = this.appendSuggestedValues(
          items,
          seenValues,
          values,
          `from ${hint.resource ?? hint.kind ?? hint.type}`,
          editContext,
          sortIndex
        );
      } catch {
        // ignore dynamic fetch errors
      }
    }
    return sortIndex;
  }

  private appendSuggestedValues(
    items: vscode.CompletionItem[],
    seenValues: Set<string>,
    values: string[],
    detail: string,
    editContext: ArrayItemEditContext,
    startIndex: number
  ): number {
    let sortIndex = startIndex;
    for (const value of values) {
      if (seenValues.has(value)) {
        continue;
      }
      seenValues.add(value);
      const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Reference);
      item.detail = detail;
      item.sortText = `9${String(sortIndex++).padStart(4, '0')}`;
      item.filterText = this.buildFilterText(value, editContext.filterPrefix);
      item.range = editContext.replaceRange;
      if (editContext.insertPrefix) {
        item.insertText = `${editContext.insertPrefix}${value}`;
      }
      items.push(item);
    }
    return sortIndex;
  }

  private getScalarArrayItemEditContext(
    document: vscode.TextDocument,
    position: vscode.Position,
    ctx: ReturnType<typeof parseYamlContext>,
    schemaAtPath: ResolvedJsonSchema
  ): ArrayItemEditContext | undefined {
    if (!ctx.isKey || !this.shouldSuggestArrayItemValues(schemaAtPath)) {
      return undefined;
    }

    const lineText = document.lineAt(position.line).text;
    const trimmed = lineText.trimStart();
    const indent = lineText.length - trimmed.length;

    if (trimmed === '-') {
      return {
        filterPrefix: '',
        replaceRange: new vscode.Range(position.line, indent, position.line, position.character),
        insertPrefix: '- '
      };
    }

    if (ctx.isArrayItem) {
      return {
        filterPrefix: ctx.currentArrayItemValue ?? '',
        replaceRange: this.createArrayItemReplaceRange(lineText, position, indent),
        insertPrefix: ''
      };
    }

    if (trimmed === '') {
      return {
        filterPrefix: '',
        replaceRange: new vscode.Range(position.line, position.character, position.line, position.character),
        insertPrefix: '- '
      };
    }

    return undefined;
  }

  private getKeyEditContext(
    document: vscode.TextDocument,
    position: vscode.Position,
    ctx: ReturnType<typeof parseYamlContext>
  ): KeyEditContext {
    const lineText = document.lineAt(position.line).text;
    const trimmed = lineText.trimStart();
    const lineIndent = lineText.length - trimmed.length;
    const markerOffset = trimmed.startsWith('- ') ? 2 : 0;
    const contentStart = lineIndent + markerOffset;

    return {
      childIndent: contentStart + 2,
      filterPrefix: ctx.currentKeyPrefix ?? '',
      replaceRange: new vscode.Range(position.line, contentStart, position.line, position.character)
    };
  }

  private getExistingScalarArrayValues(
    document: vscode.TextDocument,
    fieldPath: string[],
    currentLine: number
  ): Set<string> {
    const arrayDeclarationLine = this.findArrayDeclarationLine(document, fieldPath, currentLine);
    if (arrayDeclarationLine === undefined) {
      return new Set<string>();
    }

    const declarationIndent = this.getLineIndent(document.lineAt(arrayDeclarationLine).text);
    const currentIndent = this.getLineIndent(document.lineAt(currentLine).text);
    const values = new Set<string>();

    for (let line = arrayDeclarationLine + 1; line < document.lineCount; line += 1) {
      if (line === currentLine) {
        continue;
      }

      const text = document.lineAt(line).text;
      const trimmed = text.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }
      if (trimmed === '---') {
        break;
      }

      const indent = this.getLineIndent(text);
      if (indent <= declarationIndent) {
        break;
      }
      if (indent !== currentIndent) {
        continue;
      }

      const scalarValue = this.extractScalarArrayItemValue(trimmed);
      if (scalarValue) {
        values.add(scalarValue);
      }
    }

    return values;
  }

  private findArrayDeclarationLine(
    document: vscode.TextDocument,
    fieldPath: string[],
    currentLine: number
  ): number | undefined {
    const targetKey = fieldPath[fieldPath.length - 1];
    if (!targetKey) {
      return undefined;
    }

    const currentIndent = this.getLineIndent(document.lineAt(currentLine).text);
    for (let line = currentLine - 1; line >= 0; line -= 1) {
      const text = document.lineAt(line).text;
      const trimmed = text.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }
      if (trimmed === '---') {
        break;
      }

      const indent = this.getLineIndent(text);
      if (indent >= currentIndent) {
        continue;
      }

      const key = this.extractKeyFromLine(trimmed);
      if (key === targetKey) {
        return line;
      }
    }

    return undefined;
  }

  private extractKeyFromLine(trimmed: string): string | undefined {
    const normalized = trimmed.startsWith('- ') ? trimmed.slice(2) : trimmed;
    const colonIndex = normalized.indexOf(':');
    if (colonIndex <= 0) {
      return undefined;
    }
    return normalized.slice(0, colonIndex).trim();
  }

  private extractScalarArrayItemValue(trimmed: string): string | undefined {
    if (trimmed === '-') {
      return undefined;
    }

    if (!trimmed.startsWith('- ')) {
      return undefined;
    }

    const rawValue = trimmed.slice(2).trim();
    if (rawValue.length === 0 || rawValue.includes(':')) {
      return undefined;
    }

    return rawValue;
  }

  private getLineIndent(line: string): number {
    const match = /^(\s*)/.exec(line);
    return match ? match[1].length : 0;
  }

  private createValueReplaceRange(position: vscode.Position, typedValue: string | undefined): vscode.Range {
    const prefixLength = typedValue?.length ?? 0;
    const startCharacter = Math.max(0, position.character - prefixLength);
    return new vscode.Range(position.line, startCharacter, position.line, position.character);
  }

  private createArrayItemReplaceRange(
    lineText: string,
    position: vscode.Position,
    itemIndent: number
  ): vscode.Range {
    const markerStart = itemIndent;
    const markerLength = lineText.slice(markerStart).startsWith('- ') ? 2 : 1;
    const startCharacter = Math.min(position.character, markerStart + markerLength);
    return new vscode.Range(position.line, startCharacter, position.line, position.character);
  }

  private buildFilterText(value: string, filterPrefix: string): string {
    const normalizedPrefix = filterPrefix.trim();
    if (normalizedPrefix.length === 0) {
      return value;
    }
    return `${normalizedPrefix} ${value}`;
  }

  /** Array items without object structure should receive value completions */
  private shouldSuggestArrayItemValues(schema: ResolvedJsonSchema): boolean {
    if (schema.type !== 'array' || !schema.items) {
      return false;
    }
    return !this.isObjectLikeSchema(schema.items);
  }

  private isObjectLikeSchema(schema: ResolvedJsonSchema | undefined): boolean {
    if (!schema) {
      return false;
    }

    if (schema.type === 'object' || Boolean(schema.properties)) {
      return true;
    }

    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      return true;
    }

    for (const composition of [schema.allOf, schema.anyOf, schema.oneOf]) {
      if (composition?.some(candidate => this.isObjectLikeSchema(candidate))) {
        return true;
      }
    }

    return false;
  }

  private collectUniqueHints(schemas: ResolvedJsonSchema[]): AutoCompleteHint[] {
    const hints: AutoCompleteHint[] = [];
    const seen = new Set<string>();

    for (const schema of schemas) {
      for (const hint of getAutoCompleteHints(schema)) {
        const key = `${hint.type}:${hint.group ?? ''}/${hint.version ?? ''}/${hint.resource ?? ''}/${hint.kind ?? ''}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        hints.push(hint);
      }
    }

    return hints;
  }

  private async resolveLabelSelectorTargetHint(
    rootSchema: ResolvedJsonSchema,
    fieldPath: string[],
    fieldSchema: ResolvedJsonSchema
  ): Promise<AutoCompleteHint | undefined> {
    const directHint = this.collectUniqueHints([fieldSchema, fieldSchema.items ?? fieldSchema]).find(
      hint => Boolean(hint.group) && Boolean(hint.version) && Boolean(hint.resource ?? hint.kind)
    );
    if (directHint) {
      return directHint;
    }

    const siblingHint = this.findRelatedSiblingHint(rootSchema, fieldPath);
    if (siblingHint) {
      return siblingHint;
    }

    const inferredKind = this.inferSelectorTargetKind(fieldPath, fieldSchema);
    if (!inferredKind) {
      return undefined;
    }

    return this.lookupKindHint(inferredKind);
  }

  private findRelatedSiblingHint(
    rootSchema: ResolvedJsonSchema,
    fieldPath: string[]
  ): AutoCompleteHint | undefined {
    const fieldKey = fieldPath[fieldPath.length - 1];
    if (!fieldKey) {
      return undefined;
    }

    const parentPath = fieldPath.slice(0, -1);
    const { schema: parentSchema } = walkSchemaToPath(rootSchema, parentPath);
    const parentProperties = parentSchema.properties ?? {};
    const fieldTokens = this.tokenizeSelectorText(fieldKey);

    let bestMatch: { hint: AutoCompleteHint; score: number } | undefined;
    for (const [siblingKey, siblingSchema] of Object.entries(parentProperties)) {
      if (siblingKey === fieldKey) {
        continue;
      }

      const hints = this.collectUniqueHints([siblingSchema, siblingSchema.items ?? siblingSchema]).filter(
        hint => Boolean(hint.group) && Boolean(hint.version) && Boolean(hint.resource ?? hint.kind)
      );
      if (hints.length === 0) {
        continue;
      }

      const siblingText = [
        siblingKey,
        siblingSchema.title ?? '',
        siblingSchema.description ?? '',
      ].join(' ');
      const siblingTokens = this.tokenizeSelectorText(siblingText);
      const overlap = fieldTokens.filter(token => siblingTokens.includes(token)).length;
      if (overlap === 0) {
        continue;
      }

      if (!bestMatch || overlap > bestMatch.score) {
        bestMatch = { hint: hints[0], score: overlap };
      }
    }

    return bestMatch?.hint;
  }

  private inferSelectorTargetKind(
    fieldPath: string[],
    fieldSchema: ResolvedJsonSchema
  ): string | undefined {
    const signalText = [
      fieldPath[fieldPath.length - 1] ?? '',
      fieldSchema.title ?? '',
      fieldSchema.description ?? '',
    ].join(' ');
    const tokens = new Set(this.tokenizeSelectorText(signalText));

    if (tokens.has('toponode') || tokens.has('node')) {
      return 'TopoNode';
    }
    if (tokens.has('topolink') || tokens.has('link')) {
      return 'TopoLink';
    }
    if (tokens.has('fabric')) {
      return 'Fabric';
    }
    if (tokens.has('interface')) {
      return 'Interface';
    }

    return undefined;
  }

  private tokenizeSelectorText(raw: string): string[] {
    return raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map(token => {
        if (token.endsWith('selector')) {
          return token.slice(0, -'selector'.length);
        }
        return token;
      })
      .filter(Boolean)
      .map(token => {
        if (token === 'nodes') return 'node';
        if (token === 'links') return 'link';
        if (token === 'fabrics') return 'fabric';
        if (token === 'interfaces') return 'interface';
        if (token === 'toponodes') return 'toponode';
        if (token === 'topolinks') return 'topolink';
        return token;
      });
  }

  private async lookupKindHint(kind: string): Promise<AutoCompleteHint | undefined> {
    try {
      const service = serviceManager.getService<SchemaProviderService>('schema-provider');
      const definitions = await service.getCustomResourceDefinitions();
      const definition = definitions.find(item => item.kind === kind);
      if (definition) {
        return {
          type: 'gvr',
          group: definition.group,
          version: definition.version,
          resource: definition.plural,
          kind: definition.kind,
        };
      }
    } catch {
      // fall back to built-in mappings
    }

    return SELECTOR_KIND_FALLBACKS[kind];
  }

  /** Build a SnippetString for a key insertion with type-aware templates */
  private buildKeySnippet(
    key: string,
    schema: ResolvedJsonSchema,
    childIndent: number
  ): vscode.SnippetString {
    const type = schema.type;
    const nestedIndent = ' '.repeat(childIndent);

    // Object type: add colon and newline with indent
    if (type === 'object') {
      return new vscode.SnippetString(`${key}:\n${nestedIndent}$0`);
    }

    // Array type: add colon and array item
    if (type === 'array') {
      return new vscode.SnippetString(`${key}:\n${nestedIndent}- $0`);
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
