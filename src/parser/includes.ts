import { isBlock } from "./parser";
import type { NginxBlock, NginxNode } from "./types";

interface ExpansionState {
  counter: number;
}

/**
 * Resolves `include` directives against the files captured by the
 * `# configuration file <path>:` markers in an `nginx -T` dump.
 *
 * The dump keeps every file as a flat top level section, so an included
 * location/upstream file is not physically nested inside the block that
 * includes it. This re-attaches each included file at its include site,
 * which restores the `http`/`stream`/`server` context that the flat text
 * loses. Files that are never reached by an include are kept at the top
 * level so nothing is dropped, and configurations without markers are
 * returned unchanged.
 */
export function expandIncludes(ast: NginxBlock): NginxBlock {
  const files = collectFiles(ast);
  const fileOrder = [...files.keys()];
  if (fileOrder.length === 0) return ast;

  const consumed = new Set<string>();
  const stack = new Set<string>();
  const mainFile = fileOrder[0];
  stack.add(mainFile);

  const children = expandNodes(files.get(mainFile) || [], files, stack, consumed);

  fileOrder.forEach((file) => {
    if (file === mainFile || consumed.has(file)) return;
    children.push(...(files.get(file) || []));
  });

  const state: ExpansionState = { counter: 0 };
  return { ...ast, children: children.map((child) => cloneNode(child, state)) };
}

function collectFiles(ast: NginxBlock) {
  const files = new Map<string, NginxNode[]>();
  ast.children.forEach((child) => {
    const file = child.loc.file;
    if (!file) return;
    const bucket = files.get(file);
    if (bucket) {
      bucket.push(child);
    } else {
      files.set(file, [child]);
    }
  });
  return files;
}

function expandNodes(
  nodes: NginxNode[],
  files: Map<string, NginxNode[]>,
  stack: Set<string>,
  consumed: Set<string>
): NginxNode[] {
  const expanded: NginxNode[] = [];

  nodes.forEach((node) => {
    if (!isBlock(node) && node.name === "include") {
      let resolved = false;
      node.args.forEach((pattern) => {
        resolveInclude(pattern, files).forEach((file) => {
          resolved = true;
          consumed.add(file);
          if (stack.has(file)) return;
          stack.add(file);
          expanded.push(...expandNodes(files.get(file) || [], files, stack, consumed));
          stack.delete(file);
        });
      });
      if (!resolved) expanded.push(node);
      return;
    }

    if (isBlock(node)) {
      expanded.push({ ...node, children: expandNodes(node.children, files, stack, consumed) });
      return;
    }

    expanded.push(node);
  });

  return expanded;
}

function resolveInclude(pattern: string, files: Map<string, NginxNode[]>) {
  const trimmed = pattern.trim();
  if (!trimmed) return [];
  if (files.has(trimmed)) return [trimmed];
  if (!/[*?]/.test(trimmed)) return [];

  const matcher = globMatcher(trimmed);
  return [...files.keys()].filter((file) => matcher.test(file)).sort();
}

function globMatcher(pattern: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = escaped.replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  const start = pattern.startsWith("/") ? "^" : "(?:^|/)";
  return new RegExp(`${start}${body}$`);
}

function cloneNode(node: NginxNode, state: ExpansionState): NginxNode {
  const id = `${node.id}~${state.counter}`;
  state.counter += 1;
  if (isBlock(node)) {
    return { ...node, id, children: node.children.map((child) => cloneNode(child, state)) };
  }
  return { ...node, id };
}
