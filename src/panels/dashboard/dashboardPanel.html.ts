export const dashboardHtml = `
  <div class="dashboard">
    <header class="header">
      <h1 class="title">Fabric Network Dashboard</h1>
      <p class="subtitle">Real-time monitoring and analytics for your network infrastructure</p>
    </header>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Network Health</div>
        <div class="stat-value" id="health-value">98%</div>
        <div class="stat-change positive">
          <span>↑</span>
          <span>2.5% from last hour</span>
        </div>
      </div>
      
      <div class="stat-card">
        <div class="stat-label">Active Peers</div>
        <div class="stat-value" id="peers-value">42</div>
        <div class="stat-change positive">
          <span>↑</span>
          <span>3 new connections</span>
        </div>
      </div>
      
      <div class="stat-card">
        <div class="stat-label">Throughput</div>
        <div class="stat-value" id="throughput-value">1.2<span style="font-size: 20px;">TB/s</span></div>
        <div class="stat-change negative">
          <span>↓</span>
          <span>5% from peak</span>
        </div>
      </div>
      
      <div class="stat-card">
        <div class="stat-label">Latency</div>
        <div class="stat-value" id="latency-value">12<span style="font-size: 20px;">ms</span></div>
        <div class="stat-change positive">
          <span>↓</span>
          <span>8ms improvement</span>
        </div>
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
          <span>Traffic Flow</span>
        </div>
        <div id="traffic-chart" class="chart"></div>
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