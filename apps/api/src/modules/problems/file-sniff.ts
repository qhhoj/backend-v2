import { isMarkupWithinLimits } from '@libs/render';

type ImageKind = 'jpg' | 'png' | 'gif' | 'svg';

const SIGNATURES: ReadonlyArray<[ImageKind, number[]]> = [
  ['jpg', [0xff, 0xd8, 0xff]],
  ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['gif', [0x47, 0x49, 0x46, 0x38]],
];
const SVG_PREAMBLE =
  /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--(?:[^-]|-(?!->))*-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i;

/** Image type from the bytes, never from the file name. */
export function sniffImage(content: Buffer): ImageKind | null {
  const match = SIGNATURES.find(([, bytes]) =>
    bytes.every((byte, index) => content[index] === byte),
  );
  if (match) return match[0];
  const head = content
    .subarray(0, 2048)
    .toString('utf8')
    .replace(/^\ufeff/, '');
  return SVG_PREAMBLE.test(head) ? 'svg' : null;
}

export const isPdf = (content: Buffer): boolean =>
  content.subarray(0, 5).toString('latin1') === '%PDF-';

export const SVG_MAX_BYTES = 512 * 1024;
const SVG_MAX_TAGS = 20000;
const SVG_MAX_DEPTH = 1000;

export const isSvgWithinLimits = (svg: string): boolean =>
  isMarkupWithinLimits(svg, { maxTags: SVG_MAX_TAGS, maxDepth: SVG_MAX_DEPTH });
