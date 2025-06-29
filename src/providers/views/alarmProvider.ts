import * as vscode from 'vscode';
import { TreeItemBase } from './treeItem';
import { FilteredTreeProvider } from './filteredTreeProvider';
import { serviceManager } from '../../services/serviceManager';
import { EdaClient } from '../../clients/edaClient';
import { ResourceStatusService } from '../../services/resourceStatusService';

export class EdaAlarmProvider extends FilteredTreeProvider<TreeItemBase> {
  private edaClient: EdaClient;
  private statusService: ResourceStatusService;
  private alarms: Map<string, any> = new Map();

  constructor() {
    super();
    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');

    void this.edaClient.streamEdaAlarms();
    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === 'current-alarms') {
        this.processAlarmMessage(msg);
      }
    });
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
        const desc = a.description || '';
        return this.matchesFilter(a.name) || this.matchesFilter(desc);
      });
    }
    if (list.length === 0) {
      const item = new TreeItemBase('No Alarms Found', vscode.TreeItemCollapsibleState.None, 'message');
      item.iconPath = this.statusService.getThemeStatusIcon('gray');
      return [item];
    }
    list.sort((a, b) => {
      const aTime = a.lastChanged ? new Date(a.lastChanged).getTime() : 0;
      const bTime = b.lastChanged ? new Date(b.lastChanged).getTime() : 0;
      return bTime - aTime;
    });
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

  /** Process alarm stream updates */
  private processAlarmMessage(msg: any): void {
    const ops: any[] = Array.isArray(msg.msg?.op) ? msg.msg.op : [];
    if (ops.length === 0) {
      return;
    }
    let changed = false;
    for (const op of ops) {
      if (op.delete && Array.isArray(op.delete.ids)) {
        for (const id of op.delete.ids) {
          if (this.alarms.delete(String(id))) {
            changed = true;
          }
        }
      } else if (op.insert_or_modify && Array.isArray(op.insert_or_modify.rows)) {
        for (const row of op.insert_or_modify.rows) {
          if (row && row.id !== undefined) {
            const data = row.data || row;
            this.alarms.set(String(row.id), data);
            changed = true;
          }
        }
      }
    }
    if (changed) {
      this.refresh();
    }
  }
}
