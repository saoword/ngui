import { afterEach, describe, expect, it, vi } from "vitest";
import { dataEntryUrl, fetchNodeConfig, fetchNodeIndex } from "./nodeSource";

function jsonResponse(payload: unknown): Response {
  return { ok: true, json: async () => payload } as unknown as Response;
}

function textResponse(body: string): Response {
  return { ok: true, text: async () => body } as unknown as Response;
}

describe("nodeSource", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects path traversal when building data urls", () => {
    expect(dataEntryUrl("../etc/passwd")).toBeNull();
    expect(dataEntryUrl("/etc/passwd")).toBeNull();
    expect(dataEntryUrl("nodes\\web-01.conf")).toBeNull();
    expect(dataEntryUrl("")).toBeNull();
    expect(dataEntryUrl("web-01.conf")).toBe("data/web-01.conf");
  });

  it("normalizes the collected node index and drops invalid entries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      generatedAt: "2026-09-14T08:00:00Z",
      nodes: [
        { id: "web-01", file: "web-01.conf", label: "Web 01" },
        { id: "bad", file: "../secret" },
        { id: "", file: "empty.conf" },
        { id: "web-02", file: "web-02.conf" }
      ]
    })));

    const index = await fetchNodeIndex();

    expect(index?.nodes.map((node) => node.id)).toEqual(["web-01", "web-02"]);
    expect(index?.nodes[0].label).toBe("Web 01");
    expect(index?.generatedAt).toBe("2026-09-14T08:00:00Z");
  });

  it("returns null when the index is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false } as Response)));
    expect(await fetchNodeIndex()).toBeNull();
  });

  it("returns null when the fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to parse URL");
    }));
    expect(await fetchNodeIndex()).toBeNull();
  });

  it("fetches the raw configuration text for a node", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse("http { server { listen 80; } }")));
    expect(await fetchNodeConfig({ id: "web-01", file: "web-01.conf" })).toBe("http { server { listen 80; } }");
  });

  it("refuses to fetch a node with a traversal file path", async () => {
    const fetchMock = vi.fn(async () => textResponse("secret"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchNodeConfig({ id: "bad", file: "../secret" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
