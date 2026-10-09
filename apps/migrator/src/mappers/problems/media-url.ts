import { mediaUrl } from '../../legacy-env';

/** A legacy FileField path (relative to MEDIA_ROOT) as a v2 media URL; absolute URLs and site paths stay as they are (D5: MEDIA_ROOT is copied with its paths). */
export function mediaUrlOf(path: string | null): string | null {
  if (!path) return null;
  return /^(https?:)?\/\//.test(path) || path.startsWith('/')
    ? path
    : `${mediaUrl()}/${path}`;
}
