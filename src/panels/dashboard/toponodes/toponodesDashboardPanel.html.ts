export const toponodesDashboardHtml = `
  <div class="dashboard">
    <header class="header">
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
