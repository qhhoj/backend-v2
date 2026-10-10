import { LegacySourceService } from '../../legacy-source.service';
import { CommentPages } from './comment-pages';

type Node = {
  id: number;
  parent_id: number | null;
  page: string;
  hidden: number;
  body_length: number | null;
  author_exists: number;
};

/** Deepest legacy thread the walk follows before calling it a cycle (v2 caps depth at 100). */
const MAX_DEPTH = 1000;

/** Every legacy comment's parent, page, author and body presence, so a comment's fate depends on its ancestors (parents may have higher ids). */
export class CommentTree {
  private readonly nodes = new Map<number, Node>();
  private readonly reasons = new Map<number, string | null>();

  constructor(readonly pages: CommentPages) {}

  async load(source: LegacySourceService): Promise<void> {
    await this.pages.load(source);
    const rows = await source.query<Node>(
      `SELECT c.id, c.parent_id, c.page, c.hidden, CHAR_LENGTH(c.body) AS body_length,
        a.id IS NOT NULL AS author_exists
       FROM judge_comment c LEFT JOIN judge_profile a ON a.id = c.author_id`,
    );
    for (const row of rows) this.nodes.set(row.id, row);
  }

  /** Why a comment is not imported; null when it is. */
  skipReason(id: number, depth = 0): string | null {
    if (this.reasons.has(id)) return this.reasons.get(id)!;
    const reason = this.reasonOf(id, depth);
    this.reasons.set(id, reason);
    return reason;
  }

  /** Legacy id of the nearest hidden ancestor (never `id` itself); null when no ancestor is hidden. */
  hiddenAncestor(id: number): number | null {
    const ancestors = this.lineage(id).slice(0, -1).reverse();
    return (
      ancestors.find((ancestor) => Number(this.nodes.get(ancestor)?.hidden)) ??
      null
    );
  }

  /** Legacy ids from the thread root down to `id`. */
  lineage(id: number): number[] {
    const chain: number[] = [];
    for (
      let current: number | null = id;
      current !== null && chain.length < MAX_DEPTH;
      current = this.nodes.get(current)?.parent_id ?? null
    )
      chain.unshift(current);
    return chain;
  }

  private reasonOf(id: number, depth: number): string | null {
    const node = this.nodes.get(id);
    if (!node) return 'missing';
    if (depth > MAX_DEPTH) return 'cycle';
    if (node.parent_id !== null && this.skipReason(node.parent_id, depth + 1))
      return 'ancestor skipped';
    if (this.pages.isBlog(node.page)) return 'legacy blog not migrated';
    if (!this.pages.resolve(node.page)) return 'page gone';
    if (!Number(node.author_exists)) return 'author missing';
    return node.body_length ? null : 'empty body';
  }
}
