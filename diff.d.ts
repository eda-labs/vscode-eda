declare module 'diff';

declare module '@eda-labs/topo-builder' {
  import type { ComponentType, ReactNode } from 'react';
  import type { Theme, ThemeOptions } from '@mui/material/styles';

  export interface TopologyEditorProps {
    renderYamlPanel?: () => ReactNode;
    theme?: Theme;
    themeOptions?: ThemeOptions;
    disableCssBaseline?: boolean;
    styleVariables?: Record<string, string>;
    reactFlowColorMode?: 'light' | 'dark';
  }

  export interface TopologyStoreState {
    topologyName: string;
    namespace: string;
    operation: string;
    nodes: unknown[];
    edges: unknown[];
    nodeTemplates: unknown[];
    linkTemplates: unknown[];
    simulation?: unknown;
    annotations?: unknown[];
    yamlRefreshCounter: number;
    importFromYaml: (yaml: string) => boolean;
    error: string | null;
    setError: (error: string | null) => void;
  }

  export const TopologyEditor: ComponentType<TopologyEditorProps>;
  export function useTopologyStore<T>(selector: (state: TopologyStoreState) => T): T;
  export function exportToYaml(options: {
    topologyName: string;
    namespace: string;
    operation: string;
    nodes: unknown[];
    edges: unknown[];
    nodeTemplates: unknown[];
    linkTemplates: unknown[];
    simulation?: unknown;
    annotations?: unknown[];
  }): string;
}

declare module '@eda-labs/topo-builder/styles.css';
