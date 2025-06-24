export interface EdaCrd {
  kind: string;
  group: string;
  version: string;
  plural: string;
  namespaced: boolean;
  description?: string;
}
