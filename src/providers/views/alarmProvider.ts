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
  private alarmIdToKey: Map<string, string> = new Map();
  private alarmKeyRefCount: Map<string, number> = new Map();
  private refreshHandle: ReturnType<typeof setTimeout> | undefined;
  private pendingCountRefresh = false;
  private refreshIntervalMs = 120;
  private _onAlarmCountChanged = new vscode.EventEmitter<number>();
  readonly onAlarmCountChanged = this._onAlarmCountChanged.event;

  public get count(): number {
    return this.alarms.size;
  }

  constructor() {
    super();
    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');
    const configuredInterval = Number(process.env.EDA_ALARM_TREE_REFRESH_MS);
    if (!Number.isNaN(configuredInterval) && configuredInterval >= 0) {
      this.refreshIntervalMs = configuredInterval;
    }

    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === 'current-alarms') {
        this.processAlarmMessage(msg);
      }
    });

    // Emit initial count
    this._onAlarmCountChanged.fire(this.count);
  }

  /**
   * Initialize the alarm stream. Call this after construction.
   */
  public async initialize(): Promise<void> {
    this.edaClient.streamEdaAlarms().catch(() => {
      // startup path is best-effort; stream errors are surfaced via stream logs/events
    });
  }

  public dispose(): void {
    if (this.refreshHandle) {
      clearTimeout(this.refreshHandle);
      this.refreshHandle = undefined;
    }
    this.pendingCountRefresh = false;
    this.edaClient.closeAlarmStream();
    this._onAlarmCountChanged.dispose();
  }


  private scheduleRefresh(countChanged: boolean): void {
    if (countChanged) {
      this.pendingCountRefresh = true;
    }
    if (this.refreshHandle) {
      return;
    }
    this.refreshHandle = setTimeout(() => {
      this.refreshHandle = undefined;
      this.refresh();
      if (this.pendingCountRefresh) {
        this.pendingCountRefresh = false;
        this._onAlarmCountChanged.fire(this.count);
      }
    }, this.refreshIntervalMs);
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
    const severity = alarm.severity || 'INFO';
    const label = `${severity.toUpperCase()} - ${alarm.type ?? 'unknown'}`;
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
    item.iconPath = this.statusService.getAlarmThemeIcon(severity);
    item.status = {
      indicator: this.statusService.getAlarmStatusIndicator(severity),
      description: severity.toUpperCase()
    };
    item.command = {
      command: 'vscode-eda.showAlarmDetails',
      title: 'Show Alarm Details',
      arguments: [alarm]
    };
    return item;
  }

  private getAlarmNamespace(alarm: EdaAlarm): string {
    return (
      alarm['.namespace.name'] ||
      alarm['namespace.name'] ||
      alarm.namespace ||
      ''
    );
  }

  private getAlarmKey(alarm: EdaAlarm, fallbackId: string): string {
    const name = alarm.name || '';
    if (!name) {
      return `id:${fallbackId}`;
    }
    const ns = this.getAlarmNamespace(alarm);
    const type = alarm.type || '';
    const resource = alarm.resource || '';
    return `${ns}|${name}|${type}|${resource}`;
  }

  private incrementAlarmRef(key: string): void {
    const count = this.alarmKeyRefCount.get(key) ?? 0;
    this.alarmKeyRefCount.set(key, count + 1);
  }

  private decrementAlarmRef(key: string): boolean {
    const count = this.alarmKeyRefCount.get(key) ?? 0;
    if (count <= 1) {
      this.alarmKeyRefCount.delete(key);
      return true;
    }
    this.alarmKeyRefCount.set(key, count - 1);
    return false;
  }

  private removeAlarmByRowId(rowId: string): boolean {
    const key = this.alarmIdToKey.get(rowId);
    if (!key) {
      return false;
    }
    this.alarmIdToKey.delete(rowId);
    const shouldDelete = this.decrementAlarmRef(key);
    if (!shouldDelete) {
      return false;
    }
    return this.alarms.delete(key);
  }

  private hasAlarmChanged(existing: EdaAlarm | undefined, incoming: EdaAlarm): boolean {
    if (!existing) {
      return true;
    }
    if (existing === incoming) {
      return false;
    }

    const trackedFields: Array<keyof EdaAlarm> = [
      'name',
      'type',
      'severity',
      'description',
      'resource',
      'namespace',
      '.namespace.name',
      'namespace.name',
      'lastChanged',
      'kind',
      'group',
      'sourceGroup',
      'sourceKind',
      'sourceResource',
      'jspath',
      'parentAlarm',
      'probableCause',
      'remedialAction',
      'clusterSpecific'
    ];

    for (const field of trackedFields) {
      if (existing[field] !== incoming[field]) {
        return true;
      }
    }

    return false;
  }

  private upsertAlarm(rowId: string, data: EdaAlarm): boolean {
    let changed = false;
    const newKey = this.getAlarmKey(data, rowId);
    const existingKey = this.alarmIdToKey.get(rowId);

    if (existingKey && existingKey !== newKey) {
      const shouldDeleteOld = this.decrementAlarmRef(existingKey);
      if (shouldDeleteOld && this.alarms.delete(existingKey)) {
        changed = true;
      }
    }

    if (!existingKey || existingKey !== newKey) {
      this.alarmIdToKey.set(rowId, newKey);
      this.incrementAlarmRef(newKey);
    }

    const existing = this.alarms.get(newKey);
    if (this.hasAlarmChanged(existing, data)) {
      this.alarms.set(newKey, data);
      changed = true;
    }
    return changed;
  }

  private processAlarmDeletes(op: OperationWithDelete & OperationWithInsertOrModify): boolean {
    let changed = false;
    const deleteOp = getDelete(op) as DeleteOperationWithIds | undefined;
    const deleteIds = getDeleteIds(deleteOp) as (string | number)[];
    for (const id of deleteIds) {
      if (this.removeAlarmByRowId(String(id))) {
        changed = true;
      }
    }
    return changed;
  }

  private processAlarmUpserts(op: OperationWithDelete & OperationWithInsertOrModify): boolean {
    let changed = false;
    const insertOrModify = getInsertOrModify(op) as InsertOrModifyWithRows | undefined;
    const rows = getRows(insertOrModify) as AlarmRow[];
    for (const row of rows) {
      if (!row || row.id === undefined) {
        continue;
      }
      const rowId = String(row.id);
      const data: EdaAlarm = row.data ?? (row as unknown as EdaAlarm);
      if (this.upsertAlarm(rowId, data)) {
        changed = true;
      }
    }
    return changed;
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
      changed = this.processAlarmDeletes(typedOp) || changed;
      changed = this.processAlarmUpserts(typedOp) || changed;
    }
    if (changed) {
      this.scheduleRefresh(true);
    }
  }
}
