// src/utils/templateLoader.ts
import * as fs from 'fs';
import * as path from 'path';

import type * as vscode from 'vscode';
import * as Handlebars from 'handlebars';

/**
 * Loads a Handlebars template and compiles it with the provided variables.
 *
 * @param templateName Base name of the template file (without extension)
 * @param context VSCode extension context for resolving paths
 * @param variables Variables to pass into the template
 * @returns The rendered template as a string
 */
export function loadTemplate(
  templateName: string,
  context: vscode.ExtensionContext,
  variables: Record<string, unknown>
): string {
  try {
    // Adjust the path to point to src/templates instead of templates/
    const templatePath = context.asAbsolutePath(
      path.join('src', 'templates', `${templateName}.hbs`)
    );
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    const template = Handlebars.compile(templateContent);
    return template(variables);
  } catch (error) {
    console.error(`Error loading template ${templateName}:`, error);
    return `Error loading template ${templateName}: ${error}`;
  }
}
