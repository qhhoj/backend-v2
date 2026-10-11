import {
  canReplyAfter,
  childPath,
  COMMENT_REPLY_WINDOW_MS,
  depthOf,
  pagePath,
  rootOf,
  subtreeFilter,
} from './comments';

describe('comment rules', () => {
  const root = '0199a000-0000-7000-8000-000000000001';
  const child = '0199a000-0000-7000-8000-000000000002';
  const grandchild = '0199a000-0000-7000-8000-000000000003';

  it('builds materialized paths, their root and depth', () => {
    const childAt = childPath(root, child);
    const grandchildAt = childPath(childAt, grandchild);
    expect(childPath(null, root)).toBe(root);
    expect(grandchildAt).toBe(`${root}/${child}/${grandchild}`);
    expect([depthOf(root), depthOf(childAt), depthOf(grandchildAt)]).toEqual([
      0, 1, 2,
    ]);
    expect(rootOf(grandchildAt)).toBe(root);
  });

  it('selects a comment by equality and its descendants by an anchored prefix, never a sibling sharing a prefix', () => {
    const node = `${root}/${child}`;
    const [self, descendants] = subtreeFilter(node).$or;
    expect(self).toEqual({ path: node });
    expect(descendants.path.test(`${node}/${grandchild}`)).toBe(true);
    expect(descendants.path.test(node)).toBe(false);
    expect(descendants.path.test(`${node}x`)).toBe(false);
    expect(descendants.path.test(`${root}/${grandchild}`)).toBe(false);
    expect(descendants.path.test(root)).toBe(false);
  });

  it('allows replies before 365 days (exactly 365 refuses), older ones only to moderators', () => {
    const created = new Date('2025-01-01T00:00:00Z');
    const edge = new Date(created.getTime() + COMMENT_REPLY_WINDOW_MS);
    const past = new Date(edge.getTime() + 1);
    expect(canReplyAfter(created, new Date(edge.getTime() - 1), false)).toBe(
      true,
    );
    expect(canReplyAfter(created, edge, false)).toBe(false);
    expect(canReplyAfter(created, past, false)).toBe(false);
    expect(canReplyAfter(created, past, true)).toBe(true);
  });

  it('encodes page keys so they cannot break out of the route', () => {
    expect(pagePath('problem', 'a/b?c')).toBe('/problem/a%2Fb%3Fc');
  });
});
