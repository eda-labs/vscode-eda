import { useState, useCallback, useRef, useEffect } from 'react';

interface UseCopyToClipboardOptions {
  /** Duration in ms to show success state (default: 2000) */
  successDuration?: number;
}

interface UseCopyToClipboardReturn {
  /** Whether the copy was successful (resets after successDuration) */
  copied: boolean;
  /** Function to copy text to clipboard */
  copyToClipboard: (text: string) => Promise<boolean>;
}

/**
 * Hook for copying text to clipboard with success feedback.
 * Handles the common pattern of showing a "copied" state temporarily.
 */
export function useCopyToClipboard(
  options: UseCopyToClipboardOptions = {}
): UseCopyToClipboardReturn {
  const { successDuration = 2000 } = options;
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const copyToClipboard = useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);

      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Reset after duration
      timeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, successDuration);

      return true;
    } catch {
      return false;
    }
  }, [successDuration]);

  return { copied, copyToClipboard };
}
