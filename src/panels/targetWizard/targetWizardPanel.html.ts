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
    <input id="edaPass" type="password" value="admin" class="input" />
    <label class="block text-sm font-medium">Keycloak Admin Username</label>
    <input id="kcUser" type="text" value="admin" class="input" />
    <label class="block text-sm font-medium">Keycloak Admin Password</label>
    <input id="kcPass" type="password" value="admin" class="input" />
    <label class="block text-sm font-medium"><input id="skipTls" type="checkbox" class="mr-1" /> Skip TLS Verification</label>
    <div class="flex justify-end gap-2">
      <button id="add" class="btn">Add</button>
      <button id="save" class="btn">Save</button>
    </div>
  </div>

  <h3 class="text-base font-semibold mt-6">Existing Targets</h3>
  <table class="min-w-full table-auto border divide-y divide-gray-600" id="targetsTable">
    <thead class="bg-gray-50 dark:bg-transparent">
      <tr>
        <th class="px-2 py-1 text-left">Default</th>
        <th class="px-2 py-1 text-left">URL</th>
        <th class="px-2 py-1 text-left">Context</th>
        <th class="px-2 py-1 text-left">EDA User</th>
        <th class="px-2 py-1 text-left">KC User</th>
        <th class="px-2 py-1 text-left">Skip TLS</th>
        <th class="px-2 py-1"></th>
      </tr>
    </thead>
    <tbody id="targetsBody" class="divide-y divide-gray-600"></tbody>
  </table>
`;
