// import * as vscode from 'vscode';
// import { TreeItemBase } from './treeItem';
// import { serviceManager } from '../../services/serviceManager';
// import { EdaClient } from '../../clients/edaClient';
// import { ResourceStatusService } from '../../services/resourceStatusService';
// import { log, LogLevel } from '../../extension';

// /**
//  * TreeDataProvider for the EDA Alarms view
//  */
// export class EdaAlarmProvider implements vscode.TreeDataProvider<TreeItemBase> {
//   private _onDidChangeTreeData = new vscode.EventEmitter<TreeItemBase | undefined>();
//   readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

//   private edactlClient: EdaClient;
//   private statusService: ResourceStatusService;
//   private refreshInterval: number;
//   private treeFilter: string = '';
//   private refreshTimer?: ReturnType<typeof setInterval>;
//   private _refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;
//   private cachedAlarms: any[] = [];

//   constructor(refreshIntervalMs: number = 10000) {
//     this.edactlClient = serviceManager.getClient<EdaClient>('edactl');
//     this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');
//     this.refreshInterval = refreshIntervalMs;
//     this.startRefreshTimer();
//     void this.edactlClient.streamEdaAlarms(alarms => {
//       log(`Alarm stream provided ${alarms.length} alarms`, LogLevel.DEBUG);
//       this.cachedAlarms = alarms;
//       this.refresh();
//     });
//   }

//   /**
//    * Start automatic refresh timer
//    */
//   private startRefreshTimer(): void {
//     if (this.refreshTimer) {
//       clearInterval(this.refreshTimer);
//     }
//     this.refreshTimer = setInterval(() => {
//       this.refresh();
//     }, this.refreshInterval);
//     log(`Alarm polling started, refresh interval: ${this.refreshInterval}ms`, LogLevel.INFO);
//   }

//   /**
//    * Stop automatic refresh timer
//    */
//   public dispose(): void {
//     if (this.refreshTimer) {
//       clearInterval(this.refreshTimer);
//       this.refreshTimer = undefined;
//       log('Alarm polling stopped', LogLevel.INFO);
//     }

//     this.edactlClient.closeAlarmStream();

//     if (this._refreshDebounceTimer) {
//       clearTimeout(this._refreshDebounceTimer);
//       this._refreshDebounceTimer = undefined;
//     }
//   }

//   /**
//    * Refresh the alarm tree
//    */
//   public refresh(): void {
//     log('Refreshing EDA alarms tree view...', LogLevel.DEBUG);
//     if (this._refreshDebounceTimer) {
//       clearTimeout(this._refreshDebounceTimer);
//     }

//     this._refreshDebounceTimer = setTimeout(() => {
//       this._onDidChangeTreeData.fire(undefined);
//       this._refreshDebounceTimer = undefined;
//     }, 100);
//   }

//   /**
//    * Filter the tree by text
//    * @param filterText Text to filter by
//    */
//   public setTreeFilter(filterText: string): void {
//     this.treeFilter = filterText.toLowerCase();
//     log(`Setting alarm tree filter to: "${filterText}"`, LogLevel.INFO);
//     this.refresh();
//   }

//   /**
//    * Clear the current tree filter
//    */
//   public clearTreeFilter(): void {
//     this.treeFilter = '';
//     log(`Clearing alarm tree filter`, LogLevel.INFO);
//     this.refresh();
//   }

//   getTreeItem(element: TreeItemBase): vscode.TreeItem {
//     return element;
//   }

//   async getChildren(element?: TreeItemBase): Promise<TreeItemBase[]> {
//     if (element) {
//       // We don't do nested children for alarms; each alarm is a leaf
//       return [];
//     }

//     try {
//       if (this.cachedAlarms.length === 0) {
//         this.cachedAlarms = await this.edactlClient.getEdaAlarms();
//       }
//       const alarms = this.cachedAlarms;

//       if (alarms.length === 0) {
//         return [this.createNoAlarmsItem()];
//       }

//       let alarmItems = alarms.map(alarm => this.createAlarmItem(alarm));

//       // Apply filter if one is set
//       if (this.treeFilter) {
//         alarmItems = alarmItems.filter(item => {
//           const label = item.label.toString().toLowerCase();
//           const description = item.description?.toString().toLowerCase() || '';
//           return label.includes(this.treeFilter) || description.includes(this.treeFilter);
//         });

//         if (alarmItems.length === 0) {
//           return [this.createNoAlarmsItem(`(no matches for "${this.treeFilter}")`)];
//         }
//       }

//       return alarmItems;
//     } catch (error) {
//       log(`Error getting alarms for tree view: ${error}`, LogLevel.ERROR);
//       const errorItem = new TreeItemBase(
//         'Error loading alarms',
//         vscode.TreeItemCollapsibleState.None,
//         'error'
//       );
//       errorItem.iconPath = new vscode.ThemeIcon('error');
//       errorItem.tooltip = `${error}`;
//       return [errorItem];
//     }
//   }

//   /**
//    * Create a tree item for when there are no alarms
//    */
//   private createNoAlarmsItem(extraText = ''): TreeItemBase {
//     const label = extraText ? `No Alarms Found ${extraText}` : 'No Alarms Found';
//     const item = new TreeItemBase(
//       label,
//       vscode.TreeItemCollapsibleState.None,
//       'message'
//     );

//     // Use the status icon from statusService
//     item.iconPath = this.statusService.getThemeStatusIcon('gray');
//     return item;
//   }

//   /**
//    * Create a tree item for an alarm
//    */
//   private createAlarmItem(alarm: any): TreeItemBase {
//     const label = `${alarm.severity.toUpperCase()} - ${alarm.type}`;
//     const item = new TreeItemBase(
//       label,
//       vscode.TreeItemCollapsibleState.None,
//       'eda-alarm',
//       { metadata: { name: alarm.name } }
//     );

//     item.description = `ns: ${alarm["namespace.name"] || 'unknown'}`;
//     item.tooltip = [
//       `Name: ${alarm.name}`,
//       `Description: ${alarm.description || 'No description'}`,
//       `Resource: ${alarm.resource || 'Unknown'}`,
//       `Severity: ${alarm.severity}`,
//       `Cause: ${alarm.probableCause || 'Unknown'}`
//     ].join('\n');

//     // Use alarm theme icon from statusService
//     item.iconPath = this.statusService.getAlarmThemeIcon(alarm.severity);

//     // Set command to show alarm details
//     item.command = {
//       command: 'vscode-eda.showAlarmDetails',
//       title: 'Show Alarm Details',
//       arguments: [alarm]
//     };

//     return item;
//   }
// }