import * as vscode from 'vscode';

import { serviceManager } from '../../services/serviceManager';
import type { EdaClient } from '../../clients/edaClient';
import type { ResourceStatusService } from '../../services/resourceStatusService';
import {
  getOps,
  getDelete,
  getDeleteIds,
  getInsertOrModify,
  getRows,
  type OperationWithInsertOrModify,
  type OperationWithDelete,
  type InsertOrModifyWithRows,
  type DeleteOperationWithIds
} from '../../utils/streamMessageUtils';

import { FilteredTreeProvider } from './filteredTreeProvider';
import { TreeItemBase } from './treeItem';

/** Represents an EDA alarm from the stream API */
export interface EdaAlarm {
  name: string;
  type?: string;
  severity?: string;
  description?: string;
  resource?: string;
  namespace?: string;
  '.namespace.name'?: string;
  'namespace.name'?: string;
  lastChanged?: string;
  [key: string]: unknown;
}

/** Row structure containing alarm data */
interface AlarmRow {
  id?: string | number;
  data?: EdaAlarm;
}

export class EdaAlarmProvider extends FilteredTreeProvider<TreeItemBase> {
  private edaClient: EdaClient;
  private statusService: ResourceStatusService;
  private alarms: Map<string, EdaAlarm> = new Map();
  private _onAlarmCountChanged = new vscode.EventEmitter<number>();
  readonly onAlarmCountChanged = this._onAlarmCountChanged.event;

  public get count(): number {
    return this.alarms.size;
  }

  constructor() {
    super();
    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');
    this.setupStreamListener();

    // Emit initial count
    this._onAlarmCountChanged.fire(this.count);
  }

  /**
   * Initialize the alarm stream. Call this after construction.
   */
  public async initialize(): Promise<void> {
    await this.edaClient.streamEdaAlarms();
  }

  public async reconnect(): Promise<void> {
    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');
    this.alarms.clear();
    this.setupStreamListener();
    this.refresh();
    this._onAlarmCountChanged.fire(this.count);
    await this.initialize();
  }

  private setupStreamListener(): void {
    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === 'current-alarms') {
        this.processAlarmMessage(msg);
      }
    });
  }


  getTreeItem(element: TreeItemBase): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItemBase): TreeItemBase[] {
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

  private createAlarmItem(alarm: EdaAlarm): TreeItemBase {
    const label = `${(alarm.severity || 'info').toUpperCase()} - ${alarm.type ?? 'unknown'}`;
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
      `Severity: ${alarm.severity ?? 'unknown'}`
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
  private processAlarmMessage(msg: unknown): void {
    const envelope = msg as { msg?: unknown };
    const ops = getOps(envelope.msg as { op?: unknown[]; Op?: unknown[] });
    if (ops.length === 0) {
      return;
    }
    let changed = false;
    for (const op of ops) {
      const typedOp = op as OperationWithDelete & OperationWithInsertOrModify;
      const deleteOp = getDelete(typedOp) as DeleteOperationWithIds | undefined;
      const deleteIds = getDeleteIds(deleteOp) as (string | number)[];
      for (const id of deleteIds) {
        if (this.alarms.delete(String(id))) {
          changed = true;
        }
      }

      const insertOrModify = getInsertOrModify(typedOp) as InsertOrModifyWithRows | undefined;
      const rows = getRows(insertOrModify) as AlarmRow[];
      for (const row of rows) {
        if (row && row.id !== undefined) {
          const data: EdaAlarm = row.data ?? (row as unknown as EdaAlarm);
          this.alarms.set(String(row.id), data);
          changed = true;
        }
      }
    }
    if (changed) {
      this.refresh();
      this._onAlarmCountChanged.fire(this.count);
    }
  }
}
