export const targetWizardHtml = `
  <div class="header-container">
    <img src="\${logo}" alt="EDA" class="logo" />
  </div>
  <div class="main-container">
    <!-- Left Pane: Target List -->
    <div class="targets-list-pane">
      <div class="list-header">
        <h3 class="text-base font-semibold">EDA Targets</h3>
        <button id="addNew" class="btn btn-primary">Add New</button>
      </div>
      <div class="targets-list" id="targetsList">
        <!-- Target list items will be rendered here -->
      </div>
    </div>

    <!-- Right Pane: Details Form -->
    <div class="details-pane">
      <div class="details-header">
        <h3 class="text-base font-semibold" id="detailsTitle">Target Details</h3>
        <div class="details-actions">
          <button id="setDefault" class="btn btn-secondary" style="display: none;">Set as Default</button>
        </div>
      </div>
      
      <div class="details-content" id="detailsContent">
        <div class="empty-details">
          <p class="text-gray-500">Select a target to view details, or add a new target to get started.</p>
        </div>
      </div>

      <div class="form-container" id="formContainer" style="display: none;">
        <div class="space-y-4">
          <div class="form-group">
            <label class="block text-sm font-medium">EDA API URL</label>
            <input id="url" type="text" placeholder="https://eda.example.com" class="input" />
          </div>
          
          <div class="form-group">
            <label class="block text-sm font-medium">Kubernetes Context</label>
            <select id="context" class="input">
              <option value="">None</option>
              \${options}
            </select>
          </div>
          
          <div class="form-group">
            <label class="block text-sm font-medium">EDA Core Namespace</label>
            <input id="coreNs" type="text" value="eda-system" class="input" />
          </div>
          
          <div class="form-group">
            <label class="block text-sm font-medium">EDA Username</label>
            <input id="edaUser" type="text" value="admin" class="input" />
          </div>
          
          <div class="form-group">
            <label class="block text-sm font-medium">EDA Password</label>
            <div class="password-container">
              <input id="edaPass" type="password" value="admin" class="input pr-8" />
              <button id="toggleEdaPass" type="button" class="password-toggle" aria-label="Show password">👁</button>
            </div>
            <span id="edaPassHint" class="hint"></span>
          </div>
          
          <div class="form-group">
            <label class="block text-sm font-medium">Keycloak Admin Username</label>
            <input id="kcUser" type="text" value="admin" class="input" />
          </div>
          
          <div class="form-group">
            <label class="block text-sm font-medium">Keycloak Admin Password</label>
            <div class="password-container">
              <input id="kcPass" type="password" value="admin" class="input pr-8" />
              <button id="toggleKcPass" type="button" class="password-toggle" aria-label="Show password">👁</button>
            </div>
            <span id="kcPassHint" class="hint"></span>
          </div>
          
          <div class="form-group">
            <label class="block text-sm font-medium">
              <input id="skipTls" type="checkbox" class="mr-1" /> Skip TLS Verification
            </label>
          </div>
          
          <div class="form-actions">
            <button id="cancel" class="btn btn-secondary">Cancel</button>
            <button id="save" class="btn btn-primary">Save</button>
          </div>
        </div>
      </div>
    </div>
  </div>
`;