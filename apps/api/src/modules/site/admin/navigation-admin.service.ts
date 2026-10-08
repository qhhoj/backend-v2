import { Injectable } from '@nestjs/common';
import { AppError, invalidField, isDuplicateKey } from '@libs/common';
import {
  createsCycle,
  isSafeNavigationPath,
  isValidNavigationRegex,
} from '@libs/community';
import { isUuid } from '@libs/database';
import { NavigationQuerier } from '../public/navigation.querier';
import { NavigationItemResponse } from '../public/dto/site.response';
import type {
  CreateNavigationItemDto,
  UpdateNavigationItemDto,
} from './dto/navigation-admin.dto';
import { NavigationRepository } from './navigation.repository';

const notFound = () => new AppError('not_found', 404, 'No such entry');

/** Staff CRUD for the navigation bar. Every write resyncs this process's querier at once; other processes follow the change stream. */
@Injectable()
export class NavigationAdminService {
  constructor(
    private readonly items: NavigationRepository,
    private readonly querier: NavigationQuerier,
  ) {}

  async create(dto: CreateNavigationItemDto): Promise<NavigationItemResponse> {
    this.assertContent(dto);
    const parentId = dto.parentId ?? null;
    if (parentId !== null) await this.assertParentExists(parentId);
    const item = await this.write(() =>
      this.items.create({
        key: dto.key,
        label: dto.label,
        path: dto.path,
        regex: dto.regex ?? '',
        hidden: dto.hidden ?? false,
        order: dto.order,
        parentId,
      }),
    );
    await this.querier.resync();
    return NavigationItemResponse.from(item);
  }

  async update(
    id: string,
    dto: UpdateNavigationItemDto,
  ): Promise<NavigationItemResponse> {
    if (!(await this.items.findById(id))) throw notFound();
    this.assertContent(dto);
    if (dto.parentId != null) await this.assertParentFits(id, dto.parentId);
    const item = await this.write(() => this.items.update(id, dto));
    if (!item) throw notFound();
    await this.querier.resync();
    return NavigationItemResponse.from(item);
  }

  /** Refused while the entry has children (legacy cascaded): delete the leaves first. */
  async delete(id: string): Promise<void> {
    if (!(await this.items.findById(id))) throw notFound();
    if (await this.items.hasChildren(id))
      throw new AppError('conflict', 409, 'The entry still has children');
    if (!(await this.items.delete(id))) throw notFound();
    await this.querier.resync();
  }

  /** `path` and `regex` end up in the SPA shell: refuse unsafe paths and regexes that do not compile. */
  private assertContent({
    path,
    regex,
  }: Partial<CreateNavigationItemDto>): void {
    if (path !== undefined && !isSafeNavigationPath(path))
      throw invalidField(
        'path',
        'Use a site path or an http(s) URL.',
        'invalid_path',
      );
    if (regex !== undefined && !isValidNavigationRegex(regex))
      throw invalidField(
        'regex',
        'Not a valid regular expression.',
        'invalid_regex',
      );
  }

  private async assertParentExists(parentId: string): Promise<void> {
    if (!isUuid(parentId) || !(await this.items.findById(parentId)))
      throw invalidField('parentId', 'No such entry.', 'parent_unknown');
  }

  private async assertParentFits(id: string, parentId: string): Promise<void> {
    await this.assertParentExists(parentId);
    if (createsCycle(await this.items.parentMap(), id, parentId))
      throw invalidField(
        'parentId',
        'An entry cannot sit under itself or its descendants.',
        'parent_cycle',
      );
  }

  private async write<Result>(action: () => Promise<Result>): Promise<Result> {
    try {
      return await action();
    } catch (error) {
      if (isDuplicateKey(error, 'key'))
        throw new AppError('conflict', 409, 'An entry with this key exists', {
          key: ['This key is taken.'],
        });
      throw error;
    }
  }
}
