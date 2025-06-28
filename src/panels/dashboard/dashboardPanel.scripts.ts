export const dashboardScripts = `
    // Load external scripts
    const loadScript = (src) => {
      const script = document.createElement('script');
      script.src = src;
      document.body.appendChild(script);
      return new Promise((resolve) => {
        script.onload = resolve;
      });
    };
    
    // Load dependencies
    Promise.all([
      loadScript(twJsUri),
      loadScript(echartsJsUri)
    ]).then(() => {
      initDashboard();
    });
    
    function initDashboard() {
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
      window.refreshCharts = function() {
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
      };
      
      // Handle window resize
      window.addEventListener('resize', () => {
        healthChart.resize();
        peerChart.resize();
        trafficChart.resize();
        performanceChart.resize();
      });
      
      // Auto-refresh every 5 seconds
      setInterval(window.refreshCharts, 5000);
    }
`;