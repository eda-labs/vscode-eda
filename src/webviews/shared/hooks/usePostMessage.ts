import { useCallback } from 'react';

import { getVSCodeApi } from './useVSCodeApi';

export function usePostMessage<T = unknown>(): (message: T) => void {
  return useCallback((message: T) => {
    getVSCodeApi().postMessage(message);
  }, []);
}
