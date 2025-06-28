export const targetWizardHtml = `
  <div class="container">
    <img src="\${logo}" alt="EDA">
    <h2>Configure EDA Target</h2>
    <p>Provide the URL of your EDA API and optional Kubernetes context. Credentials are stored securely.</p>
    <label>EDA API URL</label>
    <input id="url" type="text" placeholder="https://eda.example.com">
    <label>Kubernetes Context</label>
    <select id="context">
      <option value="">None</option>
      \${options}
    </select>
    <label>EDA Username</label>
    <input id="edaUser" type="text" value="admin">
    <label>EDA Password</label>
    <input id="edaPass" type="password" value="admin">
    <label>Keycloak Admin Username</label>
    <input id="kcUser" type="text" value="admin">
    <label>Keycloak Admin Password</label>
    <input id="kcPass" type="password" value="admin">
    <button id="save">Save</button>
  </div>
`;