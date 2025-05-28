# Event Driven Automation (EDA) - VS Code Extension

**Manage and monitor [EDA (Event Driven Automation by Nokia)](https://docs.eda.dev/) resources in Kubernetes directly from Visual Studio Code.** This extension provides a convenient UI to view EDA namespaces, CRDs, system components, pods, alarms, deviations, and transactions — plus handy commands for editing and applying resources.

![screencast](https://raw.githubusercontent.com/eda-labs/vscode-eda/refs/heads/main/resources/eda-vscode.png)

---

## Features

1. **EDA Namespaces and Resources**
   - Browse resources in each EDA-managed namespace.
   - Create new resources from CRD skeletons.
   - Switch to edit mode with a single click — then apply or dry-run your changes.
   - Autocompletion, Suggestions and Popups for the ressources

2. **Alarms & Deviations**
   - See active alarms
   - View or reject deviations

3. **Transactions**
   - Browse recent transactions.
   - Show transaction details, revert or restore using `edactl` commands.

4. **Pod Actions**
   - Open a terminal to a Pod, view logs in a terminal, or delete/describe a Pod.

5. **Filtering**
   - Quick filter at the top-level views (`Alt+Shift+F` by default).
   - Clear filter to revert to full tree.


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

- **`vscode-eda.logLevel`**
  Adjust logging verbosity.
  - `0` = Debug
  - `1` = Info (default)
  - `2` = Warning
  - `3` = Error
- **`vscode-eda.skipTlsVerify`**
  When enabled, the extension skips TLS certificate validation when connecting to the EDA API. This is helpful in development environments with self-signed certificates. The same behavior can be toggled via the `EDA_SKIP_TLS_VERIFY=true` environment variable.

---

## Contributing

Contributions are welcome via GitHub pull requests or issues. For major changes, please open an issue first to discuss what you would like to change.

Connect with us on [Discord](https://eda.dev/discord) for support and community discussions.
---
