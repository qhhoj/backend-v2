import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { normalizeFlatpageUrl } from '@libs/community';
import { FlatpagesRepository } from './flatpages.repository';
import type { FlatpageResponse } from './dto/flatpage.response';

@Injectable()
export class FlatpagesService {
  constructor(private readonly pages: FlatpagesRepository) {}

  /** Legacy `FlatpageFallbackMiddleware`: `registrationRequired` pages need a session (the SPA sends signed-out readers to login). */
  async page(
    principal: Principal | null,
    rawUrl: string,
  ): Promise<FlatpageResponse> {
    const url = normalizeFlatpageUrl(rawUrl);
    const page = url && (await this.pages.findByUrl(url));
    if (!page) throw new AppError('not_found', 404, 'No such page');
    if (page.registrationRequired && !principal)
      throw new AppError('unauthorized', 401, 'Sign in to read this page');
    return {
      url: page.url,
      title: page.title,
      contentHtml: page.contentHtml,
      registrationRequired: page.registrationRequired,
    };
  }
}
