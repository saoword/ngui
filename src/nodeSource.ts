const DATA_BASE = "data/";
const INDEX_FILE = "index.json";

export interface NodeIndexEntry {
  id: string;
  file: string;
  label?: string;
  collectedAt?: string;
  status?: string;
  nginxVersion?: string;
}

export interface NodeIndex {
  generatedAt?: string;
  nodes: NodeIndexEntry[];
}

export function dataEntryUrl(file: string): string | null {
  if (!file) return null;
  if (file.startsWith("/") || file.includes("..") || file.includes("\\")) return null;
  return `${DATA_BASE}${file}`;
}

export async function fetchNodeIndex(): Promise<NodeIndex | null> {
  if (typeof fetch !== "function") return null;
  try {
    const response = await fetch(`${DATA_BASE}${INDEX_FILE}`, { cache: "no-store" });
    if (!response.ok) return null;
    return normalizeNodeIndex(await response.json());
  } catch {
    return null;
  }
}

export async function fetchNodeConfig(entry: NodeIndexEntry): Promise<string | null> {
  const url = dataEntryUrl(entry.file);
  if (!url || typeof fetch !== "function") return null;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function normalizeNodeIndex(payload: unknown): NodeIndex | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.nodes)) return null;

  const nodes: NodeIndexEntry[] = [];
  for (const item of record.nodes) {
    if (!item || typeof item !== "object") continue;
    const node = item as Record<string, unknown>;
    const id = readString(node.id);
    const file = readString(node.file);
    if (!id || !file || dataEntryUrl(file) === null) continue;
    nodes.push({
      id,
      file,
      label: readString(node.label),
      collectedAt: readString(node.collectedAt),
      status: readString(node.status),
      nginxVersion: readString(node.nginxVersion)
    });
  }

  return { generatedAt: readString(record.generatedAt), nodes };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
