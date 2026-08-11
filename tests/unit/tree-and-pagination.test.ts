import { describe, expect, it } from 'vitest';
import { nodeDepth, validateReparent, validateTree, type TreeNode } from '@/lib/tree';
import { buildMeta, parsePagination, resolveOrder, resolveSort } from '@/lib/pagination';
import { POST_SORT_FIELDS } from '@/lib/domain';
import {
  utcDateKey,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
  parseStoredDate,
} from '@/lib/datetime';

describe('tree depth and cycles', () => {
  const asMap = (nodes: TreeNode[]) => new Map(nodes.map((node) => [node.id, node]));

  it('measures depth from the root', () => {
    const nodes = asMap([
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
      { id: 3, parentId: 2 },
    ]);
    expect(nodeDepth(nodes, 1)).toBe(1);
    expect(nodeDepth(nodes, 2)).toBe(2);
    expect(nodeDepth(nodes, 3)).toBe(3);
  });

  it('returns null instead of looping forever on a cycle', () => {
    const nodes = asMap([
      { id: 1, parentId: 2 },
      { id: 2, parentId: 1 },
    ]);
    expect(nodeDepth(nodes, 1)).toBeNull();
  });
});

describe('validateTree', () => {
  it('accepts a valid two-level tree', () => {
    expect(
      validateTree([
        { id: 1, parentId: null },
        { id: 2, parentId: null },
        { id: 3, parentId: 1 },
      ]),
    ).toEqual([]);
  });

  it('rejects self-parenting', () => {
    const errors = validateTree([{ id: 1, parentId: 1 }]);
    expect(errors[0]?.kind).toBe('SELF_PARENT');
  });

  it('rejects a two-node cycle (A → B → A)', () => {
    const errors = validateTree([
      { id: 1, parentId: 2 },
      { id: 2, parentId: 1 },
    ]);
    expect(errors.some((error) => error.kind === 'CYCLE')).toBe(true);
  });

  it('rejects a parent that is not in the payload', () => {
    const errors = validateTree([{ id: 1, parentId: 99 }]);
    expect(errors[0]).toEqual({ kind: 'MISSING_PARENT', id: 1, parentId: 99 });
  });

  it('rejects nesting deeper than two levels', () => {
    const errors = validateTree([
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
      { id: 3, parentId: 2 },
    ]);
    expect(errors.some((error) => error.kind === 'TOO_DEEP')).toBe(true);
  });
});

describe('validateReparent', () => {
  const existing: TreeNode[] = [
    { id: 1, parentId: null },
    { id: 2, parentId: null },
    { id: 3, parentId: 1 },
  ];

  it('allows moving a leaf under a root', () => {
    expect(validateReparent(existing, 2, 1)).toBeNull();
  });

  it('allows promoting a child to the root', () => {
    expect(validateReparent(existing, 3, null)).toBeNull();
  });

  it('rejects self-parenting', () => {
    expect(validateReparent(existing, 1, 1)?.kind).toBe('SELF_PARENT');
  });

  it('rejects moving a parent under its own descendant', () => {
    expect(validateReparent(existing, 1, 3)?.kind).toBeDefined();
  });

  it('rejects a move that would push a descendant past the depth limit', () => {
    // Moving 1 (which has child 3) under 2 would make 3 a third-level node.
    expect(validateReparent(existing, 1, 2)?.kind).toBe('TOO_DEEP');
  });
});

describe('parsePagination', () => {
  it('applies defaults for missing values', () => {
    expect(parsePagination(undefined, undefined)).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it('coerces numeric strings', () => {
    expect(parsePagination('3', '10')).toEqual({ page: 3, pageSize: 10, offset: 20 });
  });

  it('clamps pageSize to the maximum of 100', () => {
    expect(parsePagination(1, 5000).pageSize).toBe(100);
  });

  it('clamps a page below 1 up to 1', () => {
    expect(parsePagination(-4, 20).page).toBe(1);
    expect(parsePagination(0, 20).page).toBe(1);
  });

  it('falls back to defaults for junk input', () => {
    expect(parsePagination('abc', 'xyz')).toEqual({ page: 1, pageSize: 20, offset: 0 });
    expect(parsePagination(null, {})).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });
});

describe('buildMeta', () => {
  it('computes total pages by ceiling', () => {
    expect(buildMeta(1, 20, 41)).toEqual({ page: 1, pageSize: 20, total: 41, totalPages: 3 });
  });

  it('reports zero pages for an empty result', () => {
    expect(buildMeta(1, 20, 0).totalPages).toBe(0);
  });
});

describe('resolveSort', () => {
  it('accepts only allow-listed fields', () => {
    expect(resolveSort('subject', POST_SORT_FIELDS, 'updatedAt')).toBe('subject');
  });

  it('falls back for anything not on the list', () => {
    expect(resolveSort('password_hash', POST_SORT_FIELDS, 'updatedAt')).toBe('updatedAt');
    expect(resolveSort('id; DROP TABLE posts', POST_SORT_FIELDS, 'updatedAt')).toBe('updatedAt');
    expect(resolveSort(undefined, POST_SORT_FIELDS, 'updatedAt')).toBe('updatedAt');
    expect(resolveSort(42, POST_SORT_FIELDS, 'updatedAt')).toBe('updatedAt');
  });
});

describe('resolveOrder', () => {
  it('accepts asc and desc only', () => {
    expect(resolveOrder('asc')).toBe('asc');
    expect(resolveOrder('desc')).toBe('desc');
    expect(resolveOrder('sideways')).toBe('desc');
  });
});

describe('viewer day key', () => {
  it('buckets by UTC calendar day', () => {
    expect(utcDateKey(new Date('2026-08-10T23:59:59.999Z'))).toBe('2026-08-10');
    expect(utcDateKey(new Date('2026-08-11T00:00:00.000Z'))).toBe('2026-08-11');
  });

  it('uses UTC rather than local time', () => {
    // 22:00 UTC is already the next day in Tokyo, but the bucket stays UTC.
    expect(utcDateKey(new Date('2026-08-10T22:00:00.000Z'))).toBe('2026-08-10');
  });
});

describe('timestamp parsing', () => {
  it('parses ISO strings written by the application', () => {
    expect(parseStoredDate('2026-08-10T12:00:00.000Z')?.toISOString()).toBe(
      '2026-08-10T12:00:00.000Z',
    );
  });

  it('treats a SQL CURRENT_TIMESTAMP value as UTC', () => {
    expect(parseStoredDate('2026-08-10 12:00:00')?.toISOString()).toBe('2026-08-10T12:00:00.000Z');
  });

  it('returns null for junk', () => {
    expect(parseStoredDate('not a date')).toBeNull();
    expect(parseStoredDate('')).toBeNull();
  });
});

describe('datetime-local conversion', () => {
  it('round-trips through a non-UTC timezone', () => {
    const iso = '2026-08-10T12:00:00.000Z';
    const local = toDateTimeLocalValue(iso, 'Africa/Cairo');
    expect(fromDateTimeLocalValue(local, 'Africa/Cairo')).toBe(iso);
  });

  it('round-trips through UTC', () => {
    const iso = '2026-01-02T08:30:00.000Z';
    const local = toDateTimeLocalValue(iso, 'UTC');
    expect(local).toBe('2026-01-02T08:30');
    expect(fromDateTimeLocalValue(local, 'UTC')).toBe(iso);
  });

  it('returns null for a malformed local value', () => {
    expect(fromDateTimeLocalValue('nonsense', 'UTC')).toBeNull();
    expect(fromDateTimeLocalValue('', 'UTC')).toBeNull();
  });
});
