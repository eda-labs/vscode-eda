declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

let vscodeApi: ReturnType<typeof acquireVsCodeApi> | null = null;

export function getVSCodeApi(): ReturnType<typeof acquireVsCodeApi> {
  if (!vscodeApi) {
    vscodeApi = acquireVsCodeApi();
  }
  return vscodeApi;
}

export function useVSCodeApi(): ReturnType<typeof acquireVsCodeApi> {
  return getVSCodeApi();
}
