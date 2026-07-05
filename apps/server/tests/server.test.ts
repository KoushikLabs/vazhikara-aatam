import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestServer } from "./helpers.js";

describe("server basics", () => {
  it("serves /healthz alongside websockets", async () => {
    const ts = await startTestServer();
    try {
      const res = await fetch(`${ts.url}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("OK");
    } finally {
      await ts.close();
    }
  });

  it("serves the OK placeholder at / when no web build exists (dist-aware fallback)", async () => {
    const original = process.env.WEB_DIST;
    // Point at a directory that deliberately has no index.html, regardless of
    // whether a real apps/web/dist happens to exist on this checkout.
    process.env.WEB_DIST = fs.mkdtempSync(path.join(os.tmpdir(), "vaz-no-dist-"));
    try {
      const ts = await startTestServer();
      try {
        const res = await fetch(ts.url);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("OK");
      } finally {
        await ts.close();
      }
    } finally {
      if (original === undefined) delete process.env.WEB_DIST;
      else process.env.WEB_DIST = original;
    }
  });

  describe("with a built web app present (WEB_DIST override)", () => {
    let distDir: string;
    let original: string | undefined;

    beforeEach(() => {
      original = process.env.WEB_DIST;
      distDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaz-dist-"));
      fs.writeFileSync(path.join(distDir, "index.html"), "<!doctype html><title>vaz</title>");
      process.env.WEB_DIST = distDir;
    });

    afterEach(() => {
      if (original === undefined) delete process.env.WEB_DIST;
      else process.env.WEB_DIST = original;
      fs.rmSync(distDir, { recursive: true, force: true });
    });

    it("serves the built index.html at /", async () => {
      const ts = await startTestServer();
      try {
        const res = await fetch(ts.url);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("<title>vaz</title>");
      } finally {
        await ts.close();
      }
    });

    it("falls back to index.html for a deep route (SPA fallback for /g/ABC123)", async () => {
      const ts = await startTestServer();
      try {
        const res = await fetch(`${ts.url}/g/ABC123`);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("<title>vaz</title>");
      } finally {
        await ts.close();
      }
    });

    it("still serves /healthz as plain OK even when a build exists", async () => {
      const ts = await startTestServer();
      try {
        const res = await fetch(`${ts.url}/healthz`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("OK");
      } finally {
        await ts.close();
      }
    });

    it("returns a real 404 for a missing static asset — never a cacheable 200 with the wrong MIME", async () => {
      const ts = await startTestServer();
      try {
        const res = await fetch(`${ts.url}/assets/index-STALE123.js`);
        expect(res.status).toBe(404);
      } finally {
        await ts.close();
      }
    });
  });
});
