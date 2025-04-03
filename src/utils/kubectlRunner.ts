// src/utils/kubectlRunner.ts
import { execSync, ExecSyncOptions } from 'child_process';
import { LogLevel, log } from '../extension';

/**
 * Interface for kubectl execution options
 */
export interface KubectlOptions extends ExecSyncOptions {
  namespace?: string;
  jsonOutput?: boolean;
  ignoreErrors?: boolean;
}

/**
 * Execute kubectl command and return the result
 * @param kubectlPath Path to kubectl binary
 * @param args Command arguments
 * @param options Execution options
 * @returns Command output
 */
export function runKubectl(
  kubectlPath: string,
  args: string[],
  options: KubectlOptions = {}
): string {
  try {
    // Add namespace if provided
    const finalArgs = [...args];
    if (options.namespace) {
      finalArgs.unshift('--namespace', options.namespace);
    }

    // Add json output if requested
    if (options.jsonOutput) {
      finalArgs.push('-o', 'json');
    }

    const cmdLine = `${kubectlPath} ${finalArgs.join(' ')}`;
    log(`Running kubectl: ${cmdLine}`, LogLevel.DEBUG);

    const cmdOutput = execSync(cmdLine, {
      encoding: 'utf-8',
      timeout: 30000, // 30 seconds timeout
      ...options
    });

    return typeof cmdOutput === 'string' ? cmdOutput : cmdOutput.toString();
  } catch (error: any) {
    // Handle special case where command returns non-zero but still has output
    if (error.stdout && options.ignoreErrors) {
      return error.stdout;
    }

    log(`Error executing kubectl command: ${error}`, LogLevel.ERROR);
    throw error;
  }
}

/**
 * Execute kubectl command and parse JSON output
 * @param kubectlPath Path to kubectl binary
 * @param args Command arguments
 * @param options Execution options
 * @returns Parsed JSON output
 */
export function runKubectlJson<T>(
  kubectlPath: string,
  args: string[],
  options: KubectlOptions = {}
): T {
  const jsonOutput = runKubectl(kubectlPath, args, {
    ...options,
    jsonOutput: true
  });

  return JSON.parse(jsonOutput) as T;
}

/**
 * Get specific resource YAML
 * @param kubectlPath Path to kubectl binary
 * @param kind Resource kind
 * @param name Resource name
 * @param namespace Resource namespace
 * @returns Resource YAML
 */
export function getResourceYaml(
  kubectlPath: string,
  kind: string,
  name: string,
  namespace: string
): string {
  return runKubectl(
    kubectlPath,
    ['get', kind.toLowerCase(), name, '-o', 'yaml'],
    { namespace }
  );
}

/**
 * Delete resource
 * @param kubectlPath Path to kubectl binary
 * @param kind Resource kind
 * @param name Resource name
 * @param namespace Resource namespace
 * @returns Command output
 */
export function deleteResource(
  kubectlPath: string,
  kind: string,
  name: string,
  namespace: string
): string {
  return runKubectl(
    kubectlPath,
    ['delete', kind.toLowerCase(), name],
    { namespace }
  );
}

/**
 * Execute a command in a pod
 * @param kubectlPath Path to kubectl binary
 * @param podName Pod name
 * @param namespace Pod namespace
 * @param command Command to execute
 * @param options Additional options
 * @returns Command output
 */
export function execInPod(
  kubectlPath: string,
  podName: string,
  namespace: string,
  command: string[],
  options: KubectlOptions = {}
): string {
  return runKubectl(
    kubectlPath,
    ['exec', podName, '--', ...command],
    { namespace, ...options }
  );
}

/**
 * Get pod logs
 * @param kubectlPath Path to kubectl binary
 * @param podName Pod name
 * @param namespace Pod namespace
 * @param container Container name (optional)
 * @param options Additional options
 * @returns Pod logs
 */
export function getPodLogs(
  kubectlPath: string,
  podName: string,
  namespace: string,
  container?: string,
  options: KubectlOptions = {}
): string {
  const args = ['logs', podName];

  if (container) {
    args.push('-c', container);
  }

  return runKubectl(kubectlPath, args, { namespace, ...options });
}