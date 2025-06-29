export const targetWizardHtml = `
  <div class="form-container space-y-4">
    <img src="\${logo}" alt="EDA" class="mx-auto w-36" />
    <h2 class="text-lg font-semibold">Configure EDA Target</h2>
    <p class="text-sm text-gray-500">Provide the URL of your EDA API and optional Kubernetes context. Credentials are stored securely.</p>
    <label class="block text-sm font-medium">EDA API URL</label>
    <input id="url" type="text" placeholder="https://eda.example.com" class="input" />
    <label class="block text-sm font-medium">Kubernetes Context</label>
    <select id="context" class="input">
      <option value="">None</option>
      \${options}
    </select>
    <label class="block text-sm font-medium">EDA Username</label>
    <input id="edaUser" type="text" value="admin" class="input" />
    <label class="block text-sm font-medium">EDA Password</label>
    <div class="password-container">
      <input id="edaPass" type="password" value="admin" class="input pr-8" />
      <button id="toggleEdaPass" type="button" class="password-toggle" aria-label="Show password">👁</button>
    </div>
    <span id="edaPassHint" class="hint"></span>
    <label class="block text-sm font-medium">Keycloak Admin Username</label>
    <input id="kcUser" type="text" value="admin" class="input" />
    <label class="block text-sm font-medium">Keycloak Admin Password</label>
    <div class="password-container">
      <input id="kcPass" type="password" value="admin" class="input pr-8" />
      <button id="toggleKcPass" type="button" class="password-toggle" aria-label="Show password">👁</button>
    </div>
    <span id="kcPassHint" class="hint"></span>
    <label class="block text-sm font-medium"><input id="skipTls" type="checkbox" class="mr-1" /> Skip TLS Verification</label>
    <div class="flex justify-end gap-2">
      <button id="add" class="btn">Add</button>
      <button id="save" class="btn">Save</button>
    </div>
  </div>

  <div class="table-container mt-8">
    <h3 class="text-base font-semibold mb-4">Existing Targets</h3>
    <div class="table-wrapper">
      <table class="targets-table" id="targetsTable">
        <thead>
          <tr>
            <th class="table-header">Default</th>
            <th class="table-header">URL</th>
            <th class="table-header">Context</th>
            <th class="table-header">EDA User</th>
            <th class="table-header">KC User</th>
            <th class="table-header">Skip TLS</th>
            <th class="table-header text-right">Actions</th>
          </tr>
        </thead>
        <tbody id="targetsBody" class="table-body"></tbody>
      </table>
    </div>
  </div>
`;