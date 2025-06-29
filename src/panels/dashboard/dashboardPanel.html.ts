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
    
    <div class="charts-grid">
      <div class="chart-container">
        <div class="chart-title">
          <span>Network Health Overview</span>
          <button class="refresh-btn" onclick="refreshCharts()">
            <span class="icon">⟳</span>
            Refresh
          </button>
        </div>
        <div id="health-chart" class="chart"></div>
      </div>
      
      <div class="chart-container">
        <div class="chart-title">
          <span>BGP Peer Status</span>
        </div>
        <div id="peer-chart" class="chart"></div>
      </div>
      
      <div class="chart-container">
        <div class="chart-title">
          <span>Performance Metrics</span>
        </div>
        <div id="performance-chart" class="chart"></div>
      </div>
    </div>
    
    <div class="chart-container">
      <div class="chart-title">
        <span>Device Status</span>
      </div>
      <div class="status-grid">
        <div class="status-item">
          <div class="status-indicator active"></div>
          <div class="status-info">
            <div class="status-name">spine-01</div>
            <div class="status-details">Operating normally</div>
          </div>
        </div>
        <div class="status-item">
          <div class="status-indicator active"></div>
          <div class="status-info">
            <div class="status-name">spine-02</div>
            <div class="status-details">Operating normally</div>
          </div>
        </div>
        <div class="status-item">
          <div class="status-indicator warning"></div>
          <div class="status-info">
            <div class="status-name">leaf-01</div>
            <div class="status-details">High CPU usage</div>
          </div>
        </div>
        <div class="status-item">
          <div class="status-indicator active"></div>
          <div class="status-info">
            <div class="status-name">leaf-02</div>
            <div class="status-details">Operating normally</div>
          </div>
        </div>
        <div class="status-item">
          <div class="status-indicator error"></div>
          <div class="status-info">
            <div class="status-name">leaf-03</div>
            <div class="status-details">Connection lost</div>
          </div>
        </div>
        <div class="status-item">
          <div class="status-indicator active"></div>
          <div class="status-info">
            <div class="status-name">leaf-04</div>
            <div class="status-details">Operating normally</div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;