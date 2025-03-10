// src/k8s/toolboxService.ts
import { BaseK8sService } from './baseK8sService';
import { LogLevel, log } from '../../extension.js';
import { executeKubectl } from '../../utils/resourceUtils';
import { cache } from '../../utils/cacheUtils';

export class ToolboxService extends BaseK8sService {
  constructor() {
    super();
  }

  /**
   * Find the toolbox pod name, cached for 60 seconds.
   */
  private async findToolboxPodCached(): Promise<string> {
    return cache.getOrFetch<string>(
      'toolbox',
      'pod-name',
      async () => {
        log(`Looking for eda-toolbox pod in namespace '${this.toolboxNamespace}'...`, LogLevel.INFO);

        // 1) Attempt multiple label selectors
        const labelSelectors = [
          'eda.nokia.com/app=eda-toolbox',
          'app=eda-toolbox',
          'app.kubernetes.io/name=eda-toolbox',
        ];
        for (const selector of labelSelectors) {
          const pods = await this.k8sApi.listNamespacedPod({
            namespace: this.toolboxNamespace,
            labelSelector: selector
          });
          if (pods.items.length > 0) {
            const podName = pods.items[0].metadata!.name!;
            log(`Found toolbox pod: ${podName} using selector: ${selector}`, LogLevel.INFO);
            return podName;
          }
        }

        // 2) If label search fails, try name-based search
        const allPods = await this.k8sApi.listNamespacedPod({ 
          namespace: this.toolboxNamespace 
        });
        for (const pod of allPods.items) {
          const name = pod.metadata!.name!;
          if (name.includes('toolbox') || name.includes('eda-toolbox')) {
            log(`Found toolbox pod by name: ${name}`, LogLevel.INFO);
            return name;
          }
        }

        throw new Error(`No toolbox pod found in namespace ${this.toolboxNamespace}`);
      },
      {
        ttl: 60000, // e.g. 1 minute
        description: 'toolbox pod',
      }
    );
  }

  /**
   * Execute a command in the toolbox pod
   */
  async executeCommandInToolbox(
    command: string,
    ignoreNoResources: boolean = false
  ): Promise<string> {
    try {
      const podName = await this.findToolboxPodCached();
      log(`Executing in toolbox pod '${podName}': ${command}`, LogLevel.DEBUG);

      // Use our new kubectl helper
      try {
        const output = executeKubectl(
          this.kubectlPath,
          ['exec', '-n', this.toolboxNamespace, podName, '--', ...command.split(' ')],
          { encoding: 'utf-8' }
        );
        return output;
      } catch (execError: any) {
        // "no resources found" special handling
        if (
          ignoreNoResources &&
          (execError.stderr?.includes('no resources found') ||
            execError.stdout?.includes('no resources found'))
        ) {
          log(`No resources found for: ${command}`, LogLevel.DEBUG);
          return '';
        }
        log(`Error executing command in toolbox: ${execError}`, LogLevel.ERROR, true);
        if (execError.stdout) {
          return execError.stdout;
        }
        throw execError;
      }
    } catch (error) {
      log(`Failed to execute command in eda-toolbox: ${error}`, LogLevel.ERROR, true);
      return '';
    }
  }

  /**
   * Reset the toolbox cache (pod-name).
   */
  resetToolboxCache() {
    cache.clear('toolbox');
  }
}
