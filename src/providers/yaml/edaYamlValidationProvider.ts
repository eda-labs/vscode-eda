import * as vscode from 'vscode';

import {
  LineCounter,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
  type Node
} from 'yaml';

import { serviceManager } from '../../services/serviceManager';
import type { SchemaProviderService } from '../../services/schemaProviderService';

import { mergeSchemaCompositions } from './schemaWalker';
import type { ResolvedJsonSchema } from './types';

const EDA_API_PATTERN = /apiVersion:\s*\S*eda\.nokia\.com/;

type YamlNode = Node | null | undefined;

export class EdaYamlValidationProvider implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('eda-yaml');

  public activate(context: vscode.ExtensionContext): void {
    const schemaChangeSubscription = this.subscribeToSchemaChanges();

    context.subscriptions.push(
      this.diagnostics,
      schemaChangeSubscription,
      vscode.workspace.onDidOpenTextDocument(document => {
        this.refreshDocument(document);
      }),
      vscode.workspace.onDidChangeTextDocument(event => {
        this.refreshDocument(event.document);
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        this.diagnostics.delete(document.uri);
      })
    );

    for (const document of vscode.workspace.textDocuments) {
      this.refreshDocument(document);
    }
  }

  public dispose(): void {
    this.diagnostics.dispose();
  }

  public validateDocument(document: vscode.TextDocument): vscode.Diagnostic[] {
    if (!this.isEdaYaml(document)) {
      return [];
    }

    const text = document.getText();
    const lineCounter = new LineCounter();
    const parsedDocuments = parseAllDocuments(text, {
      lineCounter,
      prettyErrors: false,
      strict: false
    });
    const diagnostics: vscode.Diagnostic[] = [];

    for (const parsedDocument of parsedDocuments) {
      for (const error of parsedDocument.errors) {
        diagnostics.push(new vscode.Diagnostic(
          this.createRange(lineCounter, error.pos[0], error.pos[1]),
          error.message,
          vscode.DiagnosticSeverity.Error
        ));
      }

      const kind = this.getRootScalarValue(parsedDocument.contents, 'kind');
      if (!kind) {
        continue;
      }

      const apiVersion = this.getRootScalarValue(parsedDocument.contents, 'apiVersion');
      const schema = this.getResolvedSchema(kind, apiVersion);
      if (!schema) {
        continue;
      }

      this.validateNode(parsedDocument.contents, schema, diagnostics, lineCounter);
    }

    return diagnostics;
  }

  private refreshDocument(document: vscode.TextDocument): void {
    if (!this.isEdaYaml(document)) {
      this.diagnostics.delete(document.uri);
      return;
    }

    this.diagnostics.set(document.uri, this.validateDocument(document));
  }

  private refreshOpenDocuments(): void {
    for (const document of vscode.workspace.textDocuments) {
      this.refreshDocument(document);
    }
  }

  private subscribeToSchemaChanges(): vscode.Disposable {
    try {
      const service = serviceManager.getService<SchemaProviderService>('schema-provider');
      return service.onDidSchemasChanged(() => {
        this.refreshOpenDocuments();
      });
    } catch {
      return new vscode.Disposable(() => undefined);
    }
  }

  private isEdaYaml(document: vscode.TextDocument): boolean {
    if (document.languageId !== 'yaml') {
      return false;
    }

    const maxLine = Math.min(50, document.lineCount);
    const text = document.getText(new vscode.Range(0, 0, maxLine, 0));
    return EDA_API_PATTERN.test(text);
  }

  private getResolvedSchema(kind: string, apiVersion: string | undefined): ResolvedJsonSchema | null {
    try {
      const service = serviceManager.getService<SchemaProviderService>('schema-provider');
      const resourceAwareService = service as SchemaProviderService & {
        getResolvedSchemaForResourceSync?: (
          requestedKind: string,
          requestedApiVersion: string | undefined
        ) => ResolvedJsonSchema | null;
      };

      if (typeof resourceAwareService.getResolvedSchemaForResourceSync === 'function') {
        return resourceAwareService.getResolvedSchemaForResourceSync(kind, apiVersion);
      }

      return service.getResolvedSchemaForKindSync(kind);
    } catch {
      return null;
    }
  }

  private getRootScalarValue(node: YamlNode, key: string): string | undefined {
    if (!node || !isMap(node)) {
      return undefined;
    }

    for (const pair of node.items) {
      if (!isScalar(pair.key) || pair.key.value !== key || !pair.value || !isScalar(pair.value)) {
        continue;
      }
      return typeof pair.value.value === 'string' ? pair.value.value : String(pair.value.value);
    }

    return undefined;
  }

  private validateNode(
    node: YamlNode,
    schema: ResolvedJsonSchema,
    diagnostics: vscode.Diagnostic[],
    lineCounter: LineCounter
  ): void {
    if (!node) {
      return;
    }

    const normalizedSchema = mergeSchemaCompositions(schema);
    const schemaShape = this.getSchemaShapeType(normalizedSchema);

    if (isMap(node)) {
      if (schemaShape && schemaShape !== 'object') {
        diagnostics.push(this.createTypeDiagnostic(
          lineCounter,
          node.range,
          this.describeActualNode(node),
          schemaShape
        ));
        return;
      }

      this.validateMapNode(node, normalizedSchema, diagnostics, lineCounter);
      return;
    }

    if (isSeq(node)) {
      if (schemaShape && schemaShape !== 'array') {
        diagnostics.push(this.createTypeDiagnostic(
          lineCounter,
          node.range,
          this.describeActualNode(node),
          schemaShape
        ));
        return;
      }

      const itemSchema = normalizedSchema.items;
      if (!itemSchema) {
        return;
      }

      for (const item of node.items) {
        this.validateNode(item as YamlNode, itemSchema, diagnostics, lineCounter);
      }
      return;
    }

    this.validateScalarNode(node, normalizedSchema, diagnostics, lineCounter);
  }

  private validateMapNode(
    node: Extract<YamlNode, Node>,
    schema: ResolvedJsonSchema,
    diagnostics: vscode.Diagnostic[],
    lineCounter: LineCounter
  ): void {
    if (!isMap(node)) {
      return;
    }

    const properties = schema.properties ?? {};
    const additionalProperties = schema.additionalProperties;
    const hasExplicitProperties = Object.keys(properties).length > 0;
    const allowsUnknownKeys = additionalProperties === true
      || typeof additionalProperties === 'object'
      || (!hasExplicitProperties && additionalProperties !== false);

    for (const pair of node.items) {
      if (!isScalar(pair.key)) {
        continue;
      }

      const key = String(pair.key.value);
      const propertySchema = properties[key];
      if (propertySchema) {
        this.validateNode(pair.value as YamlNode, propertySchema, diagnostics, lineCounter);
        continue;
      }

      if (typeof additionalProperties === 'object') {
        this.validateNode(pair.value as YamlNode, additionalProperties, diagnostics, lineCounter);
        continue;
      }

      if (!allowsUnknownKeys) {
        diagnostics.push(new vscode.Diagnostic(
          this.createRangeFromNode(lineCounter, pair.key),
          `Unknown field "${key}"`,
          vscode.DiagnosticSeverity.Error
        ));
      }
    }
  }

  private validateScalarNode(
    node: Extract<YamlNode, Node>,
    schema: ResolvedJsonSchema,
    diagnostics: vscode.Diagnostic[],
    lineCounter: LineCounter
  ): void {
    if (!isScalar(node)) {
      return;
    }

    const actualValue = node.value;
    const actualType = this.describeScalarValue(actualValue);
    const expectedType = this.getSchemaShapeType(schema);

    if (expectedType && !this.isScalarTypeCompatible(schema, actualValue)) {
      diagnostics.push(this.createTypeDiagnostic(
        lineCounter,
        node.range,
        actualType,
        expectedType
        ));
      return;
    }

    if (this.appendEnumDiagnostic(node, schema, diagnostics, lineCounter)) {
      return;
    }

    if (typeof actualValue === 'number') {
      this.appendNumericConstraintDiagnostics(node, schema, diagnostics, lineCounter, actualValue);
    }

    if (typeof actualValue === 'string') {
      this.appendStringConstraintDiagnostics(node, schema, diagnostics, lineCounter, actualValue);
    }
  }

  private appendEnumDiagnostic(
    node: Extract<YamlNode, Node>,
    schema: ResolvedJsonSchema,
    diagnostics: vscode.Diagnostic[],
    lineCounter: LineCounter
  ): boolean {
    if (!schema.enum || schema.enum.length === 0 || !isScalar(node)) {
      return false;
    }
    if (schema.enum.some(value => value === node.value)) {
      return false;
    }

    const renderedValue = typeof node.value === 'string' ? `"${node.value}"` : String(node.value);
    diagnostics.push(new vscode.Diagnostic(
      this.createRangeFromNode(lineCounter, node),
      `Invalid value ${renderedValue}. Expected one of: ${schema.enum.map(value => String(value)).join(', ')}`,
      vscode.DiagnosticSeverity.Error
    ));
    return true;
  }

  private appendNumericConstraintDiagnostics(
    node: Extract<YamlNode, Node>,
    schema: ResolvedJsonSchema,
    diagnostics: vscode.Diagnostic[],
    lineCounter: LineCounter,
    value: number
  ): void {
    if (schema.minimum !== undefined && value < schema.minimum) {
      diagnostics.push(new vscode.Diagnostic(
        this.createRangeFromNode(lineCounter, node),
        `Value must be >= ${schema.minimum}`,
        vscode.DiagnosticSeverity.Error
      ));
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      diagnostics.push(new vscode.Diagnostic(
        this.createRangeFromNode(lineCounter, node),
        `Value must be <= ${schema.maximum}`,
        vscode.DiagnosticSeverity.Error
      ));
    }
  }

  private appendStringConstraintDiagnostics(
    node: Extract<YamlNode, Node>,
    schema: ResolvedJsonSchema,
    diagnostics: vscode.Diagnostic[],
    lineCounter: LineCounter,
    value: string
  ): void {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      diagnostics.push(new vscode.Diagnostic(
        this.createRangeFromNode(lineCounter, node),
        `Value must be at least ${schema.minLength} characters`,
        vscode.DiagnosticSeverity.Error
      ));
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      diagnostics.push(new vscode.Diagnostic(
        this.createRangeFromNode(lineCounter, node),
        `Value must be at most ${schema.maxLength} characters`,
        vscode.DiagnosticSeverity.Error
      ));
    }
    if (!schema.pattern) {
      return;
    }

    const pattern = new RegExp(schema.pattern);
    if (!pattern.test(value)) {
      diagnostics.push(new vscode.Diagnostic(
        this.createRangeFromNode(lineCounter, node),
        `Value does not match required pattern ${schema.pattern}`,
        vscode.DiagnosticSeverity.Error
      ));
    }
  }

  private createTypeDiagnostic(
    lineCounter: LineCounter,
    range: [number, number, number] | null | undefined,
    actualType: string,
    expectedType: string
  ): vscode.Diagnostic {
    return new vscode.Diagnostic(
      this.createRange(lineCounter, range?.[0] ?? 0, range?.[2] ?? range?.[0] ?? 0),
      `Expected ${expectedType}, got ${actualType}`,
      vscode.DiagnosticSeverity.Error
    );
  }

  private createRangeFromNode(
    lineCounter: LineCounter,
    node: Extract<YamlNode, Node>
  ): vscode.Range {
    return this.createRange(lineCounter, node.range?.[0] ?? 0, node.range?.[2] ?? node.range?.[0] ?? 0);
  }

  private createRange(lineCounter: LineCounter, startOffset: number, endOffset: number): vscode.Range {
    const normalizedEnd = Math.max(startOffset + 1, endOffset);
    const start = lineCounter.linePos(startOffset);
    const end = lineCounter.linePos(normalizedEnd);
    return new vscode.Range(
      new vscode.Position(start.line - 1, start.col - 1),
      new vscode.Position(end.line - 1, end.col - 1)
    );
  }

  private getSchemaShapeType(schema: ResolvedJsonSchema): string | undefined {
    if (schema.type) {
      return schema.type;
    }
    if (schema.properties || typeof schema.additionalProperties === 'object') {
      return 'object';
    }
    if (schema.items) {
      return 'array';
    }
    return undefined;
  }

  private isScalarTypeCompatible(schema: ResolvedJsonSchema, value: unknown): boolean {
    switch (schema.type) {
      case 'boolean':
        return typeof value === 'boolean';
      case 'integer':
        return typeof value === 'number' && Number.isInteger(value);
      case 'number':
        return typeof value === 'number';
      case 'string':
        return typeof value === 'string';
      case 'object':
        return false;
      case 'array':
        return false;
      default:
        return true;
    }
  }

  private describeActualNode(node: YamlNode): string {
    if (node && isMap(node)) {
      return 'object';
    }
    if (node && isSeq(node)) {
      return 'array';
    }
    if (node && isScalar(node)) {
      return this.describeScalarValue(node.value);
    }
    return 'unknown';
  }

  private describeScalarValue(value: unknown): string {
    if (value === null) {
      return 'null';
    }
    if (Array.isArray(value)) {
      return 'array';
    }
    return typeof value;
  }
}
