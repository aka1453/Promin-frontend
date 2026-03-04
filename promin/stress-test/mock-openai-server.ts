/**
 * Mock OpenAI Server — Zero-Cost AI Testing
 *
 * Starts a local HTTP server that mimics the OpenAI chat completions API.
 * Point OPENAI_API_KEY and OPENAI_BASE_URL to this server during stress tests.
 *
 * Usage:
 *   npx tsx stress-test/mock-openai-server.ts
 *
 * Then set in .env.local:
 *   OPENAI_API_KEY=sk-mock-test-key
 *   OPENAI_BASE_URL=http://localhost:9876/v1
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { CONFIG } from "./config";

const PORT = CONFIG.MOCK_OPENAI_PORT;

/** Simulated latency range (ms) to mimic real API behavior */
const MIN_LATENCY = 50;
const MAX_LATENCY = 200;

let requestCount = 0;
let totalTokensServed = 0;

function randomLatency(): number {
  return MIN_LATENCY + Math.random() * (MAX_LATENCY - MIN_LATENCY);
}

function generateMockResponse(model: string): string {
  const responses = [
    "Based on the project data, the current progress is on track. The critical path shows no delays.",
    "The milestone is progressing well. 3 out of 5 tasks are completed, and the remaining tasks are within schedule.",
    "There are some concerns with Task T-0012 which is 2 days behind schedule. Consider reallocating resources.",
    "The project health is OK. All deliverables are being completed within the planned timeline.",
    "Current velocity suggests the project will complete on time. The confidence level is moderate at 72%.",
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

function handleChatCompletion(body: Record<string, unknown>, res: ServerResponse) {
  const model = (body.model as string) || "gpt-4o-mini";
  const stream = body.stream === true;
  const maxTokens = (body.max_tokens as number) || 300;
  const responseText = generateMockResponse(model);
  const promptTokens = 150;
  const completionTokens = Math.min(responseText.split(" ").length * 2, maxTokens);

  requestCount++;
  totalTokensServed += promptTokens + completionTokens;

  if (stream) {
    // SSE streaming response
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const id = `chatcmpl-mock-${Date.now()}`;
    const words = responseText.split(" ");

    let i = 0;
    const interval = setInterval(() => {
      if (i < words.length) {
        const chunk = {
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { content: (i > 0 ? " " : "") + words[i] }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        i++;
      } else {
        const done = {
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        res.write(`data: ${JSON.stringify(done)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        clearInterval(interval);
      }
    }, 10);
  } else {
    // Standard JSON response
    const response = {
      id: `chatcmpl-mock-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: responseText },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };

    const json = JSON.stringify(response);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(json);
  }
}

function handleRequest(req: IncomingMessage, res: ServerResponse) {
  let body = "";
  req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
  req.on("end", async () => {
    const url = req.url || "";

    // Health check
    if (url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, requestCount, totalTokensServed }));
      return;
    }

    // Stats endpoint
    if (url === "/stats") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        requestCount,
        totalTokensServed,
        uptime: process.uptime(),
        memoryMB: (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1),
      }));
      return;
    }

    // Chat completions
    if (url === "/v1/chat/completions" && req.method === "POST") {
      await new Promise((r) => setTimeout(r, randomLatency()));
      try {
        const parsed = JSON.parse(body);
        handleChatCompletion(parsed, res);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid JSON", type: "invalid_request_error" } }));
      }
      return;
    }

    // Models list (used by some SDKs for validation)
    if (url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        data: [
          { id: "gpt-4o-mini", object: "model" },
          { id: "gpt-4o", object: "model" },
        ],
      }));
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: `Not found: ${url}` } }));
  });
}

const server = createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`\n  Mock OpenAI Server running on http://localhost:${PORT}`);
  console.log(`  Chat completions: POST http://localhost:${PORT}/v1/chat/completions`);
  console.log(`  Health check:     GET  http://localhost:${PORT}/health`);
  console.log(`  Stats:            GET  http://localhost:${PORT}/stats`);
  console.log(`\n  Set in .env.local:`);
  console.log(`    OPENAI_API_KEY=sk-mock-test-key`);
  console.log(`    OPENAI_BASE_URL=http://localhost:${PORT}/v1`);
  console.log(`\n  Press Ctrl+C to stop.\n`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log(`\n  Shutting down. Served ${requestCount} requests, ${totalTokensServed} total tokens.`);
  server.close();
  process.exit(0);
});
