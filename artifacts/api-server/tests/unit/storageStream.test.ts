import { vi, describe, it, expect } from "vitest";

// The module builds its provider at import time and the constructor throws
// without a bucket, so the environment has to exist before the import runs.
vi.hoisted(() => {
  process.env.OBJECT_STORAGE_BUCKET ??= "test-bucket";
  process.env.OBJECT_STORAGE_ENDPOINT ??= "http://127.0.0.1:9";
});

import { Readable, PassThrough } from "stream";
import { S3StorageProvider } from "../../src/lib/storageProvider";

/**
 * A stand-in for the Express response: a real writable stream, so piping
 * behaves exactly as it does in production, plus the two header methods
 * streamToResponse calls.
 */
function fakeRes() {
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on("data", (c) => chunks.push(Buffer.from(c)));

  const headers: Record<string, string> = {};
  (sink as any).setHeader = (k: string, v: string) => { headers[k] = v; };
  (sink as any).getHeader = (k: string) => headers[k];

  return { res: sink as any, headers, body: () => Buffer.concat(chunks).toString() };
}

/** A provider whose S3 call returns `body`, bypassing the network. */
function providerReturning(body: unknown, meta: { contentType?: string; contentLength?: number } = {}) {
  const provider = new S3StorageProvider();
  (provider as any).client = {
    send: async () => ({
      Body: body,
      ContentType: meta.contentType,
      ContentLength: meta.contentLength,
    }),
  };
  return provider;
}

describe("S3StorageProvider.streamToResponse", () => {
  const payload = "hello from the other side of the tunnel\n";

  /*
   * The regression. Under the Node HTTP handler the SDK hands back the
   * IncomingMessage — already a Readable — and never a web stream. Converting
   * unconditionally with Readable.fromWeb() threw ERR_INVALID_ARG_TYPE after
   * the headers had been set, so every download answered 200 with a
   * Content-Length and an empty body. Assert the bytes, not the absence of a
   * throw: the broken version threw somewhere a caller swallowed it.
   */
  it("delivers the body when S3 returns a Node Readable (the Node runtime case)", async () => {
    const { res, body } = fakeRes();
    const provider = providerReturning(Readable.from([Buffer.from(payload)]), {
      contentType: "text/plain",
      contentLength: Buffer.byteLength(payload),
    });

    await provider.streamToResponse("/objects/private/uploads/abc", res);

    expect(body()).toBe(payload);
  });

  it("delivers the body when S3 returns a web ReadableStream (fetch-handler runtimes)", async () => {
    const { res, body } = fakeRes();
    const web = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });
    const provider = providerReturning(web, { contentLength: Buffer.byteLength(payload) });

    await provider.streamToResponse("/objects/private/uploads/abc", res);

    expect(body()).toBe(payload);
  });

  it("sets Content-Length to the number of bytes it actually sends", async () => {
    const { res, headers, body } = fakeRes();
    const provider = providerReturning(Readable.from([Buffer.from(payload)]), {
      contentType: "text/plain",
      contentLength: Buffer.byteLength(payload),
    });

    await provider.streamToResponse("/objects/private/uploads/abc", res);

    expect(Number(headers["Content-Length"])).toBe(Buffer.byteLength(body()));
  });

  /*
   * A failure mid-stream must reach the caller. Resolving here is what let the
   * original bug reach production: the route logged 200 and Cloudflare turned
   * the truncated body into a 520 with no trace of a cause anywhere.
   */
  it("rejects when the source stream fails instead of resolving with a short body", async () => {
    const { res } = fakeRes();
    const failing = new Readable({
      read() { this.destroy(new Error("connection reset by storage")); },
    });
    const provider = providerReturning(failing, { contentLength: 999 });

    await expect(
      provider.streamToResponse("/objects/private/uploads/abc", res),
    ).rejects.toThrow(/connection reset by storage/);
  });
});
