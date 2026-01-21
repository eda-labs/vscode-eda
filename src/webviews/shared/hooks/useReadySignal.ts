import { useEffect, useRef } from 'react';

import { usePostMessage } from './usePostMessage';

/**
 * Hook that sends a 'ready' message to the extension when the component mounts.
 * Ensures the message is only sent once, even in strict mode.
 */
export function useReadySignal(): void {
  const postMessage = usePostMessage();
  const sentRef = useRef(false);

  useEffect(() => {
    if (!sentRef.current) {
      sentRef.current = true;
      postMessage({ command: 'ready' });
    }
  }, [postMessage]);
}
