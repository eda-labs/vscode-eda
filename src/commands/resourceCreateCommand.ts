// src/commands/resourceCreateCommand.ts
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { serviceManager } from '../services/serviceManager';
import { KubernetesClient } from '../clients/kubernetesClient';
import { EdactlClient } from '../clients/edactlClient';
import { SchemaProviderService } from '../services/schemaProviderService';
import { ResourceEditDocumentProvider } from '../providers/documents/resourceEditProvider';
import { log, LogLevel } from '../extension';


/**
 * Generate a mapping of property paths to a comment for optional fields.
 */
function generateOptionalComments(schema: any, prefix: string = ''): Record<string, string> {
  if (!schema || typeof schema !== 'object') {
    return {};
  }

  const result: Record<string, string> = {};

  if (schema.type === 'object' && schema.properties) {
    // Get the required fields for this object (if any)
    const requiredFields: string[] = schema.required || [];

    for (const [key, prop] of Object.entries<any>(schema.properties)) {
      const path = prefix ? `${prefix}.${key}` : key;

      // If the field is not listed in required, mark it as optional.
      if (!requiredFields.includes(key)) {
        result[path] = 'optional';
      }

      // Recursively process nested objects.
      if (prop.type === 'object') {
        Object.assign(result, generateOptionalComments(prop, path));
      }

      // If the property is an array with object items, process the item schema.
      if (prop.type === 'array' && prop.items && prop.items.type === 'object') {
        Object.assign(result, generateOptionalComments(prop.items, `${path}[]`));
      }
    }
  }

  return result;
}

/**
 * Generate a comprehensive spec object based on a JSON schema,
 * including both required and optional fields
 */
function generateDetailedSpecFromSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return {};
  }

  const result: any = {};

  // If it's an object schema with properties
  if (schema.type === 'object' && schema.properties) {
    for (const [key, prop] of Object.entries<any>(schema.properties)) {
      // Include both required and optional fields
      // Generate value based on type
      if (prop.type === 'object') {
        result[key] = generateDetailedSpecFromSchema(prop);
      }
      else if (prop.type === 'array') {
        // For arrays, if we have items schema defined, include an example item
        if (prop.items) {
          // Add an example item based on the array item schema
          const exampleItem = generateArrayExampleItem(prop.items);
          if (Object.keys(exampleItem).length > 0) {
            result[key] = [exampleItem];
          } else {
            result[key] = [];
          }
        } else {
          result[key] = [];
        }
      }
      else if (prop.type === 'string') {
        if (prop.enum && prop.enum.length > 0) {
          // For enum strings, use the first enum value
          result[key] = prop.enum[0];
        } else if (prop.default !== undefined) {
          result[key] = prop.default;
        } else if (prop.example !== undefined) {
          result[key] = prop.example;
        } else {
          result[key] = '';
        }
      }
      else if (prop.type === 'number' || prop.type === 'integer') {
        result[key] = prop.default !== undefined ? prop.default :
                     (prop.example !== undefined ? prop.example : 0);
      }
      else if (prop.type === 'boolean') {
        result[key] = prop.default !== undefined ? prop.default : false;
      }
      else {
        // For any other type, add an empty value
        result[key] = null;
      }
    }
  }

  return result;
}

/**
 * Generate an example item for an array based on its schema
 */
function generateArrayExampleItem(itemSchema: any): any {
  if (!itemSchema || typeof itemSchema !== 'object') {
    return {};
  }

  if (itemSchema.type === 'string') {
    return itemSchema.enum ? itemSchema.enum[0] : (itemSchema.example || '');
  }

  if (itemSchema.type === 'number' || itemSchema.type === 'integer') {
    return itemSchema.example || 0;
  }

  if (itemSchema.type === 'boolean') {
    return itemSchema.example !== undefined ? itemSchema.example : false;
  }

  if (itemSchema.type === 'object') {
    const result: any = {};

    if (itemSchema.properties) {
      for (const [key, prop] of Object.entries<any>(itemSchema.properties)) {
        // Include all properties for the example
        if (prop.type === 'string') {
          if (prop.enum && prop.enum.length > 0) {
            result[key] = prop.enum[0]; // Use first enum value
          } else {
            result[key] = prop.example || '';
          }
        } else if (prop.type === 'object') {
          result[key] = generateArrayExampleItem(prop);
        } else if (prop.type === 'array') {
          result[key] = [];
        } else if (prop.type === 'number' || prop.type === 'integer') {
          result[key] = prop.example || 0;
        } else if (prop.type === 'boolean') {
          result[key] = prop.example !== undefined ? prop.example : false;
        }
      }
    }

    return result;
  }

  return {};
}

/**
 * Generate a mapping of property paths to their enum options
 * for adding comments to the YAML output
 */
function generateEnumComments(schema: any, prefix: string = ''): Record<string, string[]> {
  if (!schema || typeof schema !== 'object') {
    return {};
  }

  const result: Record<string, string[]> = {};

  if (schema.type === 'object' && schema.properties) {
    for (const [key, prop] of Object.entries<any>(schema.properties)) {
      const path = prefix ? `${prefix}.${key}` : key;

      // If this property has enum values, add them to the result
      if (prop.enum && Array.isArray(prop.enum) && prop.enum.length > 0) {
        result[key] = prop.enum;
      }

      // Recursively process nested objects
      if (prop.type === 'object') {
        const nestedResults = generateEnumComments(prop, path);
        Object.assign(result, nestedResults);
      }

      // Handle arrays with object items
      if (prop.type === 'array' && prop.items && prop.items.type === 'object') {
        const nestedResults = generateEnumComments(prop.items, `${path}[]`);
        Object.assign(result, nestedResults);
      }

      // Special case for arrays with items that have enum values
      if (prop.type === 'array' && prop.items && prop.items.properties) {
        for (const [itemKey, itemProp] of Object.entries<any>(prop.items.properties)) {
          if (itemProp.enum && Array.isArray(itemProp.enum) && itemProp.enum.length > 0) {
            result[`${key}[].${itemKey}`] = itemProp.enum;
          }
        }
      }
    }
  }

  return result;
}

/**
 * Register the command to create a new Kubernetes resource from a CRD definition
 */
/**
 * Register the command to create a new Kubernetes resource from a CRD definition
 * @param context The extension context
 * @param resourceEditProvider The provider for editing resources
 */
export function registerResourceCreateCommand(
  context: vscode.ExtensionContext,
  resourceEditProvider: ResourceEditDocumentProvider
): void {
  const createResourceCommand = vscode.commands.registerCommand(
    'vscode-eda.createResource',
    async () => {
      try {
        log('Creating new resource from CRD...', LogLevel.INFO, true);

        // Get required services
        const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
        const schemaProvider = serviceManager.getService<SchemaProviderService>('schema-provider');

        // 1. Get all available CRDs
        const crds = k8sClient.getCachedCrds();
        if (!crds || crds.length === 0) {
          vscode.window.showErrorMessage('No Custom Resource Definitions found in the cluster');
          return;
        }

        // 2. Create quick pick items with proper grouping and formatting
        const crdItems = crds
          .filter(crd => crd.spec?.names?.kind)
          .map(crd => {
            const group = crd.spec?.group || '';
            const kind = crd.spec?.names?.kind || '';
            const version = crd.spec?.versions?.find((v: any) =>
              v.storage === true || v.served === true)?.name || '';

            // Extract a meaningful description from the CRD
            let detailInfo = '';

            // Try to get schema from the active version
            const activeVersion = crd.spec?.versions?.find((v: any) =>
              v.storage === true || v.served === true);
            const schema = activeVersion?.schema?.openAPIV3Schema ||
                          (crd.spec as any)?.validation?.openAPIV3Schema;

            // First check if spec property has a detailed description - this is often the most informative
            if (schema?.properties?.spec?.description) {
              const specDesc = schema.properties.spec.description;
              // If the description is very long, extract just the first sentence or truncate it
              const firstSentence = specDesc.split(/\.(?:\s|$)/)[0]; // Get first sentence
              detailInfo = firstSentence.length > 100 ?
                          `${firstSentence.substring(0, 97)}...` :
                          `${firstSentence}.`;
            }
            // Then try the schema top-level description
            else if (schema?.description) {
              const desc = schema.description;
              detailInfo = desc.length > 100 ? `${desc.substring(0, 97)}...` : desc;
            }
            // Look for annotations
            else if (crd.metadata?.annotations?.['description']) {
              detailInfo = crd.metadata.annotations['description'];
            }
            // Last resort: show the resource scope and some additional info
            else {
              const scope = crd.spec?.scope || 'Namespaced';
              const shortNames = crd.spec?.names?.shortNames?.join(', ') || '';
              detailInfo = `${scope} resource${shortNames ? `, Aliases: ${shortNames}` : ''}`;
            }

            return {
              label: kind,
              description: `${group}/${version}`,
              detail: detailInfo,
              group: group.split('.')[0], // Group by first part of the API group
              crd
            };
          });

        // 3. Show quick pick with nice grouping by API group
        const selected = await vscode.window.showQuickPick(crdItems, {
          placeHolder: 'Select a Custom Resource Definition',
          matchOnDescription: true,
          matchOnDetail: true
        });

        if (!selected) {
          return; // User cancelled
        }

        // 4. Get an EDA namespace to create the resource in
        const edactlClient = serviceManager.getClient<EdactlClient>('edactl');
        const edaNamespaces = await edactlClient.getEdaNamespaces();

        if (!edaNamespaces || edaNamespaces.length === 0) {
          vscode.window.showErrorMessage('No EDA namespaces found in the cluster');
          return;
        }

        const namespace = await vscode.window.showQuickPick(edaNamespaces, {
          placeHolder: 'Select an EDA namespace for the new resource',
        });

        if (!namespace) {
          return; // User cancelled
        }

        // 5. Ask for a name for the new resource
        const name = await vscode.window.showInputBox({
          placeHolder: 'Enter a name for the new resource',
          validateInput: text => {
            if (!text) {
              return 'Name is required';
            }
            if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(text)) {
              return 'Name must consist of lowercase alphanumeric characters or "-", and must start and end with an alphanumeric character';
            }
            return null;
          }
        });

        if (!name) {
          return; // User cancelled
        }

        // 6. Generate a skeleton resource based on the schema
        const kind = selected.label;
        const apiGroup = selected.crd.spec?.group;
        const version = selected.crd.spec?.versions?.find((v: any) => v.storage === true || v.served === true)?.name || 'v1';
        const apiVersion = `${apiGroup}/${version}`;

        // Create a resource skeleton
        let skeleton = {
          apiVersion,
          kind,
          metadata: {
            name,
            namespace
          },
          spec: {}
        };

        // Try to get the schema for this CRD kind
        let schema = null;
        try {
          // The schema might be directly in the CRD or we might need to extract it
          const activeVersion = selected.crd.spec?.versions?.find((v: any) =>
            v.storage === true || v.served === true);

          if (activeVersion?.schema?.openAPIV3Schema) {
            schema = activeVersion.schema.openAPIV3Schema;
          } else if ((selected.crd.spec as any)?.validation?.openAPIV3Schema) {
            schema = (selected.crd.spec as any).validation.openAPIV3Schema;
          }
        } catch (error) {
          log(`Error getting schema for ${kind}: ${error}`, LogLevel.WARN);
          // Continue without schema, we'll create a minimal skeleton
        }

        // Generate a comprehensive skeleton with all fields from the schema
        if (schema && schema.properties?.spec) {
          skeleton.spec = generateDetailedSpecFromSchema(schema.properties.spec);
        }

        // Convert to YAML
        let yamlContent = yaml.dump(skeleton, { indent: 2 });

        // Enhance YAML with comments for enum values
        if (schema && schema.properties?.spec) {
          const enumComments = generateEnumComments(schema.properties.spec);
          for (const [path, options] of Object.entries(enumComments)) {
            // Find the line containing the path
            const lines = yamlContent.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].trim().startsWith(path + ':')) {
                // Add comment about available options
                lines[i] = lines[i] + '  # Options: ' + options.join(', ');
                break;
              }
            }
            yamlContent = lines.join('\n');
          }
        }

        // Add optional field comments
        if (schema && schema.properties?.spec) {
          const optionalComments = generateOptionalComments(schema.properties.spec);
          for (const [path, comment] of Object.entries(optionalComments)) {
            // Split YAML content into lines.
            const lines = yamlContent.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].trim().startsWith(path + ':')) {
                // Append the optional comment.
                lines[i] = lines[i] + '  # ' + comment;
                break;
              }
            }
            yamlContent = lines.join('\n');
          }
        }

        log(`Created skeleton for ${kind}/${name} in namespace ${namespace}`, LogLevel.INFO);

        // 7. Create a URI for this resource using ResourceEditDocumentProvider's format
        const uri = ResourceEditDocumentProvider.createUri(namespace, kind, name);

        // 8. Store the skeleton resource in the edit provider
        resourceEditProvider.setOriginalResource(uri, skeleton);
        resourceEditProvider.setResourceContent(uri, yamlContent);

        // 9. Open the document and set language
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.languages.setTextDocumentLanguage(document, 'yaml');
        await vscode.window.showTextDocument(document);

        // 10. Apply schema to the document if the schema provider has it
        if (schemaProvider) {
          try {
            await schemaProvider.associateSchemaWithDocument(document, kind);
          } catch (error) {
            log(`Error associating schema: ${error}`, LogLevel.WARN);
            // Continue without schema association
          }
        }

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create resource: ${error}`);
        log(`Error in createResource: ${error}`, LogLevel.ERROR, true);
      }
    }
  );

  context.subscriptions.push(createResourceCommand);
}