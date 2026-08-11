import { MAX_TREE_DEPTH } from './domain';

/**
 * Shared cycle/depth validation for the two hierarchies in the product:
 * category parents and menu-item parents. Both cap at `MAX_TREE_DEPTH` levels.
 */

export interface TreeNode {
  id: number;
  parentId: number | null;
}

export type TreeError =
  | { kind: 'SELF_PARENT'; id: number }
  | { kind: 'MISSING_PARENT'; id: number; parentId: number }
  | { kind: 'CYCLE'; id: number }
  | { kind: 'TOO_DEEP'; id: number; depth: number };

/**
 * Depth of `id` within `nodes`, 1-based. Returns `null` when the chain cycles.
 */
export function nodeDepth(nodes: Map<number, TreeNode>, id: number): number | null {
  let depth = 1;
  let current = nodes.get(id);
  const seen = new Set<number>([id]);

  while (current?.parentId != null) {
    if (seen.has(current.parentId)) return null;
    seen.add(current.parentId);
    const parent = nodes.get(current.parentId);
    if (!parent) break;
    depth += 1;
    if (depth > 64) return null;
    current = parent;
  }
  return depth;
}

/**
 * Validate an entire proposed tree. Returns every problem found so the caller can
 * reject the whole request rather than saving a partially valid ordering.
 */
export function validateTree(
  candidates: readonly TreeNode[],
  maxDepth = MAX_TREE_DEPTH,
): TreeError[] {
  const nodes = new Map<number, TreeNode>();
  for (const node of candidates) nodes.set(node.id, node);

  const errors: TreeError[] = [];

  for (const node of candidates) {
    if (node.parentId === node.id) {
      errors.push({ kind: 'SELF_PARENT', id: node.id });
      continue;
    }
    if (node.parentId != null && !nodes.has(node.parentId)) {
      errors.push({ kind: 'MISSING_PARENT', id: node.id, parentId: node.parentId });
      continue;
    }
    const depth = nodeDepth(nodes, node.id);
    if (depth === null) {
      errors.push({ kind: 'CYCLE', id: node.id });
    } else if (depth > maxDepth) {
      errors.push({ kind: 'TOO_DEEP', id: node.id, depth });
    }
  }

  return errors;
}

/**
 * Would setting `parentId` on `id` create a cycle or exceed the depth limit?
 * Used for single-record category/menu-item edits.
 */
export function validateReparent(
  existing: readonly TreeNode[],
  id: number,
  parentId: number | null,
  maxDepth = MAX_TREE_DEPTH,
): TreeError | null {
  if (parentId === id) return { kind: 'SELF_PARENT', id };

  const next = existing.map((node) => (node.id === id ? { id, parentId } : node));
  if (!next.some((node) => node.id === id)) next.push({ id, parentId });

  const nodes = new Map<number, TreeNode>();
  for (const node of next) nodes.set(node.id, node);

  if (parentId != null && !nodes.has(parentId)) {
    return { kind: 'MISSING_PARENT', id, parentId };
  }

  const depth = nodeDepth(nodes, id);
  if (depth === null) return { kind: 'CYCLE', id };
  if (depth > maxDepth) return { kind: 'TOO_DEEP', id, depth };

  // Moving a node also pushes its descendants down; check the deepest one.
  const childrenOf = new Map<number, number[]>();
  for (const node of next) {
    if (node.parentId == null) continue;
    const bucket = childrenOf.get(node.parentId);
    if (bucket) bucket.push(node.id);
    else childrenOf.set(node.parentId, [node.id]);
  }

  const queue: Array<{ id: number; depth: number }> = [{ id, depth }];
  const visited = new Set<number>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);
    if (current.depth > maxDepth) return { kind: 'TOO_DEEP', id: current.id, depth: current.depth };
    for (const childId of childrenOf.get(current.id) ?? []) {
      queue.push({ id: childId, depth: current.depth + 1 });
    }
  }

  return null;
}

export function describeTreeError(error: TreeError): string {
  switch (error.kind) {
    case 'SELF_PARENT':
      return 'An item cannot be its own parent.';
    case 'MISSING_PARENT':
      return `Parent ${error.parentId} does not exist in this menu.`;
    case 'CYCLE':
      return 'The requested parent relationship creates a cycle.';
    case 'TOO_DEEP':
      return `Nesting is limited to ${MAX_TREE_DEPTH} levels (requested depth ${error.depth}).`;
  }
}
