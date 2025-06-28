export const nodeConfigHtml = `
  <div class="container">
    <div class="toolbar">
      <button id="toggleAnnotations" class="button">
        <span class="button-icon">⊞</span>
        <span>Hide Annotations</span>
      </button>
      <button id="copyConfig" class="button">
        <span class="button-icon">⧉</span>
        <span>Copy Config</span>
      </button>
      <select id="colorModeSelect" class="select">
        <option value="full">Full Color</option>
        <option value="less">Less Color</option>
        <option value="none">No Color</option>
      </select>
    </div>
    
    <div id="configView" class="config-view annotations-visible">
      <!-- Dynamic Content -->
    </div>
  </div>
  
  <div id="toast" class="toast">
    <span class="button-icon">✓</span>
    <span id="toastMessage">Config copied to clipboard</span>
  </div>
`;