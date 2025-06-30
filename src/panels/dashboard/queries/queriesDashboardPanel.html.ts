export const queriesDashboardHtml = `
  <div class="dashboard">
    <header class="header">
      <div class="query-bar">
        <label class="query-label" for="queryInput">🔍 EQL Query</label>
        <input id="queryInput" type="text" class="query-input" placeholder="Enter EQL expression" />
        <button id="runButton" class="run-btn">Run</button>
      </div>
      <select id="namespaceSelect" class="select"></select>
    </header>

    <div class="results-container">
      <table class="results-table">
        <thead>
          <tr id="headerRow"></tr>
          <tr id="filterRow" class="filters"></tr>
        </thead>
        <tbody id="resultsBody"></tbody>
      </table>
    </div>
    <div class="status-bar">
      <span id="status">Ready</span>
    </div>
  </div>
`;
