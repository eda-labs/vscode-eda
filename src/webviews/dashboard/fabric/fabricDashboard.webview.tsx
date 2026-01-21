import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { usePostMessage, useMessageListener, useReadySignal } from '../../shared/hooks';
import { VSCodeProvider } from '../../shared/context';

declare const echarts: any;

interface FabricMessage {
  command: string;
  namespaces?: string[];
  selected?: string;
  stats?: {
    total?: number;
    synced?: number;
    notSynced?: number;
    up?: number;
    down?: number;
    in?: number;
    out?: number;
    count?: number;
    health?: number;
  };
  health?: number;
}

interface TrafficPoint {
  time: number;
  inbound: number;
  outbound: number;
}

interface NodeStats {
  total: number;
  synced: number;
  notSynced: number;
}

interface InterfaceStats {
  total: number;
  up: number;
  down: number;
}

interface FabricStats {
  health: number;
  spines: { count: number; health: number };
  leafs: { count: number; health: number };
  borderleafs: { count: number; health: number };
  superspines: { count: number; health: number };
}

function StatCard({ label, value, healthIndicator }: { label: string; value: string | number; healthIndicator?: number }) {
  const getHealthColor = (h: number | undefined) => {
    if (h === undefined) return 'bg-status-info';
    if (h >= 90) return 'bg-status-success';
    if (h >= 50) return 'bg-status-warning';
    return 'bg-status-error';
  };

  return (
    <div className="bg-vscode-bg-secondary border border-vscode-border rounded-xl p-6 transition-all relative overflow-hidden hover:-translate-y-1 hover:shadow-lg hover:border-vscode-accent">
      <div className="text-vscode-text-secondary text-xs uppercase tracking-wide mb-2">{label}</div>
      <div className="flex items-center gap-2">
        <div className="text-2xl font-bold mb-1">{value}</div>
        {healthIndicator !== undefined && (
          <div className={`size-3 rounded-full shrink-0 ${getHealthColor(healthIndicator)}`}></div>
        )}
      </div>
    </div>
  );
}

const initialNodeStats: NodeStats = { total: 0, synced: 0, notSynced: 0 };
const initialInterfaceStats: InterfaceStats = { total: 0, up: 0, down: 0 };
const initialFabricStats: FabricStats = {
  health: 0,
  spines: { count: 0, health: 0 },
  leafs: { count: 0, health: 0 },
  borderleafs: { count: 0, health: 0 },
  superspines: { count: 0, health: 0 }
};

function FabricDashboard() {
  const postMessage = usePostMessage();
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [echartsLoaded, setEchartsLoaded] = useState(false);

  // Consolidated state objects
  const [nodeStats, setNodeStats] = useState<NodeStats>(initialNodeStats);
  const [interfaceStats, setInterfaceStats] = useState<InterfaceStats>(initialInterfaceStats);
  const [fabricStats, setFabricStats] = useState<FabricStats>(initialFabricStats);

  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<any>(null);
  const trafficPointsRef = useRef<TrafficPoint[]>([]);
  const trafficUnitRef = useRef('bit/s');
  const trafficDivRef = useRef(1);

  // Load ECharts
  useEffect(() => {
    if (typeof echarts !== 'undefined') {
      setEchartsLoaded(true);
    }
  }, []);

  // Initialize chart when ECharts is loaded
  useEffect(() => {
    if (!echartsLoaded || !chartRef.current) return;

    const chartTheme = {
      color: ['#60a5fa', '#4ade80', '#fbbf24', '#f87171', '#a78bfa', '#f472b6'],
      backgroundColor: 'transparent',
      textStyle: {
        color: getComputedStyle(document.documentElement).getPropertyValue('--text-primary')
      }
    };

    chartInstanceRef.current = echarts.init(chartRef.current, chartTheme);

    chartInstanceRef.current.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => {
          const [incoming, outgoing] = params;
          return (
            incoming.axisValue +
            '<br/>Inbound: ' +
            incoming.data +
            ' ' +
            trafficUnitRef.current +
            '<br/>Outbound: ' +
            outgoing.data +
            ' ' +
            trafficUnitRef.current
          );
        }
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
        data: [],
        axisLabel: {
          color: chartTheme.textStyle.color
        }
      },
      yAxis: {
        type: 'value',
        name: 'Traffic (bit/s)',
        axisLabel: {
          color: chartTheme.textStyle.color
        }
      },
      series: [
        {
          name: 'Inbound',
          type: 'line',
          smooth: true,
          data: [],
          areaStyle: { opacity: 0.3 },
          itemStyle: { color: '#60a5fa' }
        },
        {
          name: 'Outbound',
          type: 'line',
          smooth: true,
          data: [],
          areaStyle: { opacity: 0.3 },
          itemStyle: { color: '#a78bfa' }
        }
      ]
    });

    const handleResize = () => {
      chartInstanceRef.current?.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chartInstanceRef.current?.dispose();
    };
  }, [echartsLoaded]);

  const updateTrafficChart = useCallback((inVal: number, outVal: number) => {
    const now = Date.now();
    trafficPointsRef.current.push({ time: now, inbound: inVal, outbound: outVal });
    const cutoff = now - 60000;
    while (trafficPointsRef.current.length && trafficPointsRef.current[0].time < cutoff) {
      trafficPointsRef.current.shift();
    }

    const maxVal = trafficPointsRef.current.reduce((m, p) => Math.max(m, p.inbound, p.outbound), 0);
    if (maxVal >= 1e9) {
      trafficUnitRef.current = 'Gbit/s';
      trafficDivRef.current = 1e9;
    } else if (maxVal >= 1e6) {
      trafficUnitRef.current = 'Mbit/s';
      trafficDivRef.current = 1e6;
    } else if (maxVal >= 1e3) {
      trafficUnitRef.current = 'Kbit/s';
      trafficDivRef.current = 1e3;
    } else {
      trafficUnitRef.current = 'bit/s';
      trafficDivRef.current = 1;
    }

    const trafficTimes = trafficPointsRef.current.map(p =>
      new Date(p.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    );
    const inboundData = trafficPointsRef.current.map(p => +(p.inbound / trafficDivRef.current).toFixed(2));
    const outboundData = trafficPointsRef.current.map(p => +(p.outbound / trafficDivRef.current).toFixed(2));

    chartInstanceRef.current?.setOption({
      xAxis: { data: trafficTimes },
      yAxis: { name: 'Traffic (' + trafficUnitRef.current + ')' },
      series: [{ data: inboundData }, { data: outboundData }]
    });
  }, []);

  const clearTrafficChart = useCallback(() => {
    trafficPointsRef.current = [];
    trafficUnitRef.current = 'bit/s';
    trafficDivRef.current = 1;
    chartInstanceRef.current?.setOption({
      xAxis: { data: [] },
      yAxis: { name: 'Traffic (bit/s)' },
      series: [{ data: [] }, { data: [] }]
    });
  }, []);

  const handleMessage = useCallback((msg: FabricMessage) => {
    switch (msg.command) {
      case 'init':
        setNamespaces(msg.namespaces || []);
        setSelectedNamespace(msg.selected || (msg.namespaces?.[0] || ''));
        break;
      case 'topoNodeStats':
        if (msg.stats) {
          setNodeStats({
            total: msg.stats.total ?? 0,
            synced: msg.stats.synced ?? 0,
            notSynced: msg.stats.notSynced ?? 0
          });
        }
        break;
      case 'interfaceStats':
        if (msg.stats) {
          setInterfaceStats({
            total: msg.stats.total ?? 0,
            up: msg.stats.up ?? 0,
            down: msg.stats.down ?? 0
          });
        }
        break;
      case 'trafficStats':
        if (msg.stats) {
          updateTrafficChart(msg.stats.in ?? 0, msg.stats.out ?? 0);
        }
        break;
      case 'clearTrafficData':
        clearTrafficChart();
        break;
      case 'fabricSpineStats':
        if (msg.stats) {
          setFabricStats(prev => ({
            ...prev,
            spines: { count: msg.stats!.count ?? 0, health: msg.stats!.health ?? 0 }
          }));
        }
        break;
      case 'fabricLeafStats':
        if (msg.stats) {
          setFabricStats(prev => ({
            ...prev,
            leafs: { count: msg.stats!.count ?? 0, health: msg.stats!.health ?? 0 }
          }));
        }
        break;
      case 'fabricBorderLeafStats':
        if (msg.stats) {
          setFabricStats(prev => ({
            ...prev,
            borderleafs: { count: msg.stats!.count ?? 0, health: msg.stats!.health ?? 0 }
          }));
        }
        break;
      case 'fabricSuperSpineStats':
        if (msg.stats) {
          setFabricStats(prev => ({
            ...prev,
            superspines: { count: msg.stats!.count ?? 0, health: msg.stats!.health ?? 0 }
          }));
        }
        break;
      case 'fabricHealth':
        setFabricStats(prev => ({ ...prev, health: msg.health ?? 0 }));
        break;
    }
  }, [updateTrafficChart, clearTrafficChart]);

  useMessageListener<FabricMessage>(handleMessage);

  useReadySignal();

  const handleNamespaceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const ns = e.target.value;
    setSelectedNamespace(ns);
    postMessage({ command: 'getTopoNodeStats', namespace: ns });
  }, [postMessage]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold mb-1 bg-linear-to-r from-vscode-accent to-status-info bg-clip-text text-transparent">
            Fabric Network Dashboard
          </h1>
          <p className="text-sm text-vscode-text-secondary">
            Real-time monitoring and analytics for your network infrastructure
          </p>
        </div>
        <select
          className="bg-vscode-input-bg text-vscode-input-fg border border-vscode-input-border rounded px-2 py-1"
          value={selectedNamespace}
          onChange={handleNamespaceChange}
        >
          {namespaces.map(ns => (
            <option key={ns} value={ns}>{ns}</option>
          ))}
        </select>
      </header>

      <div className="grid gap-5 mb-8 grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
        <StatCard label="Total Nodes" value={nodeStats.total} />
        <StatCard label="Synced Nodes" value={nodeStats.synced} />
        <StatCard label="Not Synced" value={nodeStats.notSynced} />
      </div>

      <div className="grid gap-5 mb-8 xl:grid-cols-[auto_1fr]">
        <div className="flex flex-col gap-5 w-70 sm:flex-row xl:flex-col xl:w-70 sm:w-full">
          <StatCard label="Total Interfaces" value={interfaceStats.total} />
          <StatCard label="Up Interfaces" value={interfaceStats.up} />
          <StatCard label="Down Interfaces" value={interfaceStats.down} />
        </div>

        <div className="bg-vscode-bg-secondary border border-vscode-border rounded-xl p-6 transition-all hover:border-vscode-accent hover:shadow-md flex-1">
          <div className="text-lg font-semibold mb-4 flex items-center justify-between">
            <span>Traffic Rate</span>
          </div>
          <div ref={chartRef} className="h-75"></div>
        </div>
      </div>

      <div className="grid gap-5 mb-8 grid-cols-5">
        <StatCard label="Fabric Health" value={`${fabricStats.health}%`} healthIndicator={fabricStats.health} />
        <StatCard label="Spines" value={fabricStats.spines.count} healthIndicator={fabricStats.spines.health} />
        <StatCard label="Leafs" value={fabricStats.leafs.count} healthIndicator={fabricStats.leafs.health} />
        <StatCard label="Borderleafs" value={fabricStats.borderleafs.count} healthIndicator={fabricStats.borderleafs.health} />
        <StatCard label="Superspines" value={fabricStats.superspines.count} healthIndicator={fabricStats.superspines.health} />
      </div>
    </div>
  );
}

// Get echartsUri from script tag before React takes over
const currentScript = document.currentScript as HTMLScriptElement | null;
const echartsUri = currentScript?.dataset.echartsUri || '';

// Load echarts first, then render React
function loadEchartsAndRender() {
  if (echartsUri) {
    const script = document.createElement('script');
    script.src = echartsUri;
    script.onload = renderApp;
    document.body.appendChild(script);
  } else {
    renderApp();
  }
}

function renderApp() {
  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(
      <VSCodeProvider>
        <FabricDashboard />
      </VSCodeProvider>
    );
  }
}

loadEchartsAndRender();
