import React, { useState, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Card, CardContent, FormControl, Grid, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { LineChart } from '@mui/x-charts/LineChart';

import { usePostMessage, useMessageListener, useReadySignal } from '../../shared/hooks';
import { VSCodeProvider } from '../../shared/context';
import { WebviewThemeProvider } from '../../shared/theme';

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

interface TrafficChartData {
  times: Date[];
  inbound: number[];
  outbound: number[];
  unit: string;
  windowStart: Date;
  windowEnd: Date;
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
  const theme = useTheme();
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState('');

  // Consolidated state objects
  const [nodeStats, setNodeStats] = useState<NodeStats>(initialNodeStats);
  const [interfaceStats, setInterfaceStats] = useState<InterfaceStats>(initialInterfaceStats);
  const [fabricStats, setFabricStats] = useState<FabricStats>(initialFabricStats);
  const [trafficChartData, setTrafficChartData] = useState<TrafficChartData>(() => {
    const now = new Date();
    return {
      times: [],
      inbound: [],
      outbound: [],
      unit: 'bit/s',
      windowStart: now,
      windowEnd: new Date(now.getTime() + 60000),
    };
  });

  const trafficPointsRef = useRef<TrafficPoint[]>([]);
  const trafficStartRef = useRef<number>(0);
  const trafficUnitRef = useRef('bit/s');
  const trafficDivRef = useRef(1);
  const chartVisual = useMemo(() => {
    const { charts } = theme.vscode;
    return {
      inboundColor: charts.blue,
      outboundColor: charts.purple
    };
  }, [theme]);

  const updateTrafficChart = useCallback((inVal: number, outVal: number) => {
    const now = Date.now();
    trafficPointsRef.current.push({ time: now, inbound: inVal, outbound: outVal });

    // Record the start time on the first data point
    if (trafficStartRef.current === 0) {
      trafficStartRef.current = now;
    }

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

    const points = trafficPointsRef.current;
    const div = trafficDivRef.current;
    const trafficTimes = points.map(p => new Date(p.time));
    const inboundData = points.map(p => +(p.inbound / div).toFixed(2));
    const outboundData = points.map(p => +(p.outbound / div).toFixed(2));

    // Fixed 60-second window: starts at first data point, slides after 60s
    const windowStart = new Date(points[0].time);
    const windowEnd = new Date(Math.max(points[0].time + 60000, now));

    setTrafficChartData({
      times: trafficTimes,
      inbound: inboundData,
      outbound: outboundData,
      unit: trafficUnitRef.current,
      windowStart,
      windowEnd,
    });
  }, []);

  const clearTrafficChart = useCallback(() => {
    trafficPointsRef.current = [];
    trafficStartRef.current = 0;
    trafficUnitRef.current = 'bit/s';
    trafficDivRef.current = 1;
    const now = new Date();
    setTrafficChartData({
      times: [],
      inbound: [],
      outbound: [],
      unit: 'bit/s',
      windowStart: now,
      windowEnd: new Date(now.getTime() + 60000),
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
              <LineChart
                skipAnimation
                height={300}
                margin={{ left: 70, right: 24, top: 16, bottom: 36 }}
                grid={{ horizontal: true }}
                xAxis={[{
                  scaleType: 'time',
                  data: trafficChartData.times,
                  min: trafficChartData.windowStart,
                  max: trafficChartData.windowEnd,
                  valueFormatter: (date: Date) =>
                    date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                  tickNumber: 5,
                }]}
                yAxis={[{
                  label: `Traffic (${trafficChartData.unit})`,
                  min: 0,
                }]}
                series={[
                  {
                    id: 'inbound',
                    label: 'Inbound',
                    data: trafficChartData.inbound,
                    color: chartVisual.inboundColor,
                    showMark: false,
                    area: true,
                    curve: 'monotoneX',
                    valueFormatter: value => `${value ?? 0} ${trafficChartData.unit}`,
                  },
                  {
                    id: 'outbound',
                    label: 'Outbound',
                    data: trafficChartData.outbound,
                    color: chartVisual.outboundColor,
                    showMark: false,
                    area: true,
                    curve: 'monotoneX',
                    valueFormatter: value => `${value ?? 0} ${trafficChartData.unit}`,
                  }
                ]}
                sx={{
                  '.MuiAreaElement-series-inbound': { fill: 'url(#inbound-gradient)' },
                  '.MuiAreaElement-series-outbound': { fill: 'url(#outbound-gradient)' },
                }}
              >
                <defs>
                  <linearGradient id="inbound-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartVisual.inboundColor} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={chartVisual.inboundColor} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="outbound-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartVisual.outboundColor} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={chartVisual.outboundColor} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
              </LineChart>
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

renderApp();
