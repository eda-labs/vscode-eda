import * as vscode from 'vscode';

import type { SchemaProviderService } from '../../services/schemaProviderService';
import { serviceManager } from '../../services/serviceManager';
import { log, LogLevel } from '../../extension';

import type { ResolvedJsonSchema } from './types';
import { parseYamlContext } from './yamlContextParser';
import { walkSchemaToPath } from './schemaWalker';

const EDA_API_PATTERN = /apiVersion:\s*\S*eda\.nokia\.com/;

/**
 * VS Code HoverProvider for EDA YAML files.
 * Shows rich documentation for property keys inline.
 */
export class EdaYamlHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | undefined {
    if (!this.isEdaYaml(document)) {
      return undefined;
    }

    try {
      const ctx = parseYamlContext(document, position);
      if (!ctx.kind) {
        return undefined;
      }

      // Determine what word the cursor is on
      const wordRange = document.getWordRangeAtPosition(position, /[\w.-]+/);
      if (!wordRange) {
        return undefined;
      }
      const word = document.getText(wordRange);

      const schema = this.getResolvedSchema(ctx.kind, ctx.apiVersion);
      if (!schema) {
        return undefined;
      }

      // Build path to the hovered word
      let targetPath: string[];
      if (ctx.isKey || ctx.currentKey === word) {
        // Hovering over a key - walk to it
        targetPath = [...ctx.path, word];
      } else if (ctx.isValue && ctx.currentKey) {
        // Hovering over a value - show the property's schema
        targetPath = [...ctx.path, ctx.currentKey];
      } else {
        targetPath = [...ctx.path, word];
      }

      const { schema: propSchema, resolved } = walkSchemaToPath(schema, targetPath);
      if (!resolved) {
        return undefined;
      }

      const md = this.buildHoverContent(propSchema, targetPath);
      if (md.value.trim().length === 0) {
        return undefined;
      }
      return new vscode.Hover(md, wordRange);
    } catch (err) {
      log(`YAML hover error: ${err}`, LogLevel.DEBUG);
      return undefined;
    }
  }

  private isEdaYaml(document: vscode.TextDocument): boolean {
    if (document.languageId !== 'yaml') return false;
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

  private buildHoverContent(
    schema: ResolvedJsonSchema,
    path: string[]
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    const ext = schema['x-eda-nokia-com'];

    if (path.length > 0) {
      md.appendMarkdown(`*Path:* \`${path.join('.')}\`\n\n`);
    }

    // Append schema detail lines
    for (const line of this.buildSchemaDetailLines(schema)) {
      md.appendMarkdown(`${line}\n\n`);
    }

    if (ext?.immutable) {
      md.appendMarkdown('*This field is immutable after creation.*\n\n');
    }

    this.appendPropertiesSummary(md, schema);

    return md;
  }

  /** Build individual detail lines for schema properties */
  private buildSchemaDetailLines(schema: ResolvedJsonSchema): string[] {
    const lines: string[] = [];

    if (schema.type) lines.push(`**Type:** \`${schema.type}\``);
    if (schema.format) lines.push(`**Format:** \`${schema.format}\``);
    if (schema.default !== undefined) lines.push(`**Default:** \`${JSON.stringify(schema.default)}\``);
    if (schema.enum) lines.push(`**Allowed values:** ${schema.enum.map(v => `\`${v}\``).join(', ')}`);
    if (schema.pattern) lines.push(`**Pattern:** \`${schema.pattern}\``);

    const numRange = this.formatRange(schema.minimum, schema.maximum);
    if (numRange) lines.push(`**Range:** ${numRange}`);

    const lenRange = this.formatRange(schema.minLength, schema.maxLength);
    if (lenRange) lines.push(`**Length:** ${lenRange}`);

    if (schema.required && schema.required.length > 0) {
      lines.push(`**Required fields:** ${schema.required.map(r => `\`${r}\``).join(', ')}`);
    }

    return lines;
  }

  /** Format a min/max range string, or return undefined if both are undefined */
  private formatRange(min: number | undefined, max: number | undefined): string | undefined {
    if (min === undefined && max === undefined) return undefined;
    return [
      min !== undefined ? `min: ${min}` : '',
      max !== undefined ? `max: ${max}` : '',
    ].filter(Boolean).join(', ');
  }

  /** Append child properties summary for object-type schemas */
  private appendPropertiesSummary(md: vscode.MarkdownString, schema: ResolvedJsonSchema): void {
    if (schema.type !== 'object' || !schema.properties) return;
    const propNames = Object.keys(schema.properties);
    if (propNames.length > 0 && propNames.length <= 20) {
      md.appendMarkdown(`**Properties:** ${propNames.map(p => `\`${p}\``).join(', ')}\n\n`);
    } else if (propNames.length > 20) {
      md.appendMarkdown(`**Properties:** ${propNames.length} fields\n\n`);
    }
  }
}
