import { isBlock } from "./parser";
import type {
  LocationMatchInfo,
  NginxBlock,
  NginxDirective,
  NginxNode,
  RequestSimulationInput,
  RequestSimulationResult,
  RequestRouteCandidate,
  RequestRouteStep,
  RoutingListen,
  RoutingLocation,
  RoutingModel,
  RoutingServer,
  TopologyEdge,
  TopologyNode
} from "./types";

export function buildRoutingModel(ast: NginxBlock): RoutingModel {
  const servers: RoutingServer[] = [];

  walk(ast, (node, parents) => {
    if (!isBlock(node) || node.name !== "server") return;
    const context = nearestContext(parents);
    const serverNodeId = `${context}-server-${node.id}`;
    servers.push({
      id: node.id,
      nodeId: serverNodeId,
      context,
      names: directives(node, "server_name").flatMap((directive) => directive.args),
      listens: directives(node, "listen").map((listen) => parseListen(listen, context)),
      source: node.loc,
      raw: node.raw,
      locations: node.children
        .filter((child): child is NginxBlock => isBlock(child) && child.name === "location")
        .map((location, order) => ({
          id: location.id,
          nodeId: `route-${location.id}`,
          serverNodeId,
          order,
          source: location.loc,
          raw: location.raw,
          ...classifyLocation(location)
        }))
    });
  });

  return { servers };
}

export function classifyLocation(location: NginxBlock): LocationMatchInfo {
  const [first = "/", second = ""] = location.args;
  if (first === "=") {
    return { kind: "exact", pattern: second || "/", priority: 500 };
  }
  if (first === "^~") {
    return { kind: "prefix-priority", pattern: second || "/", priority: 400 };
  }
  if (first === "~") {
    return { kind: "regex-case-sensitive", pattern: second || "", priority: 300 };
  }
  if (first === "~*") {
    return { kind: "regex-case-insensitive", pattern: second || "", priority: 300 };
  }
  return { kind: "prefix", pattern: first || "/", priority: 100 };
}

export function matchLocation(locations: RoutingLocation[], path: string): RoutingLocation | undefined {
  const normalizedPath = normalizePath(path);
  const exact = locations.find((location) => location.kind === "exact" && location.pattern === normalizedPath);
  if (exact) return exact;

  const prefix = longestPrefix(
    locations.filter((location) => location.kind === "prefix" || location.kind === "prefix-priority"),
    normalizedPath
  );
  if (prefix?.kind === "prefix-priority") return prefix;
  const regex = locations
    .filter((location) => location.kind === "regex-case-sensitive" || location.kind === "regex-case-insensitive")
    .sort((left, right) => left.order - right.order)
    .find((location) => regexMatches(location, normalizedPath));

  return regex || prefix;
}

export function simulateRequest(
  routing: RoutingModel | undefined,
  edges: TopologyEdge[],
  input: RequestSimulationInput,
  nodes: TopologyNode[] = []
): RequestSimulationResult {
  if (!routing) {
    return emptyResult("no-server", "Routing model unavailable.", "low", input);
  }

  const httpServers = routing.servers.filter((server) => server.context === "http");
  if (!input.port) {
    return emptyResult("no-server", "Enter a port to simulate the request route.", "low", input);
  }

  const servers = selectServerCandidates(httpServers, input);
  if (servers.length === 0) {
    return emptyResult("no-server", `No HTTP server matched ${input.host}:${input.port}.`, "low", input);
  }

  const candidates = servers.map((server) => buildCandidate(server, input, edges, nodes));
  const primary = candidates.find((candidate) => candidate.status === "matched") || candidates[0];
  return {
    status: primary.status,
    confidence: primary.confidence,
    nodeIds: primary.nodeIds,
    edgeIds: primary.edgeIds,
    summary: primary.summary,
    reasons: primary.reasons,
    steps: primary.steps,
    candidates,
    serverId: primary.steps.find((step) => step.kind === "server")?.nodeId,
    locationId: primary.steps.find((step) => step.kind === "location")?.nodeId
  };
}

function buildCandidate(
  server: RoutingServer,
  input: RequestSimulationInput,
  edges: TopologyEdge[],
  nodes: TopologyNode[]
): RequestRouteCandidate {
  const nodeIds = new Set<string>([server.nodeId]);
  const listen = server.listens.find((item) => (item.port || defaultPort(input.scheme)) === input.port);
  if (listen?.nodeId) nodeIds.add(listen.nodeId);

  const location = matchLocation(server.locations, input.path);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  if (!location) {
    const nodeList = [...nodeIds];
    const namedMatch = matchesServerName(server, input.host);
    const reasons = [
      `Listen matched port ${input.port}.`,
      namedMatch ? `Server name matched ${input.host}.` : "Fallback/default server candidate.",
      "No matching location block found."
    ];
    return {
      id: `server:${server.nodeId}`,
      status: "no-location",
      confidence: namedMatch ? "medium" : "low",
      summary: `Matched server ${formatServer(server)}, but no location matched ${normalizePath(input.path)}.`,
      reasons,
      steps: buildFailureTrace(input, server, reasons[2], namedMatch),
      nodeIds: nodeList,
      edgeIds: collectPathEdges(edges, nodeList)
    };
  }

  nodeIds.add(location.nodeId);
  collectReachable(edges, location.nodeId, nodeIds, 4);
  const nodeList = [...nodeIds];
  const namedMatch = matchesServerName(server, input.host);
  const confidence = nodeList.some((id) => id.includes("dynamic") || id.startsWith("variable-") || nodeMap.get(id)?.type === "variable")
    ? "low"
    : (namedMatch ? "high" : "medium");
  const reasons = [
    `Listen matched port ${input.port}.`,
    namedMatch ? `Server name matched ${input.host}.` : "Fallback/default server candidate.",
    `Location matched by ${location.kind}: ${location.pattern}.`,
    confidence === "low" ? "Dynamic variable target lowers confidence." : "Static route target resolved."
  ];
  return {
    id: location.nodeId,
    status: "matched",
    confidence,
    summary: `${input.host}${normalizePath(input.path)} matched ${formatLocation(location)} in ${formatServer(server)}.`,
    reasons,
    steps: buildMatchedTrace(input, server, location, edges, nodeMap, confidence),
    nodeIds: nodeList,
    edgeIds: collectPathEdges(edges, nodeList)
  };
}

export function parseListen(directive: NginxDirective, context: "http" | "stream"): RoutingListen {
  const value = directive.args.join(" ").trim();
  return {
    value,
    port: extractPort(directive.args, context),
    ssl: directive.args.includes("ssl"),
    nodeId: `${context}-entry-${hash(`${context} ${value}`)}-${directive.id}`,
    source: directive.loc,
    raw: directive.raw
  };
}

export function suggestRequestInputs(routing: RoutingModel | undefined): RequestSimulationInput[] {
  if (!routing) return [];
  const suggestions: RequestSimulationInput[] = [];
  const seen = new Set<string>();

  routing.servers
    .filter((server) => server.context === "http")
    .forEach((server) => {
      const names = server.names.filter((name) => !["_", "*"].includes(name));
      const host = names[0] || "";
      const listen = server.listens.find((item) => item.port || item.ssl) || server.listens[0];
      const port = listen?.port || (listen?.ssl ? 443 : 80);
      const scheme = listen?.ssl || port === 443 ? "https" : "http";
      const locations = server.locations.filter((location) => !location.kind.startsWith("regex"));
      const paths = locations.length ? locations.map((location) => location.pattern) : ["/"];

      paths.forEach((path) => {
        const suggestion: RequestSimulationInput = { host, path: path || "/", scheme, port };
        const key = JSON.stringify(suggestion);
        if (!seen.has(key)) {
          seen.add(key);
          suggestions.push(suggestion);
        }
      });
    });

  return suggestions;
}

export function normalizePath(path: string) {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function selectServerCandidates(servers: RoutingServer[], input: RequestSimulationInput) {
  if (!input.port) return [];
  const portMatches = servers.filter((server) => server.listens.length === 0 || server.listens.some((listen) => (listen.port || defaultPort(input.scheme)) === input.port));
  const exact = portMatches.filter((server) => server.names.some((name) => name !== "_" && name !== "*" && name === input.host));
  if (exact.length) return exact;
  const wildcard = portMatches.filter((server) => server.names.some((name) => name !== "_" && name !== "*" && wildcardMatches(name, input.host)));
  return wildcard.length ? wildcard : portMatches;
}

function matchesServerName(server: RoutingServer, host: string) {
  return server.names.some((name) => name !== "_" && name !== "*" && (name === host || wildcardMatches(name, host)));
}

function wildcardMatches(pattern: string, host: string) {
  if (pattern === "_" || pattern === "*") return true;
  if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1));
  if (pattern.endsWith(".*")) return host.startsWith(pattern.slice(0, -1));
  return false;
}

function longestPrefix(locations: RoutingLocation[], path: string) {
  return locations
    .filter((location) => path.startsWith(location.pattern))
    .sort((left, right) => right.pattern.length - left.pattern.length || left.order - right.order)[0];
}

function regexMatches(location: RoutingLocation, path: string) {
  try {
    const flags = location.kind === "regex-case-insensitive" ? "i" : "";
    return new RegExp(location.pattern, flags).test(path);
  } catch {
    return false;
  }
}

function collectReachable(edges: TopologyEdge[], sourceId: string, nodeIds: Set<string>, maxDepth: number) {
  const queue = [{ id: sourceId, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= maxDepth) continue;
    edges.filter((edge) => edge.source === current.id).forEach((edge) => {
      if (!nodeIds.has(edge.target)) {
        nodeIds.add(edge.target);
        queue.push({ id: edge.target, depth: current.depth + 1 });
      }
    });
  }
}

function collectPathEdges(edges: TopologyEdge[], nodeIds: string[]) {
  const nodeSet = new Set(nodeIds);
  return edges.filter((edge) => nodeSet.has(edge.source) && nodeSet.has(edge.target)).map((edge) => edge.id);
}

function buildMatchedTrace(
  input: RequestSimulationInput,
  server: RoutingServer,
  location: RoutingLocation,
  edges: TopologyEdge[],
  nodes: Map<string, TopologyNode>,
  confidence: RequestSimulationResult["confidence"]
): RequestRouteStep[] {
  const steps: RequestRouteStep[] = [
    {
      id: "request",
      kind: "request",
      label: `${input.host || "(any host)"}${normalizePath(input.path)}`,
      reason: `${input.scheme}:${input.port || defaultPort(input.scheme)} request`,
      status: "matched"
    },
    {
      id: `server:${server.nodeId}`,
      kind: "server",
      label: formatServer(server),
      reason: server.names.length ? `Server name matched ${input.host}.` : "Fallback/default server matched.",
      status: "matched",
      nodeId: server.nodeId,
      source: server.source
    },
    {
      id: `location:${location.nodeId}`,
      kind: "location",
      label: formatLocation(location),
      reason: `Location matched by ${location.kind}: ${location.pattern}.`,
      status: "matched",
      nodeId: location.nodeId,
      source: location.source
    }
  ];

  const visited = new Set<string>([location.nodeId]);
  let current = location.nodeId;
  for (let depth = 0; depth < 4; depth += 1) {
    const edge = edges.find((candidate) => candidate.source === current && !visited.has(candidate.target));
    if (!edge) break;
    visited.add(edge.target);
    current = edge.target;
    const node = nodes.get(edge.target);
    if (!node) break;
    steps.push({
      id: `edge:${edge.id}`,
      kind: node.type === "entry" ? "entry" : node.type === "route" ? "route" : node.type,
      label: node.label,
      reason: edge.label ? `${edge.label}: ${node.label}` : `Continues to ${node.label}.`,
      status: confidence === "low" ? "candidate" : "matched",
      nodeId: node.id,
      edgeId: edge.id,
      source: node.source
    });
  }

  return steps;
}

function buildFailureTrace(
  input: RequestSimulationInput,
  server: RoutingServer,
  reason: string,
  namedMatch: boolean
): RequestRouteStep[] {
  const steps: RequestRouteStep[] = [
    {
      id: "request",
      kind: "request",
      label: `${input.host || "(any host)"}${normalizePath(input.path)}`,
      reason: `${input.scheme}:${input.port || defaultPort(input.scheme)} request`,
      status: "matched"
    },
    {
      id: `server:${server.nodeId}`,
      kind: "server",
      label: formatServer(server),
      reason: namedMatch ? `Server name matched ${input.host}.` : "Fallback/default server candidate.",
      status: "matched",
      nodeId: server.nodeId,
      source: server.source
    },
    {
      id: `unknown:${server.nodeId}`,
      kind: "unknown",
      label: "No matching location",
      reason,
      status: "not-found"
    }
  ];
  return steps;
}

function formatServer(server: RoutingServer) {
  return server.names.join(" ") || server.nodeId;
}

function formatLocation(location: RoutingLocation) {
  return `location ${location.pattern}`;
}

function emptyResult(status: "no-server" | "no-location", summary: string, confidence: "high" | "medium" | "low", input: RequestSimulationInput): RequestSimulationResult {
  const step: RequestRouteStep = {
    id: "request",
    kind: "request",
    label: `${input.host || "(any host)"}${normalizePath(input.path)}`,
    reason: summary,
    status: "unknown"
  };
  return { status, confidence, nodeIds: [], edgeIds: [], summary, reasons: [summary], steps: [step], candidates: [] };
}

function extractPort(args: string[], context: "http" | "stream") {
  for (const arg of args) {
    const bracketMatch = arg.match(/^\[[^\]]+\]:(\d+)$/);
    if (bracketMatch) return Number(bracketMatch[1]);
    const portMatch = arg.match(/(?::|^)(\d+)$/);
    if (portMatch) return Number(portMatch[1]);
  }
  return context === "http" ? undefined : undefined;
}

function defaultPort(scheme: "http" | "https") {
  return scheme === "https" ? 443 : 80;
}

function directives(block: NginxBlock, name: string) {
  return block.children.filter((child) => !isBlock(child) && child.name === name) as NginxDirective[];
}

function nearestContext(parents: NginxBlock[]) {
  return parents.some((parent) => parent.name === "stream") ? "stream" : "http";
}

function walk(block: NginxBlock, visit: (node: NginxNode, parents: NginxBlock[]) => void, parents: NginxBlock[] = []) {
  block.children.forEach((child) => {
    visit(child, [...parents, block]);
    if (isBlock(child)) walk(child, visit, [...parents, block]);
  });
}

function hash(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = Math.imul(31, h) + value.charCodeAt(i) | 0;
  return Math.abs(h).toString(36);
}
