# Event Driven Automation (EDA) - VS Code Extension

**Manage and monitor [EDA (Event Driven Automation by Nokia)](https://docs.eda.dev/) resources directly through the EDA API from Visual Studio Code.** Whenever possible data is streamed over WebSockets for a more responsive experience. This extension provides a convenient UI to view EDA namespaces, CRDs, system components, pods, alarms, deviations, and transactions — plus handy commands for editing and applying resources.

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
   - Browse the last 50 transactions streamed from EDA.
   - View detailed information for a transaction directly from the EDA API.

4. **Pod Actions**
   - Open a terminal to a Pod, view logs in a terminal, or delete/describe a Pod.

5. **Filtering**
   - Quick filter at the top-level views (`Alt+Shift+F` by default).
   - Clear filter to revert to full tree.


---


## Installation

1. **Prerequisites**
   - Access to an EDA API server. The extension communicates with EDA directly and no longer requires a Kubernetes cluster.

2. **Install from VSIX or Marketplace**

3. **Reload** VS Code to finalize activation.

### Authentication

On first activation the extension prompts for your EDA and Keycloak passwords.
The values are stored in VS Code's Secret Storage and are keyed by the target's host. Use the **EDA: Update Target Credentials** command to change passwords for a specific target.
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
- **`vscode-eda.disableKubernetes`**
  When enabled, all Kubernetes-related features are disabled and the extension communicates exclusively with the EDA API. You can also set `EDA_DISABLE_K8S=true` as an environment variable.
- **`vscode-eda.edaTargets`**
  Map EDA API URLs to optional Kubernetes contexts and credentials. Each value may be a simple context string or an object:

  ```jsonc
  {
    "https://eda-example.com/": {
      "context": "kubernetes-admin@kubernetes",
      "edaUsername": "admin",          // your EDA-realm username for this URL
      "kcUsername": "admin"            // your Keycloak (KC) admin username
    },
    "https://10.10.10.1:9443": {
      "context": "kind-eda-demo",
      "edaUsername": "admin",        // whatever user you’ve set up in EDA
      "kcUsername": "admin"          // your Keycloak admin user
    }
  }
  ```

---

## Contributing

Contributions are welcome via GitHub pull requests or issues. For major changes, please open an issue first to discuss what you would like to change.

Connect with us on [Discord](https://eda.dev/discord) for support and community discussions.
---
