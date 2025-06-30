export const dashboardHtml = `
  <div class="dashboard">
    <header class="header">
      <div>
        <h1 class="title">Fabric Network Dashboard</h1>
        <p class="subtitle">Real-time monitoring and analytics for your network infrastructure</p>
      </div>
      <select id="namespaceSelect" class="select"></select>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Nodes</div>
        <div class="stat-value" id="nodes-total">0</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Synced Nodes</div>
        <div class="stat-value" id="nodes-synced">0</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Not Synced</div>
        <div class="stat-value" id="nodes-unsynced">0</div>
      </div>
    </div>

    <div class="interface-traffic-container">
      <div class="interface-stats-vertical">
        <div class="stat-card">
          <div class="stat-label">Total Interfaces</div>
          <div class="stat-value" id="if-total">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Up Interfaces</div>
          <div class="stat-value" id="if-up">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Down Interfaces</div>
          <div class="stat-value" id="if-down">0</div>
        </div>
      </div>

      <div class="chart-container traffic-chart-container">
        <div class="chart-title">
          <span>Traffic Flow</span>
        </div>
        <div id="traffic-chart" class="chart"></div>
      </div>
    </div>

    <div class="stats-grid" id="fabric-stats">
      <div class="stat-card">
        <div class="stat-label">Fabric Health</div>
        <div class="stat-content">
          <div class="stat-value" id="fabric-health">0%</div>
          <div class="status-indicator" id="fabric-health-indicator"></div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Spines</div>
        <div class="stat-content">
          <div class="stat-value" id="fabric-spines">0</div>
          <div class="status-indicator" id="fabric-spines-health"></div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Leafs</div>
        <div class="stat-content">
          <div class="stat-value" id="fabric-leafs">0</div>
          <div class="status-indicator" id="fabric-leafs-health"></div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Borderleafs</div>
        <div class="stat-content">
          <div class="stat-value" id="fabric-borderleafs">0</div>
          <div class="status-indicator" id="fabric-borderleafs-health"></div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Superspines</div>
        <div class="stat-content">
          <div class="stat-value" id="fabric-superspines">0</div>
          <div class="status-indicator" id="fabric-superspines-health"></div>
        </div>
      </div>
    </div>
    
  </div>
`;