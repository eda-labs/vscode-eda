// src/services/types.ts
// EDA transaction interface
export interface EdaTransaction {
  id: string;
  result: string;
  age: string;
  detail: string;
  dryRun: string;
  username: string;
  description: string;
}

// Interface for CRD information
export interface CrdInfo {
  name: string;     // e.g. "fabrics.eda.nokia.com"
  apiGroup: string; // e.g. "eda.nokia.com"
  kind: string;     // e.g. "Fabric"
  version: string;  // e.g. "v1alpha1"
}

export interface EdaAlarm {
  "clusterSpecific": string;
  "description": string;
  "group": string;
  "jspath": string;
  "kind": string;
  "name": string;
  "namespace.name": string;
  "parentAlarm": string;
  "probableCause": string;
  "remedialAction": string;
  "resource": string;
  "severity": string;           // e.g. "critical"
  "sourceGroup": string;
  "sourceKind": string;
  "sourceResource": string;
  "type": string;
}

export interface EdaDeviation {
  apiVersion: string;
  kind: string;
  name: string;
  "namespace.name": string;
}

// Interface for the deviation specification
export interface DeviationSpec {
  nodeEndpoint: string;
  path: string;
  associatedCrs?: any[];
  intendedValues?: string;
  runningValues?: string;
  operation?: string;
  accepted?: boolean;
}

// Interface for the full deviation object
export interface DeviationResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    [key: string]: any;
  };
  spec: DeviationSpec;
}

export interface CrdVersion {
  name: string;
  served?: boolean;
  storage?: boolean;
  schema?: {
    openAPIV3Schema?: any;
  };
}

/**
 * Interface for a K8s resource with minimum required fields
 */
export interface K8sResource {
  apiVersion?: string;
  kind: string;
  metadata?: {
    name: string;
    namespace?: string;
    [key: string]: any;
  };
  [key: string]: any;
}