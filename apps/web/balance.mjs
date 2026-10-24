// Runs the built site as several `next start` processes so it can use every CPU core, with a
// small front door on PORT (3000) that hands each request to one of them.
// One Next process renders on one core; on the 2-core VPS that capped the site at ~20 pages/s.
// Requests are split by visitor address (CF-Connecting-IP behind the Cloudflare Tunnel), so one
// visitor always reaches the same process: the admin login lockout and the page cache a visitor
// just refreshed with an action stay consistent for them.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import http from "node:http";
import os from "node:os";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT ?? 3000);
const WORKERS = Math.max(1, Number(process.env.WEB_WORKERS ?? Math.min(2, os.availableParallelism())));
const FIRST = PORT + 1;
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

if (process.argv[2] === "--worker") {
  // One Next process. It quits as soon as the front door is gone (even when that was killed
  // outright, as a restart on Windows does), so an old copy never keeps holding its port.
  process.on("disconnect", () => process.exit(0));
  process.argv = [process.execPath, nextBin, "start", "-p", process.argv[3], ...process.argv.slice(4)];
  await import(pathToFileURL(nextBin).href);
} else {
  const ports = Array.from({ length: WORKERS }, (_, i) => FIRST + i);
  let stopping = false;
  const children = new Map();

  function startWorker(port) {
    const child = spawn(
      process.execPath,
      [import.meta.filename, "--worker", String(port), ...(port === PORT ? [] : ["-H", "127.0.0.1"])],
      {
        cwd: import.meta.dirname,
        env: { ...process.env, PORT: String(port) },
        stdio: ["inherit", "inherit", "inherit", "ipc"],
      },
    );
    children.set(port, child);
    child.on("exit", (code) => {
      children.delete(port);
      if (stopping) return;
      console.error(`web worker on :${port} exited (${code}); restarting`);
      setTimeout(() => startWorker(port), 1000);
    });
  }

  if (WORKERS === 1) {
    // Nothing to balance: run Next straight on PORT.
    ports[0] = PORT;
  }
  for (const port of ports) startWorker(port);

  function stop() {
    stopping = true;
    for (const child of children.values()) child.kill();
    setTimeout(() => process.exit(0), 3000).unref();
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  if (WORKERS > 1) {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });

    const visitor = (req) =>
      String(req.headers["cf-connecting-ip"] ?? "").trim() ||
      String(req.headers["x-forwarded-for"] ?? "")
        .split(",")[0]
        .trim() ||
      req.socket.remoteAddress ||
      "";

    function hash(text) {
      let h = 2166136261;
      for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
      return h >>> 0;
    }

    const safe = (method) => method === "GET" || method === "HEAD";

    function forward(req, res, start, tries) {
      const port = ports[(start + tries) % ports.length];
      const upstream = http.request(
        { host: "127.0.0.1", port, method: req.method, path: req.url, headers: req.headers, agent },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.rawHeaders);
          up.pipe(res);
        },
      );
      upstream.on("error", (err) => {
        if (res.headersSent) return res.destroy();
        // A worker that is starting or restarting refuses the connection: try the other one, and
        // keep retrying for a few seconds while the site boots. Only for requests with no body.
        if (safe(req.method) && err.code === "ECONNREFUSED" && tries < 40) {
          return setTimeout(() => forward(req, res, start, tries + 1), tries < ports.length ? 0 : 250);
        }
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end("เว็บกำลังเริ่มทำงาน ลองใหม่อีกครั้ง");
      });
      res.on("close", () => {
        if (!res.writableFinished) upstream.destroy();
      });
      if (safe(req.method)) upstream.end();
      else req.pipe(upstream);
    }

    const server = http.createServer((req, res) => forward(req, res, hash(visitor(req)) % ports.length, 0));
    server.keepAliveTimeout = 65_000;
    server.listen(PORT, () => console.log(`web on :${PORT} -> ${ports.map((p) => `:${p}`).join(", ")}`));
  }
}
