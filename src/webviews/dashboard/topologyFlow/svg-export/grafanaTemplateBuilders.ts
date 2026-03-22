import type {
  GrafanaDashboardJsonOptions,
  GrafanaEdgeCellMapping,
  GrafanaPanelYamlOptions,
  GrafanaTrafficThresholds
} from "./grafanaExport";

interface GrafanaDashboardTargetConfig {
  datasource: string;
  expr: string;
  legendFormat: string;
  instant: boolean;
  range: boolean;
  hide?: boolean;
}

const RATE_LABEL_HIDE_TAG = "hide-rates";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function escapePromQlStringLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildNamespaceMatcher(namespaceName?: string): string {
  const normalizedNamespaceName = asString(namespaceName);
  if (normalizedNamespaceName === null) return "";
  return `{namespace_name="${escapePromQlStringLiteral(normalizedNamespaceName)}"}`;
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function normalizeMetricNodeName(nodeId: string): string {
  const parts = nodeId.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) return nodeId;
  return parts[parts.length - 1];
}

function normalizeMetricInterfaceName(interfaceName: string): string {
  if (interfaceName.includes("/")) return interfaceName;

  const parts = interfaceName.split("-");
  const lowerHead = parts[0]?.toLowerCase() ?? "";
  if (lowerHead !== "ethernet" || parts.length < 3) {
    return interfaceName;
  }

  return `${parts[0]}-${parts[1]}/${parts.slice(2).join("/")}`;
}

function asValidYamlNumber(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

export function buildGrafanaPanelYamlInternal(
  mappings: GrafanaEdgeCellMapping[],
  defaults: GrafanaTrafficThresholds,
  options: GrafanaPanelYamlOptions = {}
): string {
  const trafficThresholds = options.trafficThresholds ?? defaults;
  const includeHideRatesLegendToggle = options.includeHideRatesLegendToggle !== false;
  const greenThreshold = asValidYamlNumber(
    trafficThresholds.green,
    defaults.green
  );
  const yellowThreshold = asValidYamlNumber(
    trafficThresholds.yellow,
    defaults.yellow
  );
  const orangeThreshold = asValidYamlNumber(
    trafficThresholds.orange,
    defaults.orange
  );
  const redThreshold = asValidYamlNumber(
    trafficThresholds.red,
    defaults.red
  );
  const lines: string[] = [
    "---",
    "anchors:",
    "  thresholds-operstate: &thresholds-operstate",
    '    - { color: "red", level: 0 }',
    '    - { color: "green", level: 1 }',
    "  thresholds-traffic: &thresholds-traffic",
    '    - { color: "gray", level: 0 }',
    `    - { color: "green", level: ${greenThreshold} }`,
    `    - { color: "yellow", level: ${yellowThreshold} }`,
    `    - { color: "orange", level: ${orangeThreshold} }`,
    `    - { color: "red", level: ${redThreshold} }`,
    "  thresholds-rate-label: &thresholds-rate-label",
    '    - { color: "white", level: 0 }',
    "  label-config: &label-config",
    '    separator: "replace"',
    '    units: "bps"',
    "    decimalPoints: 1",
    "    valueMappings:",
    `      - { valueMax: ${greenThreshold}, text: "\\u200B" }`,
    'cellIdPreamble: "cell-"',
    "cells:"
  ];
  if (includeHideRatesLegendToggle) {
    lines.splice(
      lines.length - 1,
      0,
      "tagConfig:",
      `  legend: ["${RATE_LABEL_HIDE_TAG}"]`,
      "  lowlightAlphaFactor: 0",
      "  highlightRgbFactor: 1"
    );
  }

  if (mappings.length === 0) {
    lines.push("  {}");
    return `${lines.join("\n")}\n`;
  }

  for (const mapping of mappings) {
    const sourceMetricNode = normalizeMetricNodeName(mapping.source);
    const targetMetricNode = normalizeMetricNodeName(mapping.target);
    const sourceMetricInterface = normalizeMetricInterfaceName(mapping.sourceEndpoint);
    const targetMetricInterface = normalizeMetricInterfaceName(mapping.targetEndpoint);

    const operstateDataRef = `oper-state:${sourceMetricNode}:${sourceMetricInterface}`;
    const targetOperstateDataRef = `oper-state:${targetMetricNode}:${targetMetricInterface}`;
    const trafficDataRef = `${sourceMetricNode}:${sourceMetricInterface}:out`;
    const reverseTrafficDataRef = `${targetMetricNode}:${targetMetricInterface}:out`;
    lines.push(`  ${quoteYaml(mapping.operstateCellId)}:`);
    lines.push(`    dataRef: ${quoteYaml(operstateDataRef)}`);
    lines.push("    fillColor:");
    lines.push("      thresholds: *thresholds-operstate");
    if (includeHideRatesLegendToggle) {
      lines.push(`    tags: ["${RATE_LABEL_HIDE_TAG}"]`);
    }
    lines.push(`  ${quoteYaml(mapping.targetOperstateCellId)}:`);
    lines.push(`    dataRef: ${quoteYaml(targetOperstateDataRef)}`);
    lines.push("    fillColor:");
    lines.push("      thresholds: *thresholds-operstate");
    if (includeHideRatesLegendToggle) {
      lines.push(`    tags: ["${RATE_LABEL_HIDE_TAG}"]`);
    }
    lines.push(`  ${quoteYaml(mapping.trafficCellId)}:`);
    lines.push(`    dataRef: ${quoteYaml(trafficDataRef)}`);
    lines.push("    strokeColor:");
    lines.push("      thresholds: *thresholds-traffic");
    if (includeHideRatesLegendToggle) {
      lines.push(`    tags: ["${RATE_LABEL_HIDE_TAG}"]`);
    }
    lines.push(`  ${quoteYaml(`${mapping.trafficCellId}:label`)}:`);
    lines.push(`    dataRef: ${quoteYaml(trafficDataRef)}`);
    lines.push("    label: *label-config");
    lines.push("    labelColor:");
    lines.push("      thresholds: *thresholds-rate-label");
    lines.push(`  ${quoteYaml(mapping.reverseTrafficCellId)}:`);
    lines.push(`    dataRef: ${quoteYaml(reverseTrafficDataRef)}`);
    lines.push("    strokeColor:");
    lines.push("      thresholds: *thresholds-traffic");
    if (includeHideRatesLegendToggle) {
      lines.push(`    tags: ["${RATE_LABEL_HIDE_TAG}"]`);
    }
    lines.push(`  ${quoteYaml(`${mapping.reverseTrafficCellId}:label`)}:`);
    lines.push(`    dataRef: ${quoteYaml(reverseTrafficDataRef)}`);
    lines.push("    label: *label-config");
    lines.push("    labelColor:");
    lines.push("      thresholds: *thresholds-rate-label");
  }

  return `${lines.join("\n")}\n`;
}

function buildDashboardTargets(namespaceName?: string) {
  const namespaceMatcher = buildNamespaceMatcher(namespaceName);
  const targetConfigs: GrafanaDashboardTargetConfig[] = [
    {
      datasource: "prometheus",
      expr: "node_srl_interface_oper_state",
      legendFormat: "oper-state:{{node_name}}:{{interface_name}}",
      instant: false,
      range: true,
      hide: false
    },
    {
      datasource: "prometheus",
      expr: `last_over_time(node_srl_interface_traffic_rate_out_bps${namespaceMatcher}[20s])`,
      legendFormat: "{{node_name}}:{{interface_name}}:out",
      instant: false,
      range: true,
      hide: false
    },
    {
      datasource: "prometheus",
      expr: `last_over_time(node_srl_interface_traffic_rate_in_bps${namespaceMatcher}[20s])`,
      legendFormat: "{{node_name}}:{{interface_name}}:in",
      instant: false,
      range: true,
      hide: false
    }
  ];

  return targetConfigs.map((target, index) => ({
    datasource: { type: target.datasource },
    editorMode: "code",
    expr: target.expr,
    hide: target.hide ?? false,
    instant: target.instant,
    legendFormat: target.legendFormat,
    range: target.range,
    refId: String.fromCharCode("A".charCodeAt(0) + index)
  }));
}

export function buildGrafanaDashboardJsonInternal(
  panelConfigYaml: string,
  svgContent: string,
  dashboardTitle: string,
  options: GrafanaDashboardJsonOptions = {}
): string {
  const title = dashboardTitle.trim() || "Network Telemetry";
  const dashboard = {
    annotations: {
      list: [
        {
          builtIn: 1,
          datasource: { type: "prometheus" },
          enable: true,
          hide: true,
          iconColor: "rgba(0, 211, 255, 1)",
          name: "Annotations & Alerts",
          type: "dashboard"
        }
      ]
    },
    editable: true,
    fiscalYearStartMonth: 0,
    graphTooltip: 0,
    id: 3,
    links: [],
    liveNow: false,
    panels: [
      {
        datasource: { type: "prometheus" },
        gridPos: { h: 23, w: 13, x: 0, y: 0 },
        id: 1,
        options: {
          animationControlEnabled: true,
          animationsEnabled: true,
          debuggingCtr: {
            colorsCtr: 1,
            dataCtr: 0,
            displaySvgCtr: 0,
            mappingsCtr: 0,
            timingsCtr: 0
          },
          highlighterEnabled: true,
          panZoomEnabled: true,
          panelConfig: panelConfigYaml,
          siteConfig: "",
          svg: svgContent,
          testDataEnabled: false,
          timeSliderEnabled: true
        },
        targets: buildDashboardTargets(options.namespaceName),
        title,
        type: "andrewbmchugh-flow-panel"
      }
    ],
    refresh: "5s",
    schemaVersion: 38,
    tags: [],
    time: { from: "now-5m", to: "now" },
    timepicker: {},
    timezone: "",
    title,
    version: 6,
    weekStart: ""
  };

  return JSON.stringify(dashboard, null, 2);
}
