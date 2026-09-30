// BeautyFits HTTP server (TASK-007, ADR-0013).
//
// A thin wrapper around the Next.js request handler. It exists to pass the
// direct connection (socket) address to the backend, which Next.js route
// handlers cannot otherwise see: Next.js keeps a client-supplied
// X-Forwarded-For header as is, so it cannot be trusted for per-IP limits.
// See src/server/http/client-ip.ts.
//
// It also drains in-flight requests on SIGTERM/SIGINT, as `next start` does
// (ADR-0001 graceful shutdown).
//
// Usage: `npm run dev` (node server.mjs --dev) and `npm start`.
// This file is not compiled by Next.js; keep it plain modern JavaScript.
import { createServer } from "node:http";

// Must match src/server/http/client-ip.ts.
const DIRECT_ADDRESS_HEADER = "x-beautyfits-direct-address";
const CUSTOM_SERVER_MARKER = Symbol.for("beautyfits.customServer");
const SHUTDOWN_TIMEOUT_MS = 30_000;

const dev = process.argv.includes("--dev");
// Set before Next.js is loaded (as `next dev` / `next start` do); works on every OS.
process.env.NODE_ENV ??= dev ? "development" : "production";
const { default: next } = await import("next");
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const hostname = process.env.HOSTNAME ?? "localhost";

// Route handlers run in this process; the marker tells them the header below
// was written by this server and not by the client.
globalThis[CUSTOM_SERVER_MARKER] = true;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer((req, res) => {
  // Node.js lowercases header names, so this replaces any client-supplied copy.
  req.headers[DIRECT_ADDRESS_HEADER] = req.socket.remoteAddress ?? "";
  handle(req, res);
});

server.listen(port, () => {
  console.log(
    `> BeautyFits ready on http://${hostname}:${port} (${dev ? "development" : "production"})`,
  );
});

let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`> ${signal} received: finishing in-flight requests`);
    // Stop accepting connections; the callback runs once open requests finish.
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
  });
}
