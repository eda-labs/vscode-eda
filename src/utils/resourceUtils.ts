import { KubernetesObject } from '@kubernetes/client-node';
import { log, LogLevel } from '../extension.js';

/**
 * Interface for resource fetch options
 */
export interface ResourceFetchOptions {
  namespace: string;
  cacheKey?: string;
}

/**
 * Generic function to fetch Kubernetes resources
 */
export async function fetchResources<T extends KubernetesObject>(
  // Update the type definition to match the new response format
  fetchFn: () => Promise<{ items: T[] }>,  // Remove 'body' wrapper
  resourceType: string,
  options: ResourceFetchOptions
): Promise<T[]> {
  try {
    const { namespace, cacheKey } = options;

    log(`Fetching ${resourceType} in namespace '${namespace}'${cacheKey ? ` for ${cacheKey}` : ''}...`, LogLevel.DEBUG);
    const startTime = Date.now();

    const response = await fetchFn();
    const items = response.items;  // Direct access - no more response.body

    const elapsedTime = Date.now() - startTime;
    log(`Found ${items.length} ${resourceType} in namespace '${namespace}' (${elapsedTime}ms)`, LogLevel.DEBUG);

    return items;
  } catch (error) {
    log(`Failed to get ${resourceType}: ${error}`, LogLevel.ERROR, true);
    return [];
  }
}

/**
 * Execute kubectl command with error handling
 */
export function executeKubectl(
  kubectlPath: string,
  args: string[],
  options: { encoding: string } = { encoding: 'utf-8' }
): string {
  try {
    const { execSync } = require('child_process');
    return execSync(`${kubectlPath} ${args.join(' ')}`, options);
  } catch (error: any) {
    if (error.stdout?.includes('not found') || error.stderr?.includes('not found')) {
      log(`Resource not found with kubectl command: ${args.join(' ')}`, LogLevel.WARN);
      return '';
    }
    throw error;
  }
}