import { useEffect, useRef } from 'react';

export interface WebviewMessage {
  command: string;
}

export function useMessageListener<T extends WebviewMessage = WebviewMessage>(
  handler: (message: T) => void
): void {
  // Use ref to always have access to latest handler without re-registering listener
  const handlerRef = useRef(handler);

  // Update ref when handler changes
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  // Register listener only once
  useEffect(() => {
    const listener = (event: MessageEvent<T>) => {
      handlerRef.current(event.data);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
}
