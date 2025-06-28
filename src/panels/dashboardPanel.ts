import * as vscode from 'vscode';

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => possible.charAt(Math.floor(Math.random() * possible.length))).join('');
}

export class DashboardPanel {
  private panel: vscode.WebviewPanel;

  constructor(private context: vscode.ExtensionContext, title: string) {
    this.panel = vscode.window.createWebviewPanel(
      'edaDashboard',
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );
    this.panel.webview.html = this.getHtml();
  }

  private getHtml(): string {
    const nonce = getNonce();
    const csp = this.panel.webview.cspSource;
    const twJs = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'tailwind.js')
    );
    const echartsJs = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'echarts.min.js')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} https:; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --bg-primary: var(--vscode-editor-background);
      --bg-secondary: var(--vscode-panel-background);
      --bg-hover: var(--vscode-list-hoverBackground);
      --text-primary: var(--vscode-editor-foreground);
      --text-secondary: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border);
      --accent: var(--vscode-button-background);
      --accent-hover: var(--vscode-button-hoverBackground);
      --success: #4ade80;
      --warning: #fbbf24;
      --error: #f87171;
      --info: #60a5fa;
    }
    
    body {
      margin: 0;
      padding: 0;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      overflow-x: hidden;
    }
    
    .dashboard {
      padding: 24px;
      max-width: 1400px;
      margin: 0 auto;
    }
    
    .header {
      margin-bottom: 32px;
    }
    
    .title {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 8px;
      background: linear-gradient(135deg, var(--accent) 0%, var(--info) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .subtitle {
      color: var(--text-secondary);
      font-size: 14px;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }
    
    .stat-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }
    
    .stat-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
      border-color: var(--accent);
    }
    
    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, var(--accent) 0%, var(--info) 100%);
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    
    .stat-card:hover::before {
      opacity: 1;
    }
    
    .stat-label {
      color: var(--text-secondary);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    
    .stat-value {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    
    .stat-change {
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .stat-change.positive {
      color: var(--success);
    }
    
    .stat-change.negative {
      color: var(--error);
    }
    
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 24px;
      margin-bottom: 32px;
    }
    
    .chart-container {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      transition: all 0.3s ease;
    }
    
    .chart-container:hover {
      border-color: var(--accent);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    
    .chart-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    
    .chart {
      height: 300px;
    }
    
    .status-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }
    
    .status-item {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: all 0.3s ease;
    }
    
    .status-item:hover {
      background: var(--bg-hover);
      border-color: var(--accent);
    }
    
    .status-indicator {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
      position: relative;
    }
    
    .status-indicator.active {
      background: var(--success);
      animation: pulse 2s infinite;
    }
    
    .status-indicator.warning {
      background: var(--warning);
    }
    
    .status-indicator.error {
      background: var(--error);
    }
    
    @keyframes pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.7);
      }
      70% {
        box-shadow: 0 0 0 8px rgba(74, 222, 128, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(74, 222, 128, 0);
      }
    }
    
    .status-info {
      flex: 1;
    }
    
    .status-name {
      font-weight: 600;
      margin-bottom: 2px;
    }
    
    .status-details {
      font-size: 12px;
      color: var(--text-secondary);
    }
    
    .refresh-btn {
      background: var(--accent);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .refresh-btn:hover {
      background: var(--accent-hover);
      transform: translateY(-1px);
    }
    
    .icon {
      display: inline-block;
      width: 16px;
      height: 16px;
    }
  </style>
</head>
<body>
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
  
  <script nonce="${nonce}" src="${twJs}"></script>
  <script nonce="${nonce}" src="${echartsJs}"></script>
  <script nonce="${nonce}">
    // Chart theme that adapts to VS Code theme
    const isDark = document.body.style.backgroundColor !== 'rgb(255, 255, 255)';
    const chartTheme = {
      color: ['#60a5fa', '#4ade80', '#fbbf24', '#f87171', '#a78bfa', '#f472b6'],
      backgroundColor: 'transparent',
      textStyle: {
        color: getComputedStyle(document.documentElement).getPropertyValue('--text-primary')
      },
      title: {
        textStyle: {
          color: getComputedStyle(document.documentElement).getPropertyValue('--text-primary')
        }
      },
      axisLine: {
        lineStyle: {
          color: getComputedStyle(document.documentElement).getPropertyValue('--border')
        }
      },
      splitLine: {
        lineStyle: {
          color: getComputedStyle(document.documentElement).getPropertyValue('--border'),
          opacity: 0.3
        }
      }
    };
    
    // Initialize charts
    const healthChart = echarts.init(document.getElementById('health-chart'), chartTheme);
    const peerChart = echarts.init(document.getElementById('peer-chart'), chartTheme);
    const trafficChart = echarts.init(document.getElementById('traffic-chart'), chartTheme);
    const performanceChart = echarts.init(document.getElementById('performance-chart'), chartTheme);
    
    // Health Gauge Chart
    healthChart.setOption({
      series: [{
        type: 'gauge',
        startAngle: 180,
        endAngle: 0,
        radius: '90%',
        progress: {
          show: true,
          width: 18,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: '#60a5fa' },
                { offset: 0.5, color: '#4ade80' },
                { offset: 1, color: '#4ade80' }
              ]
            }
          }
        },
        axisLine: {
          lineStyle: {
            width: 18,
            color: [[1, 'rgba(96, 165, 250, 0.1)']]
          }
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        anchor: { show: false },
        title: {
          show: true,
          offsetCenter: [0, '30%'],
          fontSize: 16,
          color: chartTheme.textStyle.color
        },
        detail: {
          valueAnimation: true,
          formatter: '{value}%',
          offsetCenter: [0, 0],
          fontSize: 36,
          fontWeight: 'bold',
          color: chartTheme.textStyle.color
        },
        data: [{ value: 98, name: 'Overall Health' }]
      }]
    });
    
    // Peer Status Bar Chart
    peerChart.setOption({
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow'
        }
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: ['spine-01', 'spine-02', 'leaf-01', 'leaf-02', 'leaf-03', 'leaf-04'],
        axisLabel: {
          color: chartTheme.textStyle.color
        }
      },
      yAxis: {
        type: 'value',
        name: 'Active Sessions',
        axisLabel: {
          color: chartTheme.textStyle.color
        }
      },
      series: [
        {
          name: 'Active',
          type: 'bar',
          stack: 'total',
          data: [120, 132, 101, 134, 90, 130],
          itemStyle: {
            color: '#4ade80'
          }
        },
        {
          name: 'Idle',
          type: 'bar',
          stack: 'total',
          data: [20, 18, 29, 16, 30, 20],
          itemStyle: {
            color: '#fbbf24'
          }
        },
        {
          name: 'Failed',
          type: 'bar',
          stack: 'total',
          data: [5, 2, 8, 3, 10, 4],
          itemStyle: {
            color: '#f87171'
          }
        }
      ]
    });
    
    // Traffic Flow Line Chart
    const hours = Array.from({length: 24}, (_, i) => i + ':00');
    const trafficData = hours.map(() => Math.floor(Math.random() * 1000) + 500);
    const bandwidthData = hours.map(() => Math.floor(Math.random() * 800) + 600);
    
    trafficChart.setOption({
      tooltip: {
        trigger: 'axis'
      },
      legend: {
        data: ['Inbound', 'Outbound'],
        textStyle: {
          color: chartTheme.textStyle.color
        }
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: hours,
        axisLabel: {
          color: chartTheme.textStyle.color
        }
      },
      yAxis: {
        type: 'value',
        name: 'Traffic (Gbps)',
        axisLabel: {
          color: chartTheme.textStyle.color
        }
      },
      series: [
        {
          name: 'Inbound',
          type: 'line',
          smooth: true,
          data: trafficData,
          areaStyle: {
            opacity: 0.3
          },
          itemStyle: {
            color: '#60a5fa'
          }
        },
        {
          name: 'Outbound',
          type: 'line',
          smooth: true,
          data: bandwidthData,
          areaStyle: {
            opacity: 0.3
          },
          itemStyle: {
            color: '#a78bfa'
          }
        }
      ]
    });
    
    // Performance Radar Chart
    performanceChart.setOption({
      radar: {
        indicator: [
          { name: 'CPU Usage', max: 100 },
          { name: 'Memory', max: 100 },
          { name: 'Bandwidth', max: 100 },
          { name: 'Latency', max: 100 },
          { name: 'Packet Loss', max: 100 },
          { name: 'Uptime', max: 100 }
        ],
        axisName: {
          color: chartTheme.textStyle.color
        },
        splitLine: {
          lineStyle: {
            color: chartTheme.splitLine.lineStyle.color,
            opacity: 0.3
          }
        },
        splitArea: {
          areaStyle: {
            color: ['rgba(96, 165, 250, 0.05)', 'rgba(96, 165, 250, 0.1)']
          }
        }
      },
      series: [{
        type: 'radar',
        data: [
          {
            value: [65, 78, 85, 92, 98, 99],
            name: 'Current',
            areaStyle: {
              opacity: 0.3
            },
            itemStyle: {
              color: '#60a5fa'
            }
          },
          {
            value: [70, 80, 82, 88, 95, 97],
            name: '24h Avg',
            areaStyle: {
              opacity: 0.3
            },
            itemStyle: {
              color: '#4ade80'
            }
          }
        ]
      }]
    });
    
    // Auto-refresh function
    function refreshCharts() {
      // Update stats
      document.getElementById('health-value').textContent = Math.floor(Math.random() * 10 + 90) + '%';
      document.getElementById('peers-value').textContent = Math.floor(Math.random() * 10 + 38);
      document.getElementById('throughput-value').innerHTML = (Math.random() * 0.8 + 0.8).toFixed(1) + '<span style="font-size: 20px;">TB/s</span>';
      document.getElementById('latency-value').innerHTML = Math.floor(Math.random() * 10 + 8) + '<span style="font-size: 20px;">ms</span>';
      
      // Update health gauge
      const healthValue = Math.floor(Math.random() * 10 + 90);
      healthChart.setOption({
        series: [{
          data: [{ value: healthValue }]
        }]
      });
      
      // Update other charts with new random data
      const newTrafficData = hours.map(() => Math.floor(Math.random() * 1000) + 500);
      const newBandwidthData = hours.map(() => Math.floor(Math.random() * 800) + 600);
      
      trafficChart.setOption({
        series: [
          { data: newTrafficData },
          { data: newBandwidthData }
        ]
      });
    }
    
    // Handle window resize
    window.addEventListener('resize', () => {
      healthChart.resize();
      peerChart.resize();
      trafficChart.resize();
      performanceChart.resize();
    });
    
    // Auto-refresh every 5 seconds
    setInterval(refreshCharts, 5000);
  </script>
</body>
</html>`;
  }

  static show(context: vscode.ExtensionContext, title: string): void {
    new DashboardPanel(context, title);
  }
}