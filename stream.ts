import { TextDecoder } from "util";
import { readFileSync } from "fs";

import WebSocket from "ws";
import { fetch, type Response } from "undici";

import type { EdaAuthOptions } from "./src/clients/edaAuthClient";
import { EdaAuthClient } from "./src/clients/edaAuthClient";

interface StreamConfig extends EdaAuthOptions {
  edaUrl: string;
}

function loadConfig(): StreamConfig {
  try {
    const raw = readFileSync("stream.config.json", "utf8");
    return JSON.parse(raw) as StreamConfig;
  } catch {
    const url = process.env.EDA_URL;
    if (!url) {
      throw new Error(
        "stream.config.json not found and EDA_URL env var not set"
      );
    }
    return { edaUrl: url } as StreamConfig;
  }
}

function logResponseHeaders(res: Response): void {
  console.log(`[SSE] Response Status: ${res.status} ${res.statusText}`);
  console.log("[SSE] Response Headers:");
  for (const [key, value] of res.headers.entries()) {
    console.log(`  ${key}: ${value}`);
  }
}

function logSseData(jsonData: { stream?: string; details?: string }, line: string): void {
  if (jsonData.stream && jsonData.details) {
    console.log(`[SSE Stream] ${jsonData.stream}`);
    console.log(`[SSE Details] ${jsonData.details}`);
  } else {
    console.log(`[SSE Data] ${line}`);
  }
}

function processLine(line: string, onMessage: () => void): void {
  if (!line) return;

  try {
    const jsonData = JSON.parse(line) as { stream?: string; details?: string };
    logSseData(jsonData, line);
  } catch {
    console.log(`[SSE Data] ${line}`);
  }
  onMessage();
}

async function handleNonStreamingResponse(
  res: Response,
  onMessage: () => void
): Promise<void> {
  const text = await res.text();
  console.log(`[SSE] Complete response received: ${text}`);

  try {
    const jsonData = JSON.parse(text) as { stream?: string; details?: string };
    if (jsonData.stream && jsonData.details) {
      console.log(`[SSE Stream] ${jsonData.stream}`);
      console.log(`[SSE Details] ${jsonData.details}`);
    }
  } catch {
    // Not JSON or doesn't have expected fields
  }
  onMessage();
}

async function handleStreamingResponse(
  res: Response,
  onMessage: () => void
): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        console.log("[SSE] Stream ended");
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        processLine(line, onMessage);
      }
    }
  } catch (error) {
    console.error("[SSE] Stream error:", error);
  }
}

async function streamSse(
  url: string,
  auth: EdaAuthClient,
  onMessage: () => void
): Promise<void> {
  console.log(`\n[SSE] Connecting to: ${url}`);

  const res = await fetch(url, {
    headers: auth.getHeaders(),
    dispatcher: auth.getAgent(),
  } as Parameters<typeof fetch>[1]);

  logResponseHeaders(res);

  if (!res.ok || !res.body) {
    console.error(`[SSE] Failed to stream: HTTP ${res.status}`);
    return;
  }

  console.log("\n[SSE] Starting stream...");

  if (res.headers.get("content-length")) {
    await handleNonStreamingResponse(res, onMessage);
  } else {
    await handleStreamingResponse(res, onMessage);
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: ts-node stream.ts <endpoint-path|eql-query|nql:query>");
    process.exit(1);
  }

  const cfg = loadConfig();
  const auth = new EdaAuthClient(cfg.edaUrl, {
    ...cfg,
    skipTlsVerify: cfg.skipTlsVerify ?? true,
  });
  await auth.waitForAuth();

  const url = new URL(auth.getBaseUrl());
  console.log(`\n[WS] Connecting to: wss://${url.host}/events`);

  const ws = new WebSocket(`wss://${url.host}/events`, {
    headers: auth.getWsHeaders(),
    ...auth.getWsOptions(),
  });

  const messageIntervalMs = 500;
  const lastNextTimestamps = new Map<string, number>();
  const pendingNext = new Set<string>();

  function sendNext(stream: string): void {
    console.log(`[WS] Sending 'next' for stream: ${stream}`);
    ws.send(JSON.stringify({ type: 'next', stream }));
    lastNextTimestamps.set(stream, Date.now());
  }

  function scheduleNext(stream: string): void {
    const now = Date.now();
    const last = lastNextTimestamps.get(stream) || 0;
    const elapsed = now - last;
    if (elapsed >= messageIntervalMs) {
      sendNext(stream);
    } else if (!pendingNext.has(stream)) {
      pendingNext.add(stream);
      const delay = messageIntervalMs - elapsed;
      setTimeout(() => {
        pendingNext.delete(stream);
        if (ws.readyState === WebSocket.OPEN) {
          sendNext(stream);
        }
      }, delay);
    }
  }

  ws.on("open", () => {
    console.log("[WS] Connection opened");
  });

  ws.on("error", (err) => {
    console.error("[WS] Error:", err);
  });

  ws.on("close", (code, reason) => {
    console.log(`[WS] Connection closed - Code: ${code}, Reason: ${reason.toString()}`);
  });

  ws.on("message", (data) => {
    const txt = data.toString();
    console.log(`[WS Message] ${txt}`);

    try {
      const msg = JSON.parse(txt) as {
        stream?: string;
        details?: string;
        type?: string;
        msg?: { client?: string };
      };

      // Check for stream and details in WebSocket messages
      if (msg.stream && msg.details) {
        console.log(`[WS Stream] ${msg.stream}`);
        console.log(`[WS Details] ${msg.details}`);
      }

      if (msg.stream && msg.type !== "register") {
        scheduleNext(msg.stream);
      }

      if (msg.type === "register" && msg.msg?.client) {
        const client = msg.msg.client;
        let streamName: string;
        let sseUrl: string;

        if (arg.startsWith(".")) {
          // EQL query
          streamName = "eql";
          sseUrl =
            `${auth.getBaseUrl()}/core/query/v1/eql` +
            `?eventclient=${encodeURIComponent(client)}` +
            `&stream=${streamName}` +
            `&query=${encodeURIComponent(arg)}`;
        } else if (arg.startsWith("nql:")) {
          // NQL query
          streamName = "nql";
          const nqlQuery = arg.substring(4); // Remove "nql:" prefix
          sseUrl =
            `${auth.getBaseUrl()}/core/query/v1/nql` +
            `?eventclient=${encodeURIComponent(client)}` +
            `&stream=${streamName}` +
            `&query=${encodeURIComponent(nqlQuery)}`;

          // Add namespaces parameter if provided via environment variable
          const namespaces = process.env.NQL_NAMESPACES;
          if (namespaces) {
            sseUrl += `&namespaces=${encodeURIComponent(namespaces)}`;
          }
        } else {
          // Direct endpoint path
          streamName = arg.substring(arg.lastIndexOf("/") + 1);
          sseUrl =
            `${auth.getBaseUrl()}${arg}` +
            `?eventclient=${encodeURIComponent(client)}` +
            `&stream=${encodeURIComponent(streamName)}`;
        }

        console.log(`[WS] Sending initial next for stream: ${streamName}`);
        sendNext(streamName);

        // Start SSE streaming in parallel - don't await it
        streamSse(sseUrl, auth, () => scheduleNext(streamName)).then(() => {
          console.log("[SSE] Stream completed");
        }).catch((err: unknown) => {
          console.error("[SSE] Stream error:", err);
        });
      }
    } catch (err) {
      console.error("[WS] Failed to parse message:", err);
    }
  });

  // Keep the process alive
  process.on("SIGINT", () => {
    console.log("\n[Main] Shutting down...");
    ws.close();
    process.exit(0);
  });

  console.log("[Main] Press Ctrl+C to stop\n");
}

main().catch((err) => {
  console.error("[Main] Fatal error:", err);
  process.exit(1);
});