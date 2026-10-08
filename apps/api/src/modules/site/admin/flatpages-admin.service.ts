import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import {
  AppError,
  invalidField,
  isDuplicateKey,
  Paginated,
} from '@libs/common';
import { FLATPAGE_URL_MAX_LENGTH, normalizeFlatpageUrl } from '@libs/community';
import type { Flatpage } from '@libs/database';
import { fieldDiff } from '@libs/problems';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { renderField } from '../../problems/editing/problem-markup';
import { FlatpagesRepository } from '../public/flatpages.repository';
import type { FlatpageFields } from '../public/flatpages.repository';
import type {
  CreateFlatpageDto,
  UpdateFlatpageDto,
} from './dto/flatpage-admin.dto';
import {
  FlatpageAdminListItemResponse,
  FlatpageAdminResponse,
} from './dto/flatpage-admin.response';

const PAGE_SIZE = 50;
/** Staff write the page, but it is public: the `solution` style (sanitised, no raw HTML), same as editorials. */
const PAGE_STYLE = 'solution';
const notFound = () => new AppError('not_found', 404, 'No such page');
const REVISION_FIELDS = [
  'url',
  'title',
  'content',
  'registrationRequired',
] as const;
const revisionView = (page: Partial<Flatpage>) =>
  Object.fromEntries(
    REVISION_FIELDS.filter((field) => page[field] !== undefined).map(
      (field) => [field, page[field]],
    ),
  );
const REVISION_COMMENT = {
  create: 'Created',
  edit: 'Edited',
  delete: 'Deleted',
} as const;

/** Staff CRUD for flatpages (legacy `flatpages` admin plus `VersionAdmin` history). Last write wins: no optimistic concurrency. */
@Injectable()
export class FlatpagesAdminService {
  constructor(
    private readonly pages: FlatpagesRepository,
    private readonly revisions: RevisionsRepository,
  ) {}

  async list(page: number): Promise<Paginated<FlatpageAdminListItemResponse>> {
    const { items, total } = await this.pages.list(page, PAGE_SIZE);
    return new Paginated(
      items.map((row) => FlatpageAdminListItemResponse.from(row)),
      { page, pageSize: PAGE_SIZE, total },
    );
  }

  async one(id: string): Promise<FlatpageAdminResponse> {
    const page = await this.pages.findById(id);
    if (!page) throw notFound();
    return FlatpageAdminResponse.from(page);
  }

  async create(
    principal: Principal,
    dto: CreateFlatpageDto,
  ): Promise<FlatpageAdminResponse> {
    const page = await this.write(() =>
      this.pages.create({
        url: this.canonicalUrl(dto.url),
        title: dto.title,
        content: dto.content,
        contentHtml: renderField(dto.content, PAGE_STYLE, 'content'),
        registrationRequired: dto.registrationRequired ?? false,
      }),
    );
    await this.record(principal, page, 'create', {}, page);
    return FlatpageAdminResponse.from(page);
  }

  async update(
    principal: Principal,
    id: string,
    dto: UpdateFlatpageDto,
  ): Promise<FlatpageAdminResponse> {
    const before = await this.pages.findById(id);
    if (!before) throw notFound();
    const changes: Partial<FlatpageFields> = { ...dto };
    if (dto.url !== undefined) changes.url = this.canonicalUrl(dto.url);
    if (dto.content !== undefined)
      changes.contentHtml = renderField(dto.content, PAGE_STYLE, 'content');
    const after = await this.write(() => this.pages.update(id, changes));
    if (!after) throw notFound();
    await this.record(principal, after, 'edit', before, after);
    return FlatpageAdminResponse.from(after);
  }

  async delete(principal: Principal, id: string): Promise<void> {
    const page = await this.pages.delete(id);
    if (!page) throw notFound();
    await this.record(principal, page, 'delete', page, {});
  }

  /** The stored form of `raw`, or a 400 on `url`. */
  private canonicalUrl(raw: string): string {
    const url = normalizeFlatpageUrl(raw);
    if (!url || url.length > FLATPAGE_URL_MAX_LENGTH)
      throw invalidField('url', 'Not a valid page url.', 'invalid_url');
    return url;
  }

  private async write<Result>(action: () => Promise<Result>): Promise<Result> {
    try {
      return await action();
    } catch (error) {
      if (isDuplicateKey(error, 'url'))
        throw new AppError('conflict', 409, 'A page with this url exists', {
          url: ['This url is taken.'],
        });
      throw error;
    }
  }

  private async record(
    principal: Principal,
    page: Flatpage,
    action: 'create' | 'edit' | 'delete',
    before: Partial<Flatpage>,
    after: Partial<Flatpage>,
  ): Promise<void> {
    const changes = fieldDiff(revisionView(before), revisionView(after));
    if (action === 'edit' && !Object.keys(changes).length) return;
    await this.revisions.append({
      entity: 'flatpage',
      entityId: page._id,
      action,
      userId: principal.userId,
      changes,
      comment: `${REVISION_COMMENT[action]} from site`,
    });
  }
}
