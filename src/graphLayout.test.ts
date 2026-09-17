import { describe, expect, it } from "vitest";
import type { TopologyGraph } from "./parser";
import { toFlowElements } from "./graphLayout";

const graph: TopologyGraph = {
  nodes: [
    { id: "server", type: "server", label: "example.com", details: [] },
    { id: "api", type: "upstream", label: "api_backend", details: ["API pool"] },
    { id: "static", type: "upstream", label: "static_backend", details: [] }
  ],
  edges: [
    { id: "api-edge", source: "server", target: "api", type: "flow", label: "proxy_pass" },
    { id: "static-edge", source: "server", target: "static", type: "flow", label: "assets" }
  ],
  issues: []
};

describe("topology search states", () => {
  it("highlights matching nodes and dims unmatched nodes", () => {
    const elements = toFlowElements(graph, "api");
    const api = elements.nodes.find((node) => node.id === "server::api");
    const server = elements.nodes.find((node) => node.id === "server::server");

    expect(api?.data.matches).toBe(true);
    expect(api?.data.dimmed).toBe(false);
    expect(server?.data.matches).toBe(false);
    expect(server?.data.dimmed).toBe(true);
  });

  it("keeps matching-node connections visible and dims unrelated edges", () => {
    const elements = toFlowElements(graph, "api");
    const apiEdge = elements.edges.find((edge) => edge.id === "server::api-edge");
    const staticEdge = elements.edges.find((edge) => edge.id === "server::static-edge");

    expect(apiEdge?.data?.matches).toBe(true);
    expect(apiEdge?.data?.dimmed).toBe(false);
    expect(staticEdge?.data?.matches).toBe(false);
    expect(staticEdge?.data?.dimmed).toBe(true);
  });

  it("groups multiple entry points that feed the same server into one lane", () => {
    const groupedGraph: TopologyGraph = {
      nodes: [
        { id: "entry-80", type: "entry", label: "http 80", details: [] },
        { id: "entry-443", type: "entry", label: "http 443 ssl", details: [] },
        { id: "server", type: "server", label: "example.com", details: [] },
        { id: "route", type: "route", label: "location /api", details: [] }
      ],
      edges: [
        { id: "entry80-server", source: "entry-80", target: "server", type: "flow", label: "serves" },
        { id: "entry443-server", source: "entry-443", target: "server", type: "flow", label: "serves" },
        { id: "server-route", source: "server", target: "route", type: "flow", label: "matches" }
      ],
      issues: []
    };

    const elements = toFlowElements(groupedGraph);

    expect(elements.nodes.filter((node) => node.type === "laneGroup")).toHaveLength(1);
    expect(elements.nodes.some((node) => node.id === "server::entry-80")).toBe(true);
    expect(elements.nodes.some((node) => node.id === "server::entry-443")).toBe(true);
    expect(elements.edges.some((edge) => edge.id === "server::server-route")).toBe(true);
  });

  it("spaces route nodes by estimated height so long descriptions stay apart", () => {
    const buildGraph = (routeLabel: string): TopologyGraph => ({
      nodes: [
        { id: "server", type: "server", label: "example.com", details: [] },
        { id: "route-a", type: "route", label: routeLabel, subtitle: routeLabel, details: [] },
        { id: "route-b", type: "route", label: `${routeLabel} b`, subtitle: routeLabel, details: [] }
      ],
      edges: [
        { id: "edge-a", source: "server", target: "route-a", type: "flow", label: "matches" },
        { id: "edge-b", source: "server", target: "route-b", type: "flow", label: "matches" }
      ],
      issues: []
    });
    const routeGap = (routeLabel: string) => {
      const elements = toFlowElements(buildGraph(routeLabel));
      const first = elements.nodes.find((node) => node.id === "server::route-a");
      const second = elements.nodes.find((node) => node.id === "server::route-b");
      return Math.abs((second?.position.y ?? 0) - (first?.position.y ?? 0));
    };

    const shortGap = routeGap("location /a");
    const longGap = routeGap(`location /${"segments/".repeat(8)}`);

    expect(shortGap).toBeGreaterThanOrEqual(78);
    expect(longGap).toBeGreaterThan(shortGap);
  });

  it("wraps a tall server stack into bounded columns", () => {
    const nodes: TopologyGraph["nodes"] = [{ id: "server", type: "server", label: "example.com", details: [] }];
    const edges: TopologyGraph["edges"] = [];
    for (let index = 0; index < 40; index += 1) {
      nodes.push({ id: `route-${index}`, type: "route", label: `location /p${index}`, subtitle: `prefix /p${index}`, details: [] });
      edges.push({ id: `edge-${index}`, source: "server", target: `route-${index}`, type: "flow", label: "matches" });
    }

    const elements = toFlowElements({ nodes, edges, issues: [] });
    const lane = elements.nodes.find((node) => node.type === "laneGroup");
    expect(lane?.style?.height).toBeLessThan(1600);

    const columns = new Set(elements.nodes.filter((node) => node.type === "nginxNode").map((node) => Math.round(node.position.x)));
    expect(columns.size).toBeGreaterThan(3);
  });

  it("scopes simulation highlighting to the matched server lane", () => {
    const sharedGraph: TopologyGraph = {
      nodes: [
        { id: "server-a", type: "server", label: "a.local", details: [] },
        { id: "server-b", type: "server", label: "b.local", details: [] },
        { id: "route-a", type: "route", label: "location /api", details: [] },
        { id: "route-b", type: "route", label: "location /api", details: [] },
        { id: "shared", type: "upstream", label: "shared_pool", details: [] }
      ],
      edges: [
        { id: "a-route", source: "server-a", target: "route-a", type: "flow", label: "matches" },
        { id: "b-route", source: "server-b", target: "route-b", type: "flow", label: "matches" },
        { id: "a-up", source: "route-a", target: "shared", type: "flow", label: "proxy_pass" },
        { id: "b-up", source: "route-b", target: "shared", type: "flow", label: "proxy_pass" }
      ],
      issues: []
    };
    const highlight = { nodeIds: ["server-a", "route-a", "shared"], edgeIds: ["a-route", "a-up"], active: true, serverId: "server-a" };

    const scoped = toFlowElements(sharedGraph, "", undefined, "horizontal", highlight);
    expect(scoped.nodes.find((node) => node.id === "server-a::shared")?.data?.dimmed).toBe(false);
    expect(scoped.nodes.find((node) => node.id === "server-b::shared")?.data?.dimmed).toBe(true);
    expect(scoped.edges.find((edge) => edge.id === "server-b::b-up")?.data?.dimmed).toBe(true);

    const unscoped = toFlowElements(sharedGraph, "", undefined, "horizontal", { ...highlight, serverId: undefined });
    expect(unscoped.nodes.find((node) => node.id === "server-b::shared")?.data?.dimmed).toBe(false);
  });

  it("lays server lanes out in a grid instead of one tall column", () => {
    const nodes: TopologyGraph["nodes"] = [];
    const edges: TopologyGraph["edges"] = [];
    const serverCount = 16;
    for (let server = 0; server < serverCount; server += 1) {
      nodes.push({ id: `server-${server}`, type: "server", label: `s${server}.local`, details: [] });
      for (let index = 0; index < 10; index += 1) {
        nodes.push({ id: `route-${server}-${index}`, type: "route", label: `location /s${server}/p${index}`, subtitle: `prefix /s${server}/p${index}`, details: [] });
        edges.push({ id: `edge-${server}-${index}`, source: `server-${server}`, target: `route-${server}-${index}`, type: "flow", label: "matches" });
      }
    }

    const elements = toFlowElements({ nodes, edges, issues: [] });
    const laneColumns = new Set(elements.nodes.filter((node) => node.type === "laneGroup").map((node) => node.position.x));
    expect(laneColumns.size).toBeGreaterThan(1);

    const maxY = Math.max(...elements.nodes.map((node) => node.position.y));
    expect(maxY).toBeLessThan(serverCount * 1400);
  });
});
