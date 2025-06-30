export const fabricDashboardScripts = `
    const vscode = acquireVsCodeApi();
    const namespaceSelect = document.getElementById('namespaceSelect');

    const setInd = (id, h) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('active', 'warning', 'error');
      if (h >= 90) el.classList.add('active');
      else if (h >= 50) el.classList.add('warning');
      else el.classList.add('error');
    };

    // Load external scripts
    const loadScript = (src) => {
      const script = document.createElement('script');
      script.src = src;
      document.body.appendChild(script);
      return new Promise((resolve) => {
        script.onload = resolve;
      });
    };

    let updateTrafficChart = () => {};
    let clearTrafficChart = () => {};

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.command === 'init') {
        namespaceSelect.innerHTML = '';
        msg.namespaces.forEach(ns => {
          const opt = document.createElement('option');
          opt.value = ns;
          opt.textContent = ns;
          namespaceSelect.appendChild(opt);
        });
        const sel = msg.selected || msg.namespaces[0] || '';
        namespaceSelect.value = sel;
        vscode.postMessage({ command: 'getTopoNodeStats', namespace: sel });
      } else if (msg.command === 'topoNodeStats') {
        document.getElementById('nodes-total').textContent = msg.stats.total;
        document.getElementById('nodes-synced').textContent = msg.stats.synced;
        document.getElementById('nodes-unsynced').textContent = msg.stats.notSynced;
      } else if (msg.command === 'interfaceStats') {
        document.getElementById('if-total').textContent = msg.stats.total;
        document.getElementById('if-up').textContent = msg.stats.up;
        document.getElementById('if-down').textContent = msg.stats.down;
      } else if (msg.command === 'trafficStats') {
        updateTrafficChart(msg.stats.in, msg.stats.out);
      } else if (msg.command === 'clearTrafficData') {
        clearTrafficChart();
      } else if (msg.command === 'fabricSpineStats') {
        document.getElementById('fabric-spines').textContent = msg.stats.count;
        setInd('fabric-spines-health', msg.stats.health);
      } else if (msg.command === 'fabricLeafStats') {
        document.getElementById('fabric-leafs').textContent = msg.stats.count;
        setInd('fabric-leafs-health', msg.stats.health);
      } else if (msg.command === 'fabricBorderLeafStats') {
        document.getElementById('fabric-borderleafs').textContent = msg.stats.count;
        setInd('fabric-borderleafs-health', msg.stats.health);
      } else if (msg.command === 'fabricSuperSpineStats') {
        document.getElementById('fabric-superspines').textContent = msg.stats.count;
        setInd('fabric-superspines-health', msg.stats.health);
      } else if (msg.command === 'fabricHealth') {
        document.getElementById('fabric-health').textContent = msg.health + '%';
        setInd('fabric-health-indicator', msg.health);
      }
    });

    namespaceSelect.addEventListener('change', () => {
      vscode.postMessage({ command: 'getTopoNodeStats', namespace: namespaceSelect.value });
    });

    vscode.postMessage({ command: 'ready' });

    // Load dependencies
    loadScript(echartsJsUri).then(() => {
      initDashboard();
    });

    function initDashboard() {
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

      const trafficChart = echarts.init(document.getElementById('traffic-chart'), chartTheme);

      const trafficTimes = [];
      const inboundData = [];
      const outboundData = [];
      const MAX_POINTS = 20;

      updateTrafficChart = function(inVal, outVal) {
        const now = new Date();
        const label = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (trafficTimes.length >= MAX_POINTS) {
          trafficTimes.shift();
          inboundData.shift();
          outboundData.shift();
        }
        trafficTimes.push(label);
        inboundData.push(inVal);
        outboundData.push(outVal);
        trafficChart.setOption({
          xAxis: { data: trafficTimes },
          series: [
            { data: inboundData },
            { data: outboundData }
          ]
        });
      };

      clearTrafficChart = function() {
        trafficTimes.length = 0;
        inboundData.length = 0;
        outboundData.length = 0;
        trafficChart.setOption({
          xAxis: { data: [] },
          series: [
            { data: [] },
            { data: [] }
          ]
        });
      };

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
          data: trafficTimes,
          axisLabel: {
            color: chartTheme.textStyle.color
          }
        },
        yAxis: {
          type: 'value',
          name: 'Traffic (bps)',
          axisLabel: {
            color: chartTheme.textStyle.color
          }
        },
        series: [
          {
            name: 'Inbound',
            type: 'line',
            smooth: true,
            data: inboundData,
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
            data: outboundData,
            areaStyle: {
              opacity: 0.3
            },
            itemStyle: {
              color: '#a78bfa'
            }
          }
        ]
      });

      window.addEventListener('resize', () => {
        trafficChart.resize();
      });
    }
`;