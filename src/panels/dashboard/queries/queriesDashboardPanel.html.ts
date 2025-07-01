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
          <select id="formatSelect" class="select">
            <option value="markdown">Markdown</option>
            <option value="ascii">ASCII</option>
          </select>
          <button id="copyButton" class="run-btn">Copy</button>
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
