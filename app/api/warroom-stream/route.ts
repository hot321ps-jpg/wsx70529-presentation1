import { kv } from "@vercel/kv";

export const runtime = "nodejs";

const KEY = "warroom:latest";
const UPDATED_KEY = "warroom:updatedAt";

function sse(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET() {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(`event: hello\n${sse({ ok: true })}`));

      let last: string | null = null;

      const tick = async () => {
        try {
          const updatedAt = (await kv.get(UPDATED_KEY)) as string | null;
          if (updatedAt && updatedAt !== last) {
            last = updatedAt;
            const latest = await kv.get(KEY);
            controller.enqueue(enc.encode(`event: snapshot\n${sse(latest)}`));
          } else {
            controller.enqueue(enc.encode(`event: ping\n${sse({ t: Date.now() })}`));
          }
        } catch {
          controller.enqueue(enc.encode(`event: error\n${sse({ message: "kv_error" })}`));
        }
      };

      const interval = setInterval(tick, 1000);
      // @ts-ignore
      controller._cleanup = () => clearInterval(interval);
    },
    cancel() {
      // @ts-ignore
      this._cleanup?.();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive"
    }
  });
}
