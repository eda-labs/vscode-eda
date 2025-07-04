export const queriesDashboardHtml = `
  <div class="dashboard">
    <header class="header">
      <div class="query-bar">
        <label class="query-label" for="queryInput"><span class="codicon codicon-search"></span> EQL Query</label>
        <div class="query-input-wrapper">
          <input id="queryInput" type="text" class="query-input" placeholder="Enter EQL expression" />
          <ul id="autocompleteList" class="autocomplete-list"></ul>
        </div>
        <button id="runButton" class="run-btn">Run</button>
        <div class="format-copy">
          <div class="copy-dropdown">
            <button id="copyButton" class="run-btn copy-btn">
              <span>Copy</span>
              <span id="formatToggleArea" class="format-toggle">
                <span id="formatToggle" class="codicon codicon-chevron-down"></span>
              </span>
            </button>
            <ul id="formatMenu" class="dropdown-menu">
              <li data-format="ascii">ASCII</li>
              <li data-format="markdown">Markdown</li>
              <li data-format="json">JSON</li>
              <li data-format="yaml">YAML</li>
            </ul>
          </div>
        </div>
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
