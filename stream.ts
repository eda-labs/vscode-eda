import WebSocket from "ws";
import { fetch } from "undici";
import { TextDecoder } from "util";
import { readFileSync } from "fs";
import { EdaAuthClient, EdaAuthOptions } from "./src/clients/edaAuthClient";

interface StreamConfig extends EdaAuthOptions {
  edaUrl: string;
  messageIntervalMs?: number;
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

async function streamSse(url: string, auth: EdaAuthClient): Promise<void> {
  console.log(`\n[SSE] Connecting to: ${url}`);

  const res = await fetch(url, {
    headers: auth.getHeaders(),
    dispatcher: auth.getAgent(),
  } as any);

  // Log response headers
  console.log(`[SSE] Response Status: ${res.status} ${res.statusText}`);
  console.log("[SSE] Response Headers:");
  for (const [key, value] of res.headers.entries()) {
    console.log(`  ${key}: ${value}`);
  }

  if (!res.ok || !res.body) {
    console.error(`[SSE] Failed to stream: HTTP ${res.status}`);
    return;
  }

  console.log("\n[SSE] Starting stream...");

  // For non-streaming responses, read the entire body
  if (res.headers.get('content-length')) {
    const text = await res.text();
    console.log(`[SSE] Complete response received: ${text}`);

    // Try to parse the complete response for stream and details
    try {
      const jsonData = JSON.parse(text);
      if (jsonData.stream && jsonData.details) {
        console.log(`[SSE Stream] ${jsonData.stream}`);
        console.log(`[SSE Details] ${jsonData.details}`);
      }
    } catch {
      // Not JSON or doesn't have expected fields
    }
    return;
  }

  // For streaming responses
  const reader = res.body.getReader();
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
        if (!line) continue;

        // Try to parse JSON to extract stream and details
        try {
          const jsonData = JSON.parse(line);
          if (jsonData.stream && jsonData.details) {
            console.log(`[SSE Stream] ${jsonData.stream}`);
            console.log(`[SSE Details] ${jsonData.details}`);
          } else {
            console.log(`[SSE Data] ${line}`);
          }
        } catch {
          // Not JSON, log as raw data
          console.log(`[SSE Data] ${line}`);
        }
      }
    }
  } catch (error) {
    console.error("[SSE] Stream error:", error);
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

  let streamInterval: ReturnType<typeof setInterval> | null = null;

  ws.on("open", () => {
    console.log("[WS] Connection opened");
  });

  ws.on("error", (err) => {
    console.error("[WS] Error:", err);
  });

  ws.on("close", (code, reason) => {
    console.log(`[WS] Connection closed - Code: ${code}, Reason: ${reason.toString()}`);
    if (streamInterval) {
      clearInterval(streamInterval);
    }
  });

  ws.on("message", async (data) => {
    const txt = data.toString();
    console.log(`[WS Message] ${txt}`);

    try {
      const msg = JSON.parse(txt);

      // Check for stream and details in WebSocket messages
      if (msg.stream && msg.details) {
        console.log(`[WS Stream] ${msg.stream}`);
        console.log(`[WS Details] ${msg.details}`);
      }

      if (msg.type === "register" && msg.msg?.client) {
        const client = msg.msg.client as string;
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
        ws.send(JSON.stringify({ type: "next", stream: streamName }));

        // Set up periodic next messages
        streamInterval = setInterval(() => {
          console.log(`[WS] Sending periodic next for stream: ${streamName}`);
          ws.send(JSON.stringify({ type: "next", stream: streamName }));
        }, cfg.messageIntervalMs ?? 500);

        // Start SSE streaming in parallel - don't await it
        streamSse(sseUrl, auth).then(() => {
          console.log("[SSE] Stream completed");
        }).catch((err) => {
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
    if (streamInterval) {
      clearInterval(streamInterval);
    }
    ws.close();
    process.exit(0);
  });

  console.log("[Main] Press Ctrl+C to stop\n");
}

main().catch((err) => {
  console.error("[Main] Fatal error:", err);
  process.exit(1);
});