import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Card, CardContent, FormControl, Grid, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';

import { usePostMessage, useMessageListener, useReadySignal } from '../../shared/hooks';
import { VSCodeProvider } from '../../shared/context';
import { WebviewThemeProvider } from '../../shared/theme';

// ECharts type definitions for CDN-loaded library
interface EChartsInstance {
  setOption(option: EChartsOption): void;
  resize(): void;
  dispose(): void;
}

interface EChartsTheme {
  color?: string[];
  backgroundColor?: string;
  textStyle?: { color: string };
}

interface EChartsOption {
  tooltip?: {
    trigger?: string;
    formatter?: (params: TooltipParam[]) => string;
  };
  legend?: {
    data?: string[];
    textStyle?: { color: string };
  };
  grid?: {
    left?: string;
    right?: string;
    bottom?: string;
    containLabel?: boolean;
  };
  xAxis?: {
    type?: string;
    boundaryGap?: boolean;
    data?: string[];
    axisLabel?: { color: string };
  };
  yAxis?: {
    type?: string;
    name?: string;
    axisLabel?: { color: string };
  };
  series?: Array<{
    name?: string;
    type?: string;
    smooth?: boolean;
    data?: number[];
    areaStyle?: { opacity: number };
    itemStyle?: { color: string };
  }>;
}

interface TooltipParam {
  axisValue: string;
  data: number;
}

interface EChartsStatic {
  init(dom: HTMLElement, theme?: EChartsTheme): EChartsInstance;
}

declare const echarts: EChartsStatic | undefined;

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

function StatCard({ label, value, healthIndicator }: Readonly<{ label: string; value: string | number; healthIndicator?: number }>) {
  const getHealthColor = (h: number | undefined) => {
    if (h === undefined) return 'info.main';
    if (h >= 90) return 'success.main';
    if (h >= 50) return 'warning.main';
    return 'error.main';
  };

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>{value}</Typography>
          {healthIndicator !== undefined && (
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: getHealthColor(healthIndicator)
              }}
            />
          )}
        </Stack>
      </CardContent>
    </Card>
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

// Helper functions to extract stats from messages
function extractNodeStats(stats: FabricMessage['stats']): NodeStats {
  return {
    total: stats?.total ?? 0,
    synced: stats?.synced ?? 0,
    notSynced: stats?.notSynced ?? 0
  };
}

function extractInterfaceStats(stats: FabricMessage['stats']): InterfaceStats {
  return {
    total: stats?.total ?? 0,
    up: stats?.up ?? 0,
    down: stats?.down ?? 0
  };
}

function extractFabricNodeStats(stats: FabricMessage['stats']): { count: number; health: number } {
  return { count: stats?.count ?? 0, health: stats?.health ?? 0 };
}

type FabricNodeType = 'spines' | 'leafs' | 'borderleafs' | 'superspines';

function updateFabricNodeStats(
  nodeType: FabricNodeType,
  stats: FabricMessage['stats'],
  setFabricStats: React.Dispatch<React.SetStateAction<FabricStats>>
): void {
  if (stats) {
    setFabricStats(prev => ({
      ...prev,
      [nodeType]: extractFabricNodeStats(stats)
    }));
  }
}

// Map fabric node commands to their node types
const fabricNodeCommands: Record<string, FabricNodeType> = {
  fabricSpineStats: 'spines',
  fabricLeafStats: 'leafs',
  fabricBorderLeafStats: 'borderleafs',
  fabricSuperSpineStats: 'superspines'
};

interface MessageHandlers {
  setNamespaces: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedNamespace: React.Dispatch<React.SetStateAction<string>>;
  setNodeStats: React.Dispatch<React.SetStateAction<NodeStats>>;
  setInterfaceStats: React.Dispatch<React.SetStateAction<InterfaceStats>>;
  setFabricStats: React.Dispatch<React.SetStateAction<FabricStats>>;
  updateTrafficChart: (inVal: number, outVal: number) => void;
  clearTrafficChart: () => void;
}

function handleInitMessage(msg: FabricMessage, handlers: MessageHandlers): void {
  handlers.setNamespaces(msg.namespaces || []);
  handlers.setSelectedNamespace(msg.selected || (msg.namespaces?.[0] || ''));
}

function handleTopoNodeStatsMessage(msg: FabricMessage, handlers: MessageHandlers): void {
  if (msg.stats) {
    handlers.setNodeStats(extractNodeStats(msg.stats));
  }
}

function handleInterfaceStatsMessage(msg: FabricMessage, handlers: MessageHandlers): void {
  if (msg.stats) {
    handlers.setInterfaceStats(extractInterfaceStats(msg.stats));
  }
}

function handleTrafficStatsMessage(msg: FabricMessage, handlers: MessageHandlers): void {
  if (msg.stats) {
    handlers.updateTrafficChart(msg.stats.in ?? 0, msg.stats.out ?? 0);
  }
}

function handleFabricHealthMessage(msg: FabricMessage, handlers: MessageHandlers): void {
  handlers.setFabricStats(prev => ({ ...prev, health: msg.health ?? 0 }));
}

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
  const chartInstanceRef = useRef<EChartsInstance | null>(null);
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
        color: getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-foreground').trim()
      }
    };

    if (!echarts) return;
    chartInstanceRef.current = echarts.init(chartRef.current, chartTheme);

    chartInstanceRef.current.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: (params: TooltipParam[]) => {
          const [incoming, outgoing] = params;
          return (
            incoming.axisValue +
            '<br/>Inbound: ' +
            String(incoming.data) +
            ' ' +
            trafficUnitRef.current +
            '<br/>Outbound: ' +
            String(outgoing.data) +
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
    const handlers: MessageHandlers = {
      setNamespaces,
      setSelectedNamespace,
      setNodeStats,
      setInterfaceStats,
      setFabricStats,
      updateTrafficChart,
      clearTrafficChart
    };

    // Handle fabric node stats commands
    if (msg.command in fabricNodeCommands) {
      updateFabricNodeStats(fabricNodeCommands[msg.command], msg.stats, setFabricStats);
      return;
    }

    // Handle other commands using extracted helper functions
    const commandHandlers: Record<string, (m: FabricMessage, h: MessageHandlers) => void> = {
      init: handleInitMessage,
      topoNodeStats: handleTopoNodeStatsMessage,
      interfaceStats: handleInterfaceStatsMessage,
      trafficStats: handleTrafficStatsMessage,
      clearTrafficData: () => handlers.clearTrafficChart(),
      fabricHealth: handleFabricHealthMessage
    };

    commandHandlers[msg.command]?.(msg, handlers);
  }, [updateTrafficChart, clearTrafficChart]);

  useMessageListener<FabricMessage>(handleMessage);

  useReadySignal();

  const handleNamespaceChange = useCallback((ns: string) => {
    setSelectedNamespace(ns);
    postMessage({ command: 'getTopoNodeStats', namespace: ns });
  }, [postMessage]);

  return (
    <Box sx={{ p: 3, maxWidth: 1600, mx: 'auto' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2} sx={{ mb: 4 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Fabric Network Dashboard</Typography>
          <Typography variant="body2" color="text.secondary">
            Real-time monitoring and analytics for your network infrastructure
          </Typography>
        </Box>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel id="fabric-namespace">Namespace</InputLabel>
          <Select
            labelId="fabric-namespace"
            value={selectedNamespace}
            label="Namespace"
            onChange={(event) => handleNamespaceChange(String(event.target.value))}
          >
            {namespaces.map(ns => (
              <MenuItem key={ns} value={ns}>{ns}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, md: 4 }}><StatCard label="Total Nodes" value={nodeStats.total} /></Grid>
        <Grid size={{ xs: 12, md: 4 }}><StatCard label="Synced Nodes" value={nodeStats.synced} /></Grid>
        <Grid size={{ xs: 12, md: 4 }}><StatCard label="Not Synced" value={nodeStats.notSynced} /></Grid>
      </Grid>

      <Grid container spacing={2.5} sx={{ mb: 4 }} alignItems="stretch">
        <Grid size={{ xs: 12, lg: 3 }}>
          <Stack spacing={2.5} sx={{ height: '100%' }}>
            <StatCard label="Total Interfaces" value={interfaceStats.total} />
            <StatCard label="Up Interfaces" value={interfaceStats.up} />
            <StatCard label="Down Interfaces" value={interfaceStats.down} />
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, lg: 9 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Traffic Rate</Typography>
              <Box ref={chartRef} sx={{ height: 300 }} />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))'
        }}
      >
        <StatCard label="Fabric Health" value={`${fabricStats.health}%`} healthIndicator={fabricStats.health} />
        <StatCard label="Spines" value={fabricStats.spines.count} healthIndicator={fabricStats.spines.health} />
        <StatCard label="Leafs" value={fabricStats.leafs.count} healthIndicator={fabricStats.leafs.health} />
        <StatCard label="Borderleafs" value={fabricStats.borderleafs.count} healthIndicator={fabricStats.borderleafs.health} />
        <StatCard label="Superspines" value={fabricStats.superspines.count} healthIndicator={fabricStats.superspines.health} />
      </Box>
    </Box>
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
        <WebviewThemeProvider>
          <FabricDashboard />
        </WebviewThemeProvider>
      </VSCodeProvider>
    );
  }
}

loadEchartsAndRender();
