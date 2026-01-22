// Constants for command messages to avoid duplication

// Pod-related messages
export const MSG_POD_NS_OR_NAME_MISSING = 'Pod namespace or name is missing.';
export const MSG_NO_POD_AVAILABLE_DELETE = 'No pod available to delete.';
export const MSG_NO_POD_AVAILABLE_TERMINAL = 'No pod available for terminal.';
export const MSG_NO_POD_AVAILABLE_LOGS = 'No pod available for logs.';
export const MSG_NO_POD_AVAILABLE_DESCRIBE = 'No pod available to describe.';

// Resource-related messages
export const MSG_NO_RESOURCE_SELECTED = 'No resource selected.';
export const MSG_BASKET_EDA_ONLY = 'Adding to basket is only supported for EDA resources.';
export const MSG_MISSING_API_VERSION = 'Missing apiVersion for EDA resource';

// Transaction-related messages
export const MSG_NO_TRANSACTION_ID = 'No transaction ID available.';

// Deviation-related messages
export const MSG_NO_DEVIATION_SELECTED = 'No deviation selected.';

// Deployment-related messages
export const MSG_DEPLOYMENT_NS_OR_NAME_MISSING = 'Deployment namespace or name is missing.';

// Common patterns
export const MSG_TRANSACTION_BASKET_EMPTY = 'Transaction basket is empty.';

// Command names and titles
export const CMD_SWITCH_TO_EDIT_MODE = 'Switch to edit mode';
export const CMD_APPLY_RESOURCE_CHANGES = 'vscode-eda.applyResourceChanges';
export const BTN_VIEW_DETAILS = 'View Details';

// Quick pick item labels and descriptions
export const LABEL_APPLY_CHANGES = 'Apply Changes';
export const LABEL_APPLY_CHANGES_ICON = '\u{1F4BE} Apply Changes';
export const LABEL_ADD_TO_BASKET_ICON = '\u{1F9FA} Add to Basket';
export const DESC_APPLY_TO_CLUSTER = 'Apply changes to the cluster';
export const DESC_SAVE_TO_BASKET = 'Save changes to the transaction basket';
