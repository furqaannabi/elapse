/** A programmable HTTP receiver on a random port, for worker tests. */
export interface Received {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export function startReceiver() {
  const received: Received[] = [];
  let behaviour: (req: Received) => Response | Promise<Response> = () => new Response("ok", { status: 200 });
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const r: Received = {
        method: req.method,
        path: url.pathname,
        headers: Object.fromEntries([...req.headers.entries()]),
        body: await req.text(),
      };
      received.push(r);
      return behaviour(r);
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/hooks`,
    received,
    respond(status: number, body = "", delayMs = 0) {
      behaviour = async () => {
        if (delayMs) await Bun.sleep(delayMs);
        return new Response(body, { status });
      };
    },
    stop() {
      server.stop(true);
    },
  };
}
