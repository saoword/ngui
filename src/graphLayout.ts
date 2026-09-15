import type { Edge, Node } from "reactflow";
import type { TopologyGraph, TopologyNode } from "./parser";

const ranks: Record<TopologyNode["type"], number> = {
  entry: 0,
  server: 1,
  route: 2,
  variable: 3,
  upstream: 4,
  target: 5
};

export type LayoutDirection = "horizontal" | "vertical";

export interface FlowHighlight {
  nodeIds?: string[];
  edgeIds?: string[];
  active?: boolean;
}

const horizontalRankGap = 290;
const verticalRankGap = 180;
const start = 80;
const lanePaddingX = 28;
const lanePaddingY = 26;
const laneHeaderHeight = 0;
const laneGap = 72;
const groupNodeWidth = 216;
const groupNodeHeight = 78;
const groupMinWidth = 320;
const groupMinHeight = 148;
const groupBoundsPadding = 18;

const nodeStackGap = 44;
const nodeInnerWidth = groupNodeWidth - 24;
const nodeVerticalPadding = 20;
const nodeToplineHeight = 16;
const nodeLabelMarginTop = 8;
const nodeLabelFontSize = 16;
const nodeLabelLineHeight = 20;
const nodeSubtitleMarginTop = 5;
const nodeSubtitleFontSize = 12;
const nodeSubtitleLineHeight = 17;

export function toFlowElements(graph: TopologyGraph, query = "", selectedId?: string, layout: LayoutDirection = "horizontal", highlight: FlowHighlight = {}) {
  const lowerQuery = query.trim().toLowerCase();
  const queryActive = lowerQuery.length > 0;
  const groupedElements = buildServerGroupedElements(graph, lowerQuery, queryActive, selectedId, layout, highlight);
  if (groupedElements) return groupedElements;

  return buildDefaultElements(graph, lowerQuery, queryActive, selectedId, layout, highlight);
}

function buildDefaultElements(
  graph: TopologyGraph,
  lowerQuery: string,
  queryActive: boolean,
  selectedId?: string,
  layout: LayoutDirection = "horizontal",
  highlight: FlowHighlight = {}
) {
  const highlightedNodeIds = new Set(highlight.nodeIds || []);
  const highlightedEdgeIds = new Set(highlight.edgeIds || []);
  const highlightActive = Boolean(highlight.active) || highlightedNodeIds.size > 0 || highlightedEdgeIds.size > 0;
  const matchedNodeIds = new Set(
    queryActive
      ? graph.nodes.filter((node) => searchable(node).includes(lowerQuery)).map((node) => node.id)
      : []
  );
  const connected = new Set<string>();
  if (selectedId) {
    connected.add(selectedId);
    graph.edges.forEach((edge) => {
      if (edge.source === selectedId || edge.target === selectedId) {
        connected.add(edge.source);
        connected.add(edge.target);
      }
    });
  }

  const buckets = new Map<number, TopologyNode[]>();
  graph.nodes.forEach((node) => {
    const rank = ranks[node.type];
    const bucket = buckets.get(rank);
    if (bucket) {
      bucket.push(node);
    } else {
      buckets.set(rank, [node]);
    }
  });
  const stacks = new Map<number, StackLayout>();
  let maxStackSpan = 0;
  buckets.forEach((bucket, rank) => {
    const stack = buildStack(bucket);
    stacks.set(rank, stack);
    maxStackSpan = Math.max(maxStackSpan, stack.span);
  });
  const stackCenter = start + maxStackSpan / 2;

  const nodes: Node[] = graph.nodes.map((node) => {
    const rank = ranks[node.type];
    const stack = stacks.get(rank) || buildStack([]);
    const offset = stack.offsets.get(node.id) || 0;
    const matches = matchedNodeIds.has(node.id);
    const highlighted = highlightedNodeIds.has(node.id);
    const related = highlighted || (selectedId ? connected.has(node.id) : false);
    const dimmedBySelection = Boolean(selectedId && !related && selectedId !== node.id);
    const dimmedByQuery = queryActive && !matches;
    const dimmedByHighlight = highlightActive && !highlighted && !related;
    return {
      id: node.id,
      type: "nginxNode",
      position: layout === "horizontal"
        ? {
          x: start + rank * horizontalRankGap,
          y: stackCenter - stack.span / 2 + offset
        }
        : {
          x: stackCenter - stack.span / 2 + offset,
          y: start + rank * verticalRankGap
        },
      data: {
        ...node,
        layout,
        matches,
        related,
        dimmed: dimmedBySelection || dimmedByQuery || dimmedByHighlight
      }
    };
  });

  const edgeGroups = new Map<string, number>();
  const sourceEdgeIndexes = new Map<string, number>();
  const sourceEdgeCounts = new Map<string, number>();
  graph.edges.forEach((edge) => {
    const key = `${edge.source}->${edge.target}`;
    edgeGroups.set(key, (edgeGroups.get(key) || 0) + 1);
    const sourceIndex = sourceEdgeCounts.get(edge.source) || 0;
    sourceEdgeIndexes.set(edge.id, sourceIndex);
    sourceEdgeCounts.set(edge.source, sourceIndex + 1);
  });
  const edgeIndexes = new Map<string, number>();

  const edges: Edge[] = graph.edges.map((edge) => {
    const highlighted = highlightedEdgeIds.has(edge.id);
    const selected = highlighted || Boolean(selectedId && (edge.source === selectedId || edge.target === selectedId));
    const matches = queryActive && (
      Boolean(edge.label?.toLowerCase().includes(lowerQuery))
      || matchedNodeIds.has(edge.source)
      || matchedNodeIds.has(edge.target)
    );
    const key = `${edge.source}->${edge.target}`;
    const siblingCount = edgeGroups.get(key) || 1;
    const siblingIndex = edgeIndexes.get(key) || 0;
    edgeIndexes.set(key, siblingIndex + 1);
    const sourceFanout = sourceEdgeIndexes.get(edge.id) || 0;
    const offset = (siblingIndex - (siblingCount - 1) / 2) * 32 + ((sourceFanout % 5) - 2) * 12;
    const dimmed = Boolean((selectedId && !selected) || (queryActive && !matches) || (highlightActive && !highlighted));
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: layout === "vertical" ? "source-bottom" : "source-right",
      targetHandle: layout === "vertical" ? "target-top" : "target-left",
      animated: false,
      label: edge.label,
      type: "flowEdge",
      className: `${edge.type}-edge${selected ? " selected-edge" : ""}${highlighted ? " simulation-edge" : ""}${matches ? " search-edge" : ""}${dimmed ? " dimmed-edge" : ""}`,
      data: { ...edge, selected: Boolean(selected), matches, dimmed, offset, layout },
      style: {
        strokeWidth: selected ? 3 : 2,
        opacity: dimmed ? 0.18 : 1
      }
    };
  });

  return { nodes, edges };
}

function buildServerGroupedElements(
  graph: TopologyGraph,
  lowerQuery: string,
  queryActive: boolean,
  selectedId?: string,
  layout: LayoutDirection = "horizontal",
  highlight: FlowHighlight = {}
) {
  const highlightedNodeIds = new Set(highlight.nodeIds || []);
  const highlightedEdgeIds = new Set(highlight.edgeIds || []);
  const highlightActive = Boolean(highlight.active) || highlightedNodeIds.size > 0 || highlightedEdgeIds.size > 0;
  const serverNodes = graph.nodes.filter((node) => node.type === "server");
  if (serverNodes.length === 0) return null;

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const matchedNodeIds = new Set(
    queryActive
      ? graph.nodes.filter((node) => searchable(node).includes(lowerQuery)).map((node) => node.id)
      : []
  );
  const adjacency = new Map<string, string[]>();
  const outgoingEdges = new Map<string, TopologyGraph["edges"]>();
  const incomingEdges = new Map<string, TopologyGraph["edges"]>();

  graph.edges.forEach((edge) => {
    const outgoing = outgoingEdges.get(edge.source);
    if (outgoing) {
      outgoing.push(edge);
    } else {
      outgoingEdges.set(edge.source, [edge]);
    }

    const incoming = incomingEdges.get(edge.target);
    if (incoming) {
      incoming.push(edge);
    } else {
      incomingEdges.set(edge.target, [edge]);
    }

    const next = adjacency.get(edge.source);
    if (next) {
      next.push(edge.target);
    } else {
      adjacency.set(edge.source, [edge.target]);
    }
  });

  const laneSpecs = serverNodes.map((server) => {
    const nodeIds = reachableNodeIds(server.id, adjacency);
    nodeIds.add(server.id);
    const directEntries = (incomingEdges.get(server.id) || [])
      .filter((edge) => nodesById.get(edge.source)?.type === "entry")
      .map((edge) => nodesById.get(edge.source))
      .filter((node): node is TopologyNode => Boolean(node))
      .sort((left, right) => left.label.localeCompare(right.label));

    directEntries.forEach((entry) => nodeIds.add(entry.id));

    const edgeIds = reachableEdgeIds(server.id, outgoingEdges, nodeIds);
    (incomingEdges.get(server.id) || []).forEach((edge) => {
      if (directEntries.some((entry) => entry.id === edge.source)) edgeIds.add(edge.id);
    });

    return {
      server,
      directEntries,
      nodeIds,
      edgeIds
    };
  });

  const connectedLayoutIds = buildConnectedLayoutIds(graph.edges, laneSpecs, selectedId);
  const flowNodes: Node[] = [];
  const flowEdges: Edge[] = [];
  let laneCursorX = start;
  let laneCursorY = start;

  laneSpecs.forEach((lane) => {
    const laneNodes = [...lane.nodeIds]
      .map((id) => nodesById.get(id))
      .filter((node): node is TopologyNode => Boolean(node))
      .sort((left, right) => {
        const rankDiff = ranks[left.type] - ranks[right.type];
        if (rankDiff !== 0) return rankDiff;
        return left.label.localeCompare(right.label);
      });

    const buckets = new Map<number, TopologyNode[]>();
    laneNodes.forEach((node) => {
      const rank = ranks[node.type];
      const bucket = buckets.get(rank);
      if (bucket) {
        bucket.push(node);
      } else {
        buckets.set(rank, [node]);
      }
    });

    const stacks = new Map<number, StackLayout>();
    let maxStackSpan = 0;
    buckets.forEach((bucket, rank) => {
      const stack = buildStack(bucket);
      stacks.set(rank, stack);
      maxStackSpan = Math.max(maxStackSpan, stack.span);
    });
    const stackCenter = lanePaddingY + laneHeaderHeight + maxStackSpan / 2;
    const columnCenter = lanePaddingX + maxStackSpan / 2;

    const laneLayoutNodes = laneNodes.map((node) => {
      const rank = ranks[node.type];
      const stack = stacks.get(rank) || buildStack([]);
      const offset = stack.offsets.get(node.id) || 0;

      return {
        node,
        height: estimateNodeHeight(node),
        x: layout === "horizontal"
          ? lanePaddingX + rank * horizontalRankGap
          : columnCenter - stack.span / 2 + offset,
        y: layout === "horizontal"
          ? stackCenter - stack.span / 2 + offset
          : lanePaddingY + laneHeaderHeight + rank * verticalRankGap
      };
    });

    const bounds = computeLaneBounds(laneLayoutNodes);
    const laneOffset = { x: laneCursorX, y: laneCursorY };
    const laneId = `server-group-${lane.server.id}`;

    flowNodes.push({
      id: laneId,
      type: "laneGroup",
      position: laneOffset,
      data: {
        label: lane.server.label,
        subtitle: summarizeEntries(lane.directEntries),
        entryCount: lane.directEntries.length
      },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      style: {
        width: bounds.width,
        height: bounds.height
      }
    });

    laneLayoutNodes.forEach(({ node, x, y }) => {
      const layoutId = `${lane.server.id}::${node.id}`;
      const matches = matchedNodeIds.has(node.id);
      const highlighted = highlightedNodeIds.has(node.id);
      const related = highlighted || (selectedId ? connectedLayoutIds.has(layoutId) : false);
      const dimmedBySelection = Boolean(selectedId && !related && selectedId !== node.id);
      const dimmedByQuery = queryActive && !matches;
      const dimmedByHighlight = highlightActive && !highlighted && !related;

      flowNodes.push({
        id: layoutId,
        type: "nginxNode",
        position: {
          x: laneOffset.x + x - bounds.minX,
          y: laneOffset.y + y - bounds.minY
        },
        data: {
          ...node,
          nodeId: node.id,
          layout,
          matches,
          related,
          dimmed: dimmedBySelection || dimmedByQuery || dimmedByHighlight
        }
      });
    });

    graph.edges.forEach((edge) => {
      if (!lane.edgeIds.has(edge.id) || !lane.nodeIds.has(edge.source) || !lane.nodeIds.has(edge.target)) return;

      const highlighted = highlightedEdgeIds.has(edge.id);
      const selected = highlighted || Boolean(selectedId && (edge.source === selectedId || edge.target === selectedId));
      const matches = queryActive && (
        Boolean(edge.label?.toLowerCase().includes(lowerQuery))
        || matchedNodeIds.has(edge.source)
        || matchedNodeIds.has(edge.target)
      );
      const dimmed = Boolean((selectedId && !selected) || (queryActive && !matches) || (highlightActive && !highlighted));

      flowEdges.push({
        id: `${lane.server.id}::${edge.id}`,
        source: `${lane.server.id}::${edge.source}`,
        target: `${lane.server.id}::${edge.target}`,
        sourceHandle: layout === "vertical" ? "source-bottom" : "source-right",
        targetHandle: layout === "vertical" ? "target-top" : "target-left",
        animated: false,
        label: edge.label,
        type: "flowEdge",
        className: `${edge.type}-edge${selected ? " selected-edge" : ""}${highlighted ? " simulation-edge" : ""}${matches ? " search-edge" : ""}${dimmed ? " dimmed-edge" : ""}`,
        data: { ...edge, selected, matches, dimmed, offset: 0, layout },
        style: {
          strokeWidth: selected ? 3 : 2,
          opacity: dimmed ? 0.18 : 1
        }
      });
    });

    if (layout === "horizontal") {
      laneCursorY += bounds.height + laneGap;
    } else {
      laneCursorX += bounds.width + laneGap;
    }
  });

  return { nodes: flowNodes, edges: flowEdges };
}

function buildConnectedLayoutIds(
  edges: TopologyGraph["edges"],
  lanes: Array<{ server: TopologyNode; edgeIds: Set<string> }>,
  selectedId?: string
) {
  const connectedLayoutIds = new Set<string>();
  if (!selectedId) return connectedLayoutIds;

  lanes.forEach((lane) => {
    connectedLayoutIds.add(`${lane.server.id}::${selectedId}`);
    edges.forEach((edge) => {
      if (!lane.edgeIds.has(edge.id)) return;
      if (edge.source === selectedId || edge.target === selectedId) {
        connectedLayoutIds.add(`${lane.server.id}::${edge.source}`);
        connectedLayoutIds.add(`${lane.server.id}::${edge.target}`);
      }
    });
  });

  return connectedLayoutIds;
}

function reachableNodeIds(sourceId: string, adjacency: Map<string, string[]>) {
  const visited = new Set<string>();
  const queue = [sourceId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    (adjacency.get(current) || []).forEach((target) => {
      if (!visited.has(target)) queue.push(target);
    });
  }

  return visited;
}

function reachableEdgeIds(
  sourceId: string,
  outgoingEdges: Map<string, TopologyGraph["edges"]>,
  visitedNodeIds: Set<string>
) {
  const visitedEdges = new Set<string>();
  const queue = [sourceId];
  const traversedNodes = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || traversedNodes.has(current)) continue;
    traversedNodes.add(current);

    (outgoingEdges.get(current) || []).forEach((edge) => {
      if (visitedNodeIds.has(edge.target)) {
        visitedEdges.add(edge.id);
        queue.push(edge.target);
      }
    });
  }

  return visitedEdges;
}

function computeLaneBounds(nodes: Array<{ x: number; y: number; height: number }>) {
  if (nodes.length === 0) {
    return {
      minX: 0,
      minY: 0,
      width: groupMinWidth,
      height: groupMinHeight
    };
  }

  const minX = Math.min(...nodes.map((node) => node.x)) - groupBoundsPadding;
  const minY = 0;
  const maxX = Math.max(...nodes.map((node) => node.x + groupNodeWidth)) + groupBoundsPadding;
  const maxY = Math.max(...nodes.map((node) => node.y + node.height)) + groupBoundsPadding;

  return {
    minX,
    minY,
    width: Math.max(groupMinWidth, maxX - minX),
    height: Math.max(groupMinHeight, maxY - minY)
  };
}

function summarizeEntries(entries: TopologyNode[]) {
  if (entries.length === 0) return undefined;
  if (entries.length === 1) return entries[0].label;
  const preview = entries.slice(0, 2).map((entry) => entry.label).join(" | ");
  return entries.length > 2 ? `${preview} | +${entries.length - 2}` : preview;
}

interface StackLayout {
  offsets: Map<string, number>;
  span: number;
}

function buildStack(nodes: TopologyNode[]): StackLayout {
  const offsets = new Map<string, number>();
  let cursor = 0;
  nodes.forEach((node) => {
    offsets.set(node.id, cursor);
    cursor += estimateNodeHeight(node) + nodeStackGap;
  });
  return { offsets, span: Math.max(groupNodeHeight, cursor - nodeStackGap) };
}

function estimateNodeHeight(node: TopologyNode) {
  const labelLines = estimateLines(node.label, nodeLabelFontSize, nodeInnerWidth);
  const subtitleLines = node.subtitle ? estimateLines(node.subtitle, nodeSubtitleFontSize, nodeInnerWidth) : 0;
  const height = nodeVerticalPadding
    + nodeToplineHeight
    + nodeLabelMarginTop
    + labelLines * nodeLabelLineHeight
    + (node.subtitle ? nodeSubtitleMarginTop + subtitleLines * nodeSubtitleLineHeight : 0);
  return Math.max(groupNodeHeight, height);
}

function estimateLines(text: string, fontSize: number, maxWidth: number) {
  return text.split("\n").reduce((lines, segment) => {
    return lines + Math.max(1, Math.ceil(estimateTextWidth(segment, fontSize) / maxWidth));
  }, 0);
}

function estimateTextWidth(text: string, fontSize: number) {
  let width = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) || 0;
    width += codePoint > 0x2e80 ? fontSize : fontSize * 0.56;
  }
  return width;
}

function searchable(node: TopologyNode) {
  return `${node.label} ${node.subtitle || ""} ${node.raw || ""} ${node.details.join(" ")}`.toLowerCase();
}
