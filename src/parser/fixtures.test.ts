import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTopology, simulateRequest, type RequestSimulationInput } from "./index";

const fixtureDirectory = resolve(process.cwd(), "tests/fixtures");
const fixtureNames = readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith(".conf"))
  .sort();

interface GoldenRequest {
  input: RequestSimulationInput;
  status: "matched" | "no-server" | "no-location";
  confidence: "high" | "medium" | "low";
  summaryContains: string[];
}

interface GoldenFixture {
  nodeLabels?: string[];
  sourceFiles?: string[];
  edgeTypes?: string[];
  issueKeys: string[];
  requests?: GoldenRequest[];
}

describe("sanitized configuration fixtures", () => {
  it.each(fixtureNames)("keeps %s topology and diagnostics stable", (fixtureName) => {
    const baseName = fixtureName.replace(/\.conf$/, "");
    const config = readFileSync(`${fixtureDirectory}/${fixtureName}`, "utf8");
    const golden = JSON.parse(readFileSync(`${fixtureDirectory}/${baseName}.golden.json`, "utf8")) as GoldenFixture;
    const graph = buildTopology(config);

    const labels = graph.nodes.map((node) => node.label);
    expect(labels).toEqual(expect.arrayContaining(golden.nodeLabels || []));
    expect([...new Set(graph.issues.map((issue) => issue.messageKey))].sort()).toEqual([...golden.issueKeys].sort());
    expect(graph.edges.map((edge) => edge.type)).toEqual(expect.arrayContaining(golden.edgeTypes || []));

    if (golden.sourceFiles) {
      const sourceFiles = [...new Set(graph.nodes.map((node) => node.source?.file).filter(Boolean))];
      expect(sourceFiles).toEqual(expect.arrayContaining(golden.sourceFiles));
    }

    for (const request of golden.requests || []) {
      const result = simulateRequest(graph.routing, graph.edges, request.input, graph.nodes);
      expect(result.status).toBe(request.status);
      expect(result.confidence).toBe(request.confidence);
      for (const summary of request.summaryContains) {
        expect(result.summary).toContain(summary);
      }
    }
  });
});
