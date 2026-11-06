import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Problem } from '@libs/database';
import type { PackageCacheService, PdfCacheService } from '@libs/problems';
import type { BrowserService } from './browser.service';
import type { PdfRenderRepository } from './pdf-render.repository';
import { PdfRenderService } from './pdf-render.service';

const problem = {
  code: 'aplusb',
  timeLimit: 1,
  memoryLimit: 256,
  languageLimits: [],
  materialUrl: null,
  name: 'A + B',
  description: '',
  descriptionHtml: '<p>x</p>',
  translations: [],
} as unknown as Problem;

describe('PdfRenderService packages', () => {
  const build = (changedMidRender: boolean) => {
    const deleteAll = jest.fn().mockResolvedValue(undefined);
    let reads = 0;
    const repository = {
      findByCode: jest.fn(() =>
        Promise.resolve({
          ...problem,
          timeLimit: changedMidRender && reads++ > 0 ? 2 : 1,
        }),
      ),
      languageNames: jest.fn(() => Promise.resolve(new Map())),
    } as unknown as PdfRenderRepository;
    const pdfCache = {
      scratchPath: (name: string) => Promise.resolve(join(tmpdir(), name)),
      write: (_c: string, _l: string, produce: (p: string) => unknown) =>
        Promise.resolve(produce('/dev/null')),
    } as unknown as PdfCacheService;
    const browser = { renderPdf: jest.fn() } as unknown as BrowserService;
    const service = new PdfRenderService(
      repository,
      browser,
      pdfCache,
      { deleteAll } as unknown as PackageCacheService,
      { siteUrl: '', mediaUrl: '', mediaRoot: '' } as never,
    );
    return { service, deleteAll };
  };

  it('drops the problem cached packages once a PDF is cached', async () => {
    const { service, deleteAll } = build(false);
    expect(await service.render({ code: 'aplusb', lang: 'en' })).toBe(
      'rendered',
    );
    expect(deleteAll).toHaveBeenCalledWith('aplusb');
  });

  it('keeps them when the render is discarded as stale', async () => {
    const { service, deleteAll } = build(true);
    expect(await service.render({ code: 'aplusb', lang: 'en' })).toBe('stale');
    expect(deleteAll).not.toHaveBeenCalled();
  });
});
