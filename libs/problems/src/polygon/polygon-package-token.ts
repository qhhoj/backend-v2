import { ZipArchive } from '../zip-archive';
import { parsePolygonLink } from './polygon-problem-link';
import { parseXml, XML_LIMITS } from './polygon-xml';

const PROBLEM_XML = 'problem.xml';

/** The link token problem.xml records in `<problem url="…">`; null when the package has no problem.xml, no url or one that is not a problem link. */
export function linkTokenOfProblemXml(xml: string): string | null {
  const root = parseXml(xml);
  if (root.name !== 'problem') return null;
  return parsePolygonLink(root.attributes.url ?? '')?.token ?? null;
}

/** Reads only problem.xml from a downloaded package; an unreadable archive or XML throws (`ZipError`, `XmlError`). */
export async function linkTokenOfPackage(path: string): Promise<string | null> {
  const zip = await ZipArchive.open(path);
  try {
    if (!zip.has(PROBLEM_XML) || zip.sizeOf(PROBLEM_XML) > XML_LIMITS.maxBytes)
      return null;
    return linkTokenOfProblemXml((await zip.read(PROBLEM_XML)).toString());
  } finally {
    await zip.close();
  }
}
