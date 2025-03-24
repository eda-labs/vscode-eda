// src/commands/engineConfigCommands.ts
import * as vscode from 'vscode';
import { runKubectl } from '../utils/kubectlRunner';
import { log, LogLevel, edaOutputChannel } from '../extension';

// The YAML content for the patch
const patchYaml = `
spec:
  kubernetes:
    exports:
      - gvk:
          group: protocols.eda.nokia.com
          kind: DefaultBGPGroup
          version: v1alpha1
        policy: all
      - gvk:
          group: protocols.eda.nokia.com
          kind: DefaultBGPGroupDeployment
          version: v1alpha1
        policy: all
      - gvk:
          group: protocols.eda.nokia.com
          kind: BGPGroup
          version: v1alpha1
        policy: all
      - gvk:
          group: protocols.eda.nokia.com
          kind: BGPGroupDeployment
          version: v1alpha1
        policy: all
      - gvk:
          group: protocols.eda.nokia.com
          kind: DefaultRouteReflector
          version: v1alpha1
        policy: all
      - gvk:
          group: protocols.eda.nokia.com
          kind: DefaultRouteReflectorClient
          version: v1alpha1
        policy: all
      - gvk:
          group: protocols.eda.nokia.com
          kind: RouteReflector
          version: v1alpha1
        policy: all
      - gvk:
          group: protocols.eda.nokia.com
          kind: RouteReflectorState
          version: v1alpha1
        policy: all
      - gvk:
          group: protocols.eda.nokia.com
          kind: RouteReflectorClientState
          version: v1alpha1
        policy: all
      - gvk:
          group: protocols.eda.nokia.com
          kind: RouteReflectorClient
          version: v1alpha1
        policy: all
      - gvk:
          group: protocols.eda.nokia.com
          kind: DefaultBGPPeer
          version: v1alpha1
        policy: all
      - gvk:
          group: protocols.eda.nokia.com
          kind: BGPPeer
          version: v1alpha1
        policy: all
      - gvk:
          group: protocols.eda.nokia.com
          kind: BGPPeerState
          version: v1alpha1
        policy: all
      - gvk:
          group: fabrics.eda.nokia.com
          kind: ISL
          version: v1alpha1
        policy: all
      - gvk:
          group: fabrics.eda.nokia.com
          kind: ISLState
          version: v1alpha1
        policy: all
      - gvk:
          group: routing.eda.nokia.com
          kind: DefaultInterface
          version: v1alpha1
        policy: all
      - gvk:
          group: routing.eda.nokia.com
          kind: DefaultInterfaceState
          version: v1alpha1
        policy: all
      - gvk:
          group: routingpolicies.eda.nokia.com
          kind: Policy
          version: v1alpha1
        policy: all
      - gvk:
          group: routingpolicies.eda.nokia.com
          kind: PolicyDeployment
          version: v1alpha1
        policy: all
      - gvk:
          group: routingpolicies.eda.nokia.com
          kind: PrefixSet
          version: v1alpha1
        policy: all
      - gvk:
          group: routingpolicies.eda.nokia.com
          kind: PrefixSetDeployment
          version: v1alpha1
        policy: all
      - gvk:
          group: services.eda.nokia.com
          kind: IRBInterface
          version: v1alpha1
        policy: all
      - gvk:
          group: services.eda.nokia.com
          kind: RoutedInterface
          version: v1alpha1
        policy: all
      - gvk:
          group: services.eda.nokia.com
          kind: BridgeDomain
          version: v1alpha1
        policy: all
      - gvk:
          group: services.eda.nokia.com
          kind: BridgeDomainDeployment
          version: v1alpha1
        policy: all
      - gvk:
          group: services.eda.nokia.com
          kind: BridgedInterface
          version: v1alpha1
        policy: all
      - gvk:
          group: services.eda.nokia.com
          kind: Router
          version: v1alpha1
        policy: all
      - gvk:
          group: services.eda.nokia.com
          kind: RouterDeployment
          version: v1alpha1
        policy: all
      - gvk:
          group: services.eda.nokia.com
          kind: VLAN
          version: v1alpha1
        policy: all
`;

// Empty patch for undoing
const emptyPatchYaml = `
spec:
  kubernetes:
    exports: []
`;

/**
 * Restart the eda-ce deployment
 */
async function restartEdaCE(): Promise<void> {
  try {
    log(`Restarting eda-ce deployment in namespace eda-system...`, LogLevel.INFO, true);

    const result = runKubectl('kubectl', ['rollout', 'restart', 'deployment', 'eda-ce'], {
      namespace: 'eda-system'
    });

    log(`Restart result: ${result}`, LogLevel.INFO, true);
    vscode.window.showInformationMessage(`Successfully restarted eda-ce deployment.`);
  } catch (error) {
    const errMsg = `Failed to restart eda-ce deployment: ${error}`;
    log(errMsg, LogLevel.ERROR, true);
    vscode.window.showErrorMessage(errMsg);
    throw error;
  }
}

/**
 * Register commands for patching and unpatching engine config
 */
export function registerEngineConfigCommands(context: vscode.ExtensionContext) {
  // Command to patch engine config
  const patchEngineConfigCmd = vscode.commands.registerCommand('vscode-eda.patchEngineConfig', async () => {
    try {
      log(`Patching engine-config in namespace eda-system...`, LogLevel.INFO, true);

      // Create a temporary file for the patch to avoid escape issues
      const fs = require('fs');
      const os = require('os');
      const path = require('path');

      const tempFile = path.join(os.tmpdir(), `eda-patch-${Date.now()}.yaml`);
      fs.writeFileSync(tempFile, patchYaml, 'utf8');

      log(`Created temporary patch file: ${tempFile}`, LogLevel.DEBUG);

      // Execute the patch command using the temporary file
      const result = runKubectl('kubectl', [
        'patch',
        'engineconfig',
        'engine-config',
        '--type',
        'merge',
        '--patch-file',
        tempFile
      ], {
        namespace: 'eda-system'
      });

      // Clean up temporary file
      fs.unlinkSync(tempFile);

      log(`Patch result: ${result}`, LogLevel.INFO, true);
      vscode.window.showInformationMessage(`Successfully patched engine-config to enable ETCD dumps.`);

      // Restart eda-ce deployment
      await restartEdaCE();

      edaOutputChannel.show();
    } catch (error) {
      const errMsg = `Failed to patch engine-config: ${error}`;
      log(errMsg, LogLevel.ERROR, true);
      vscode.window.showErrorMessage(errMsg);
      edaOutputChannel.show();
    }
  });

  // Command to undo patch engine config
  const undoPatchEngineConfigCmd = vscode.commands.registerCommand('vscode-eda.undoPatchEngineConfig', async () => {
    try {
      log(`Unpatching engine-config in namespace eda-system...`, LogLevel.INFO, true);

      // Create a temporary file for the patch to avoid escape issues
      const fs = require('fs');
      const os = require('os');
      const path = require('path');

      const tempFile = path.join(os.tmpdir(), `eda-unpatch-${Date.now()}.yaml`);
      fs.writeFileSync(tempFile, emptyPatchYaml, 'utf8');

      log(`Created temporary unpatch file: ${tempFile}`, LogLevel.DEBUG);

      // Execute the patch command with empty exports using the temporary file
      const result = runKubectl('kubectl', [
        'patch',
        'engineconfig',
        'engine-config',
        '--type',
        'merge',
        '--patch-file',
        tempFile
      ], {
        namespace: 'eda-system'
      });

      // Clean up temporary file
      fs.unlinkSync(tempFile);

      log(`Unpatch result: ${result}`, LogLevel.INFO, true);
      vscode.window.showInformationMessage(`Successfully unpatched engine-config.`);

      // Restart eda-ce deployment
      await restartEdaCE();

      edaOutputChannel.show();
    } catch (error) {
      const errMsg = `Failed to unpatch engine-config: ${error}`;
      log(errMsg, LogLevel.ERROR, true);
      vscode.window.showErrorMessage(errMsg);
      edaOutputChannel.show();
    }
  });

  context.subscriptions.push(patchEngineConfigCmd, undoPatchEngineConfigCmd);
}