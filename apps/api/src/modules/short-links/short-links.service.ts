import { Inject, Injectable, Logger } from '@nestjs/common';
import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import {
  AppError,
  invalidField,
  isDuplicateKey,
  Paginated,
  RateLimitService,
} from '@libs/common';
import type { ShortLink } from '@libs/database';
import type {
  CreateShortLinkDto,
  ShortLinkListQueryDto,
} from './dto/short-link.dto';
import {
  CreatedShortLinkResponse,
  ShortLinkResponse,
} from './dto/short-link.response';
import {
  CREATE_LIMIT,
  CREATE_WINDOW_SECONDS,
  MAX_CODE_ATTEMPTS,
  VISIT_LIMIT,
  VISIT_WINDOW_SECONDS,
} from './rate-limits';
import { isReservedShortCode, SHORT_CODE_SOURCE } from './short-code';
import type { ShortCodeSource } from './short-code';
import { shortTargetOf } from './short-target';
import { ShortLinksRepository } from './short-links.repository';

const MANAGE = 'judge.manage_short_link';
const notFound = () => new AppError('not_found', 404, 'No such short link');
/** A visit's 404 must not be cached: the code may be created next. */
const visitNotFound = () =>
  new AppError('not_found', 404, 'No such short link', undefined, {
    'Cache-Control': 'no-store',
  });
const noRelease = (): Promise<void> => Promise.resolve();

@Injectable()
export class ShortLinksService {
  private readonly logger = new Logger(ShortLinksService.name);

  constructor(
    private readonly links: ShortLinksRepository,
    private readonly rateLimit: RateLimitService,
    @Inject(SHORT_CODE_SOURCE) private readonly codes: ShortCodeSource,
  ) {}

  /** Anyone signed in gets the one automatic link of an allowed path (idempotent); staff may pick the code and an expiry and have no daily quota. */
  async create(
    principal: Principal,
    dto: CreateShortLinkDto,
  ): Promise<CreatedShortLinkResponse> {
    const path = shortTargetOf(dto.path);
    if (path === null)
      throw invalidField(
        'path',
        'Only problems, contests, posts, users and organizations of this site can be shortened.',
      );
    const isChosen = dto.code !== undefined || dto.expiresAt !== undefined;
    if (isChosen && !hasPermission(principal, MANAGE))
      throw new AppError(
        'forbidden',
        403,
        `Choosing a code or an expiry needs ${MANAGE}`,
      );
    if (dto.code !== undefined && isReservedShortCode(dto.code))
      throw invalidField('code', 'This code is reserved.');
    if (dto.expiresAt !== undefined && new Date(dto.expiresAt) <= new Date())
      throw invalidField('expiresAt', 'The expiry must be in the future.');
    const release = await this.reserveCreate(principal);
    try {
      const { link, isNew } = isChosen
        ? { link: await this.insertChosen(principal, path, dto), isNew: true }
        : await this.automaticLink(principal, path);
      if (!isNew) await release();
      return CreatedShortLinkResponse.from(link);
    } catch (error) {
      // No link was made (taken code, no free code, database error): the slot goes back.
      await release();
      throw error;
    }
  }

  /** Staff are not held to the daily quota; everyone else gets `CREATE_LIMIT` new links a day. */
  private reserveCreate(principal: Principal): Promise<() => Promise<void>> {
    if (hasPermission(principal, MANAGE)) return Promise.resolve(noRelease);
    return this.rateLimit.reserve(
      [`short-link:user:${principal.userId}`],
      CREATE_LIMIT,
      CREATE_WINDOW_SECONDS,
    );
  }

  private async automaticLink(
    principal: Principal,
    path: string,
  ): Promise<{ link: ShortLink; isNew: boolean }> {
    const existing = await this.links.findAutoByPath(path);
    if (existing) return { link: existing, isNew: false };
    try {
      const link = await this.insert(
        { path, createdBy: principal.userId, isAuto: true },
        undefined,
      );
      return { link, isNew: true };
    } catch (error) {
      // A parallel request made the path's link first.
      if (!isDuplicateKey(error, 'path')) throw error;
      return { link: (await this.links.findAutoByPath(path))!, isNew: false };
    }
  }

  private insertChosen(
    principal: Principal,
    path: string,
    dto: CreateShortLinkDto,
  ): Promise<ShortLink> {
    return this.insert(
      {
        path,
        createdBy: principal.userId,
        isAuto: false,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      dto.code,
    );
  }

  /** A chosen code is tried once; a generated one is redrawn on collision. */
  private async insert(
    fields: Partial<ShortLink>,
    chosenCode: string | undefined,
  ): Promise<ShortLink> {
    const attempts = chosenCode === undefined ? MAX_CODE_ATTEMPTS : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.links.create({
          ...fields,
          code: chosenCode ?? this.codes.next(),
        });
      } catch (error) {
        if (!isDuplicateKey(error, 'code')) throw error;
      }
    }
    throw new AppError(
      'conflict',
      409,
      chosenCode === undefined
        ? 'Could not find a free short code; try again'
        : 'This code is taken',
    );
  }

  async list(
    principal: Principal,
    { scope, page, pageSize }: ShortLinkListQueryDto,
  ): Promise<Paginated<ShortLinkResponse>> {
    if (scope === 'all' && !hasPermission(principal, MANAGE))
      throw new AppError(
        'forbidden',
        403,
        `Listing every link needs ${MANAGE}`,
      );
    const { items, total } = await this.links.list(
      scope === 'all' ? {} : { createdBy: principal.userId },
      page,
      pageSize,
    );
    return new Paginated(
      items.map((link) => ShortLinkResponse.from(link)),
      {
        page,
        pageSize,
        total,
      },
    );
  }

  async remove(principal: Principal, code: string): Promise<void> {
    const removed = await this.links.remove(code.toLowerCase());
    if (!removed) throw notFound();
    this.logger.log(
      JSON.stringify({
        event: 'short-link.deleted',
        actor: principal.userId,
        code: removed.code,
        path: removed.path,
        hits: removed.hits,
      }),
    );
  }

  /** The path to redirect to. A visit with `isProbe` (a HEAD request from a link preview) redirects like any other but is not counted. The stored path is checked against the allow-list again, so a row written by older code or by hand never becomes a redirect. */
  async resolve(
    code: string,
    visit: { ip: string; now?: Date; isProbe?: boolean },
  ): Promise<string> {
    await this.rateLimit.reserve(
      [`short-link-visit:ip:${visit.ip}`],
      VISIT_LIMIT,
      VISIT_WINDOW_SECONDS,
    );
    const now = visit.now ?? new Date();
    const link = await this.links.findByCode(code.toLowerCase());
    if (!link || (link.expiresAt !== null && link.expiresAt <= now))
      throw visitNotFound();
    const path = shortTargetOf(link.path);
    if (path === null) {
      this.logger.error(
        `Short link ${link.code} holds a path outside the allow-list; not redirecting`,
      );
      throw visitNotFound();
    }
    if (visit.isProbe) return path;
    await this.links.recordHit(link._id, now).catch((error: Error) => {
      this.logger.error(
        `Hit of short link ${link.code} not counted: ${error.message}`,
      );
    });
    return path;
  }
}
