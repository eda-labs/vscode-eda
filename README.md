# Event Driven Automation (EDA) - VS Code Extension

**Manage and monitor [EDA (Event Driven Automation)](https://docs.eda.dev/) resources in Kubernetes directly from Visual Studio Code.** This extension provides a convenient UI to view EDA namespaces, CRDs, system components, pods, alarms, deviations, and transactions — plus handy commands for editing and applying resources.

![screencast](https://raw.githubusercontent.com/eda-labs/vscode-eda/refs/heads/main/resources/eda-vscode.png)

---

## Features

1. **EDA Namespaces**  
   - Browse resources in each EDA-managed namespace.  
   - Filter by name, or open resources in a read-only or editable YAML view.

2. **System Namespace**  
   - Explore the `eda-system` namespace 
   - Inspect system Pods, Deployments, and CRDs that power the EDA environment.

3. **Alarms & Deviations**  
   - See active alarms 
   - View or reject deviations

4. **Transactions**  
   - Browse recent transactions.  
   - Show transaction details, revert or restore using `edactl` commands.

5. **Resource Editing**  
   - Open resources in read-only mode.  
   - Switch to edit mode with a single click — then apply or dry-run your changes.  
   - Create new resources from CRD skeletons with `Create Resource`.
   - Autocompletion, Suggestions and Popups for the ressources

6. **Pod Actions**  
   - Open a terminal to a Pod, view logs in a terminal, or delete/describe a Pod.

7. **Filtering**  
   - Quick filter at the top-level views (`Alt+Shift+F` by default).  
   - Clear filter to revert to full tree.

8. **Auto-Refresh**  
   - Refreshes all EDA resources in the background every configurable interval.  
   - Manual refresh command available too.

---


## Installation

1. **Prerequisites**  
   - A working Kubernetes environment with “EDA” and `kubectl` installed.  

2. **Install from VSIX or Marketplace**  

3. **Reload** VS Code to finalize activation.  

---

## Usage

- **Open the Explorer**  
  Look for **EDA Explorer** on the activity bar. This is the main UI.

- **Browse and Filter**  
  Expand the desired view, or press <kbd>Alt+Shift+F</kbd> to filter.

- **Edit Resources**  
  Right-click a resource → "View Resource". Then press the switch-to-edit icon (or command) to make changes.

- **Apply or Dry-Run**  
  Use the checkmark icon or the commands in the editor title bar to apply changes or validate with a dry-run.  

- **Check Logs and Terminal**  
  Right-click a Pod to open logs or a shell.

---

## Configuration

In VS Code settings (`File → Preferences → Settings`), navigate to `Extensions → EDA Explorer`:

- **`vscode-eda.refreshInterval`**  
  Set how often to auto-refresh (in milliseconds). Default: `30000` (30 seconds).

- **`vscode-eda.logLevel`**  
  Adjust logging verbosity.  
  - `0` = Debug  
  - `1` = Info (default)  
  - `2` = Warning  
  - `3` = Error  

---

## Contributing

Contributions are welcome via GitHub pull requests or issues. For major changes, please open an issue first to discuss what you would like to change.

Connect with us on [Discord](https://eda.dev/discord) for support and community discussions.
---
