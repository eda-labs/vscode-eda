export const targetWizardHtml = `
  <div class="flex justify-center mb-8 w-full">
    <img src="\${logo}" alt="EDA" class="logo w-36 h-auto block" />
  </div>
  <div class="flex flex-col gap-6 md:flex-row max-w-screen-xl mx-auto items-start">
    <!-- Left Pane: Target List -->
    <div class="flex flex-col flex-none w-80 bg-[var(--vscode-editorWidget-background)] border border-[var(--vscode-panel-border)] rounded-lg overflow-hidden">
      <div class="flex justify-between items-center p-4 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-editorGroupHeader-tabsBackground)]">
        <h3 class="text-base font-semibold">EDA Targets</h3>
        <button id="addNew" class="px-4 py-2 rounded font-medium text-sm cursor-pointer transition-colors bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] border border-[color:var(--vscode-button-border,transparent)] hover:bg-[var(--vscode-button-hoverBackground)]">Add New</button>
      </div>
      <div class="flex-1 py-2" id="targetsList">
        <!-- Target list items will be rendered here -->
      </div>
    </div>

    <!-- Right Pane: Details Form -->
    <div class="flex flex-col flex-1 bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded-lg overflow-hidden">
      <div class="flex justify-between items-center p-4 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-editorGroupHeader-tabsBackground)]">
        <h3 class="text-base font-semibold" id="detailsTitle">Target Details</h3>
        <div class="flex gap-2">
          <button id="setDefault" class="hidden px-4 py-2 rounded font-medium text-sm cursor-pointer transition-colors bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] border border-[var(--vscode-button-border)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]">Set as Default</button>
        </div>
      </div>

      <div class="p-6 max-w-[500px] pl-4" id="detailsContent">
        <div class="flex items-center justify-center h-48 text-center">
          <p class="text-gray-500">Select a target to view details, or add a new target to get started.</p>
        </div>
      </div>

      <div class="hidden max-w-[500px] pl-4" id="formContainer">
        <div class="space-y-4 p-6">
          <div>
            <label class="block text-sm font-medium">EDA API URL</label>
            <input id="url" type="text" placeholder="https://eda.example.com" class="w-full px-3 py-2 text-[var(--vscode-input-foreground)] bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded text-sm box-border focus:outline-none focus:border-[var(--vscode-focusBorder)]" />
          </div>

          <div>
            <label class="block text-sm font-medium">Kubernetes Context</label>
            <select id="context" class="w-full px-3 py-2 text-[var(--vscode-input-foreground)] bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded text-sm box-border focus:outline-none focus:border-[var(--vscode-focusBorder)]">
              <option value="">None</option>
              \${options}
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium">EDA Core Namespace</label>
            <input id="coreNs" type="text" value="eda-system" class="w-full px-3 py-2 text-[var(--vscode-input-foreground)] bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded text-sm box-border focus:outline-none focus:border-[var(--vscode-focusBorder)]" />
          </div>

          <div>
            <label class="block text-sm font-medium">EDA Username</label>
            <input id="edaUser" type="text" value="admin" class="w-full px-3 py-2 text-[var(--vscode-input-foreground)] bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded text-sm box-border focus:outline-none focus:border-[var(--vscode-focusBorder)]" />
          </div>

          <div>
            <label class="block text-sm font-medium">EDA Password</label>
            <div class="relative">
              <input id="edaPass" type="password" value="admin" class="w-full px-3 py-2 pr-8 text-[var(--vscode-input-foreground)] bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded text-sm box-border focus:outline-none focus:border-[var(--vscode-focusBorder)]" />
              <button id="toggleEdaPass" type="button" class="absolute top-1/2 right-2 -translate-y-1/2 bg-transparent border-none text-[var(--vscode-input-foreground)] cursor-pointer p-1" aria-label="Show password">👁</button>
            </div>
            <span id="edaPassHint" class="hint"></span>
          </div>

          <div>
            <label class="block text-sm font-medium">Keycloak Admin Username</label>
            <input id="kcUser" type="text" value="admin" class="w-full px-3 py-2 text-[var(--vscode-input-foreground)] bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded text-sm box-border focus:outline-none focus:border-[var(--vscode-focusBorder)]" />
          </div>

          <div>
            <label class="block text-sm font-medium">Keycloak Admin Password</label>
            <div class="relative">
              <input id="kcPass" type="password" value="admin" class="w-full px-3 py-2 pr-8 text-[var(--vscode-input-foreground)] bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded text-sm box-border focus:outline-none focus:border-[var(--vscode-focusBorder)]" />
              <button id="toggleKcPass" type="button" class="absolute top-1/2 right-2 -translate-y-1/2 bg-transparent border-none text-[var(--vscode-input-foreground)] cursor-pointer p-1" aria-label="Show password">👁</button>
            </div>
            <span id="kcPassHint" class="hint"></span>
          </div>

          <div>
            <label class="block text-sm font-medium"><input id="skipTls" type="checkbox" class="mr-1" /> Skip TLS Verification</label>
          </div>

          <div class="flex justify-end gap-3 pt-4 mt-6 border-t border-[var(--vscode-panel-border)]">
            <button id="cancel" class="px-4 py-2 rounded font-medium text-sm cursor-pointer transition-colors bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] border border-[var(--vscode-button-border)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]">Cancel</button>
            <button id="save" class="px-4 py-2 rounded font-medium text-sm cursor-pointer transition-colors bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] border border-[color:var(--vscode-button-border,transparent)] hover:bg-[var(--vscode-button-hoverBackground)]">Save</button>
          </div>
        </div>
      </div>
    </div>
  </div>
`;