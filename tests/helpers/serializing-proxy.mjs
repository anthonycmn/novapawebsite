// A one-at-a-time proxy in front of the local Blobs emulator.
//
// The emulator implements `onlyIfNew` as fs.access-then-write with no locking,
// so under concurrency several writers can all believe the key was absent.
// Production Netlify Blobs arbitrates conditional writes server-side. This
// proxy restores that property locally by processing requests strictly in
// order, so the tests exercise our algorithm rather than the emulator's race.
import { createServer } from "node:http";

export async function startSerializingProxy(upstream, port) {
  let chain = Promise.resolve();

  const server = createServer((req, res) => {
    chain = chain.then(async () => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);

      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (["host", "connection", "content-length"].includes(k)) continue;
        headers[k] = v;
      }

      try {
        const upstreamRes = await fetch(upstream + req.url, {
          method: req.method,
          headers,
          body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
        });
        const buf = Buffer.from(await upstreamRes.arrayBuffer());
        const out = {};
        upstreamRes.headers.forEach((v, k) => {
          if (!["content-encoding", "transfer-encoding", "connection"].includes(k)) out[k] = v;
        });
        res.writeHead(upstreamRes.status, out);
        res.end(buf);
      } catch (err) {
        res.writeHead(502);
        res.end(String(err));
      }
    }).catch(() => {});
  });

  await new Promise((resolve) => server.listen(port, resolve));
  return server;
}
