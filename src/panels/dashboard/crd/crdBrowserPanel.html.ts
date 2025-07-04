export const crdBrowserHtml = `
  <div class="dashboard">
    <header class="header">
      <input id="filterInput" type="text" class="filter" placeholder="Search..." />
      <select id="crdSelect" class="select"></select>
      <button id="yamlBtn" class="yaml-btn">View YAML</button>
    </header>
    <h1 id="crdTitle" class="title"></h1>
    <div class="metadata-header">
      <pre id="metadataYaml" class="metadata"></pre>
    </div>
    <p id="crdDescription" class="description"></p>
    <div class="schema-controls">
      <button id="expandAll" class="schema-btn">+ Expand All</button>
      <button id="collapseAll" class="schema-btn">- Collapse All</button>
    </div>
    <div id="schema" class="schema"></div>
  </div>
`;
