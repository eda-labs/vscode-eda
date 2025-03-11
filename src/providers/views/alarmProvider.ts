import * as vscode from 'vscode';
import { EdaAlarm} from '../../services/types';
import { serviceManager } from '../../services/serviceManager';
import { EdaService } from '../../services/edaService';
import { StatusService } from '../../services/statusService';
import { log, LogLevel, globalTreeFilter } from '../../extension.js';
import { TreeItemBase } from './common/treeItem';
import { resourceStatusService } from '../../extension.js';

/**
 * EdaAlarmProvider displays the list of active alarms from "edactl query .namespace.alarms.current-alarm".
 */
export class EdaAlarmProvider implements vscode.TreeDataProvider<AlarmTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AlarmTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private k8sService: EdaService;

  constructor(
    private context: vscode.ExtensionContext
  ) {
    this.k8sService = serviceManager.getService<EdaService>('eda');
  }

  /**
   * Refresh method, to be called from our extension-level refresh
   */
  refresh(): void {
    log('EdaAlarmProvider: Refresh called', LogLevel.DEBUG);
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AlarmTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AlarmTreeItem): Promise<AlarmTreeItem[]> {
    // This provider is simple: if there's no element, we show the top-level alarms
    if (element) {
      // We don't do nested children for alarms; each alarm is a leaf
      return [];
    }

    // If there's a global filter, do BFS-like filtering. Otherwise, just list all.
    if (!globalTreeFilter) {
      return this.getAllAlarmItems();
    } else {
      return this.getFilteredAlarmItems(globalTreeFilter);
    }
  }

  /**
   * Load all alarms (no filter).
   */
  private async getAllAlarmItems(): Promise<AlarmTreeItem[]> {
    const alarms = await this.k8sService.getEdaAlarms();
    if (!alarms.length) {
      return [this.noAlarmsItem()];
    }

    return alarms.map((a: EdaAlarm) => this.createAlarmItem(a));
  }

  private async getFilteredAlarmItems(filter: string): Promise<AlarmTreeItem[]> {
    const lowerFilter = filter.toLowerCase();
    const all = await this.k8sService.getEdaAlarms();
    const matches = all.filter((a: EdaAlarm) =>
      a.name.toLowerCase().includes(lowerFilter) ||
      a["namespace.name"]?.toLowerCase().includes(lowerFilter) ||
      a.severity.toLowerCase().includes(lowerFilter) ||
      a.type.toLowerCase().includes(lowerFilter)
    );

    if (!matches.length) {
      return [this.noAlarmsItem(`(no matches for "${filter}")`)];
    }

    return matches.map((a: EdaAlarm) => this.createAlarmItem(a));
  }

  /**
   * Create a single Alarm tree item from EdaAlarm object
   */
  private createAlarmItem(alarm: EdaAlarm): AlarmTreeItem {
    const label = `${alarm.severity.toUpperCase()} - ${alarm.type}`;
    const item = new AlarmTreeItem(label, vscode.TreeItemCollapsibleState.None, 'eda-alarm', alarm);
    item.description = `ns: ${alarm["namespace.name"]}`;
    item.tooltip = [
      `Name: ${alarm.name}`,
      `Description: ${alarm.description}`,
      `Resource: ${alarm.resource}`,
      `Severity: ${alarm.severity}`,
      `Cause: ${alarm.probableCause}`
    ].join('\n');

    // Use the alarm theme icon from statusUtils
    item.iconPath = resourceStatusService.getAlarmThemeIcon(alarm.severity);

    // Set the command to open the alarm details document
    item.command = {
      command: 'vscode-eda.showAlarmDetails',
      title: 'Show Alarm Details',
      arguments: [alarm]
    };

    return item;
  }

  private noAlarmsItem(extraText = ''): AlarmTreeItem {
    const label = extraText ? `No Alarms Found ${extraText}` : `No Alarms Found`;
    const item = new AlarmTreeItem(label, vscode.TreeItemCollapsibleState.None, 'info');

    // Use the standard status icon from statusUtils
    item.iconPath = resourceStatusService.getStatusIcon('gray');

    return item;
  }
}

export class AlarmTreeItem extends TreeItemBase {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    contextValue: string,
    public alarm?: EdaAlarm
  ) {
    super(label, collapsibleState, contextValue, alarm);
  }
}