const MARKDOWN_IMAGE =
  /(!\[[^\]\n]{0,500}\]\(\s*<?)(https?:\/\/[^\s)>]{1,1000})/g;
const HTML_IMAGE =
  /(<img\b[^>]{0,1000}?\ssrc\s*=\s*["'])(https?:\/\/[^"']{1,1000})/gi;

const HACKMD_HOST = 'hackmd.io';
const IMGUR_HOST = 'imgur.com';

/** Hosts whose images the job takes: hackmd.io and its subdomains; imgur.com only on request (hackmd's older uploads are imgur links). Also the only hosts a download may be redirected to. */
export function isRehostableHost(
  hostname: string,
  includeImgur: boolean,
): boolean {
  const host = hostname.toLowerCase();
  const isHostOrSub = (domain: string) =>
    host === domain || host.endsWith(`.${domain}`);
  return isHostOrSub(HACKMD_HOST) || (includeImgur && isHostOrSub(IMGUR_HOST));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Image URLs on a rehostable host, from Markdown `![](url)` and HTML `<img src>`; links to notes are not images and stay. */
export function imageUrlsOf(text: string, includeImgur: boolean): string[] {
  const urls = new Set<string>();
  for (const pattern of [MARKDOWN_IMAGE, HTML_IMAGE])
    for (const match of text.matchAll(pattern)) {
      const host = hostOf(match[2]);
      if (host && isRehostableHost(host, includeImgur)) urls.add(match[2]);
    }
  return [...urls];
}

/** The text with each URL in `replacements` replaced, only inside an image. */
export function replaceImageUrls(
  text: string,
  replacements: ReadonlyMap<string, string>,
): string {
  const swap = (whole: string, head: string, url: string) =>
    replacements.has(url) ? `${head}${replacements.get(url)}` : whole;
  return text.replace(MARKDOWN_IMAGE, swap).replace(HTML_IMAGE, swap);
}

/** The stored HTML with each URL in `replacements` replaced as a literal string, also in its attribute-escaped form (`&` as `&amp;`). Nothing else changes, so raw HTML stays byte for byte. */
export function replaceUrlsInHtml(
  html: string,
  replacements: ReadonlyMap<string, string>,
): string {
  let result = html;
  for (const [url, ours] of replacements) {
    const escape = (text: string) => text.replaceAll('&', '&amp;');
    result = result.replaceAll(url, ours);
    if (url.includes('&'))
      result = result.replaceAll(escape(url), escape(ours));
  }
  return result;
}

const UPLOADS_BUCKET =
  /^hackmd-prod-images\.s3[.-](?:[a-z0-9-]+\.)?amazonaws\.com$/;

/** The S3 bucket hackmd.io serves its `/_uploads/` images from (`hackmd.io/_uploads/x.png` answers 302 to it). Allowed as a redirect target from hackmd.io only, never as a start URL. */
export function isUploadsBucketHost(hostname: string): boolean {
  return UPLOADS_BUCKET.test(hostname.toLowerCase());
}
