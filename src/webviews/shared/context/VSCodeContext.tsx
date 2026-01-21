import type { ReactNode} from 'react';
import { createContext, useContext, useCallback, useEffect, useRef } from 'react';

import { getVSCodeApi } from '../hooks/useVsCodeApi';
import type { WebviewMessage } from '../hooks/useMessageListener';

interface VSCodeContextValue {
  postMessage: <T>(message: T) => void;
  getState: <T>() => T | undefined;
  setState: <T>(state: T) => void;
}

const VSCodeContext = createContext<VSCodeContextValue | null>(null);

interface VSCodeProviderProps {
  children: ReactNode;
}

export function VSCodeProvider({ children }: Readonly<VSCodeProviderProps>) {
  const api = getVSCodeApi();

  const postMessage = useCallback(<T,>(message: T) => {
    api.postMessage(message);
  }, [api]);

  const getState = useCallback(<T,>() => {
    return api.getState() as T | undefined;
  }, [api]);

  const setState = useCallback(<T,>(state: T) => {
    api.setState(state);
  }, [api]);

  return (
    <VSCodeContext.Provider value={{ postMessage, getState, setState }}>
      {children}
    </VSCodeContext.Provider>
  );
}

export function useVSCodeContext(): VSCodeContextValue {
  const context = useContext(VSCodeContext);
  if (!context) {
    throw new Error('useVSCodeContext must be used within a VSCodeProvider');
  }
  return context;
}

interface WebviewAppProps<T extends WebviewMessage> {
  children: ReactNode;
  onMessage?: (message: T) => void;
  onReady?: () => void;
}

export function WebviewApp<T extends WebviewMessage = WebviewMessage>({
  children,
  onMessage,
  onReady
}: Readonly<WebviewAppProps<T>>) {
  const isReadyRef = useRef(false);

  useEffect(() => {
    if (!onMessage) {
      return;
    }
    const listener = (event: MessageEvent<T>) => {
      onMessage(event.data);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [onMessage]);

  useEffect(() => {
    if (!isReadyRef.current) {
      isReadyRef.current = true;
      onReady?.();
    }
  }, [onReady]);

  return (
    <VSCodeProvider>
      {children}
    </VSCodeProvider>
  );
}
