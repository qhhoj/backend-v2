import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  IMAGE_MAX_BYTES,
  isSvgWithinLimits,
  sniffImage,
  SVG_MAX_BYTES,
} from '@libs/problems';
import { sanitizeSvg } from '@libs/render';
import { isRehostableHost } from './hackmd-urls';

export const FETCH = Symbol('FETCH');
export type Fetch = typeof fetch;

const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

export interface DownloadedImage {
  /** `images/hackmd-<sha256>.<kind>`: the same bytes always get the same path, so a re-run and a repeated image store once. */
  path: string;
  content: Buffer;
}

/** Fetches one image the way a visitor's browser would get it: https only, rehostable hosts only (also after a redirect: a statement author must not aim this at an internal address), size capped, type from the bytes, SVG sanitized. */
@Injectable()
export class ImageDownloader {
  constructor(@Inject(FETCH) private readonly doFetch: Fetch) {}

  /** Null (with the reason) for anything that is not a supported image within the limits. */
  async download(
    url: string,
    includeImgur: boolean,
  ): Promise<DownloadedImage | { failure: string }> {
    try {
      const bytes = await this.fetchBytes(url, includeImgur);
      return prepareImage(bytes);
    } catch (error) {
      return { failure: (error as Error).message };
    }
  }

  private async fetchBytes(
    start: string,
    includeImgur: boolean,
  ): Promise<Buffer> {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const target = new URL(url);
      if (
        target.protocol !== 'https:' ||
        !isRehostableHost(target.hostname, includeImgur)
      )
        throw new Error('host not allowed');
      const response = await this.doFetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        url = new URL(location, url).href;
        continue;
      }
      if (!response.ok) throw new Error(`http ${response.status}`);
      return readCapped(response);
    }
    throw new Error('too many redirects');
  }
}

async function readCapped(response: Response): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > IMAGE_MAX_BYTES) throw new Error('image too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function prepareImage(bytes: Buffer): DownloadedImage | { failure: string } {
  const kind = sniffImage(bytes);
  if (!kind) return { failure: 'not a supported image' };
  let content = bytes;
  if (kind === 'svg') {
    const svg = bytes.toString('utf8');
    if (bytes.length > SVG_MAX_BYTES || !isSvgWithinLimits(svg))
      return { failure: 'svg too large or complex' };
    content = Buffer.from(sanitizeSvg(svg), 'utf8');
  }
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 32);
  return { path: `images/hackmd-${hash}.${kind}`, content };
}
