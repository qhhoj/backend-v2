import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import type { Share } from '@libs/database';
import { ProblemAccess } from '../../problems/core/problem-access';
import type { ProblemDocument } from '../../problems/core/problems.repository';
import { sourceFilename } from '../../submissions/core/source-file';
import type { SourceFile } from '../../submissions/core/source-file';
import { readKeys, READ_LIMIT, READ_WINDOW_SECONDS } from '../core/rate-limits';
import { ShareAccessService } from '../core/share-access.service';
import type { ReadableShare } from '../core/share-access.service';
import {
  ShareViewResponse,
  type ShareProblemResponse,
  type ShareViewerResponse,
} from './dto/share-view.response';

/** `<code>.<extension>` (`Main.java` for Java), as submission sources are named. */
const filenameOf = (share: Share): string =>
  sourceFilename(share.code, share.language.extension);

/** Resolved for each viewer: a private, hidden or deleted problem shows neither name nor link. */
const problemLinkFor = (
  principal: Principal | null,
  problem: ProblemDocument | null,
): ShareProblemResponse | null =>
  problem &&
  !problem.deletedAt &&
  ProblemAccess.canSee(principal, ProblemAccess.accessView(problem), null)
    ? { code: problem.code, name: problem.name }
    : null;

const viewerOf = (
  principal: Principal | null,
  { share, isOwner, canManage }: ReadableShare,
): ShareViewerResponse => ({
  isOwner,
  canEdit: isOwner,
  canDelete: (isOwner && !share.takenDown) || canManage,
  canTakeDown: canManage,
  canReport: principal !== null && !isOwner,
});

/** The public reads of `/c/<code>`: the page and its file. */
@Injectable()
export class ShareReadService {
  constructor(
    private readonly access: ShareAccessService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async view(
    principal: Principal | null,
    code: string,
    ip: string,
  ): Promise<ShareViewResponse> {
    const readable = await this.read(principal, code, ip);
    return ShareViewResponse.from(readable, {
      filename: filenameOf(readable.share),
      problem: problemLinkFor(principal, readable.problem),
      viewer: viewerOf(principal, readable),
    });
  }

  async file(
    principal: Principal | null,
    code: string,
    ip: string,
  ): Promise<SourceFile> {
    const { share } = await this.read(principal, code, ip);
    return { filename: filenameOf(share), text: share.source };
  }

  /** Counted before the lookup, so guessing codes spends the budget too. */
  private async read(
    principal: Principal | null,
    code: string,
    ip: string,
  ): Promise<ReadableShare> {
    await this.rateLimit.reserve(
      readKeys(principal, ip),
      READ_LIMIT,
      READ_WINDOW_SECONDS,
    );
    return this.access.readable(principal, code, {
      withSource: true,
      now: new Date(),
    });
  }
}
