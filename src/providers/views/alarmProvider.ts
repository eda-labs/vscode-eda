import * as vscode from 'vscode';
import { TreeItemBase } from './treeItem';
import { serviceManager } from '../../services/serviceManager';
import { EdaClient } from '../../clients/edaClient';
import { ResourceStatusService } from '../../services/resourceStatusService';
import { log, LogLevel } from '../../extension';

export class EdaAlarmProvider implements vscode.TreeDataProvider<TreeItemBase> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItemBase | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private edactlClient: EdaClient;
  private statusService: ResourceStatusService;
  private alarms: Map<string, any> = new Map();
  private treeFilter = '';
  private _refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.edactlClient = serviceManager.getClient<EdaClient>('edactl');
    this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');

    void this.edactlClient.streamEdaAlarms(alarms => {
      log(`Alarm stream provided ${alarms.length} alarms`, LogLevel.DEBUG);
      this.alarms = new Map(alarms.map(a => [a.name, a]));
      this.refresh();
    });
  }

  refresh(): void {
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
    }
    this._refreshDebounceTimer = setTimeout(() => {
      this._onDidChangeTreeData.fire(undefined);
      this._refreshDebounceTimer = undefined;
    }, 100);
  }

  setTreeFilter(text: string): void {
    this.treeFilter = text.toLowerCase();
    this.refresh();
  }

  clearTreeFilter(): void {
    this.treeFilter = '';
    this.refresh();
  }

  getTreeItem(element: TreeItemBase): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItemBase): Promise<TreeItemBase[]> {
    if (element) {
      return [];
    }
    let list = Array.from(this.alarms.values());
    if (this.treeFilter) {
      list = list.filter(a => {
        const desc = (a.description || '').toLowerCase();
        return a.name.toLowerCase().includes(this.treeFilter) || desc.includes(this.treeFilter);
      });
    }
    if (list.length === 0) {
      const item = new TreeItemBase('No Alarms Found', vscode.TreeItemCollapsibleState.None, 'message');
      item.iconPath = this.statusService.getThemeStatusIcon('gray');
      return [item];
    }
    return list.map(a => this.createAlarmItem(a));
  }

  private createAlarmItem(alarm: any): TreeItemBase {
    const label = `${(alarm.severity || 'info').toUpperCase()} - ${alarm.type}`;
    const item = new TreeItemBase(label, vscode.TreeItemCollapsibleState.None, 'eda-alarm', { metadata: { name: alarm.name } });
    const ns =
      alarm['.namespace.name'] ||
      alarm['namespace.name'] ||
      alarm.namespace ||
      'unknown';
    item.description = `ns: ${ns}`;
    item.tooltip = [
      `Name: ${alarm.name}`,
      `Description: ${alarm.description || 'No description'}`,
      `Resource: ${alarm.resource || 'Unknown'}`,
      `Severity: ${alarm.severity}`
    ].join('\n');
    item.iconPath = this.statusService.getAlarmThemeIcon(alarm.severity || 'INFO');
    item.command = {
      command: 'vscode-eda.showAlarmDetails',
      title: 'Show Alarm Details',
      arguments: [alarm]
    };
    return item;
  }
}
