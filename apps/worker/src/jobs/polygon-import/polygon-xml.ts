import { SaxesParser } from 'saxes';
import type { SaxesTagPlain } from 'saxes';

export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}
export const XML_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  maxElements: 500_000,
  maxDepth: 32,
} as const;
const CHUNK_SIZE = 64 * 1024;

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlError';
  }
}

/** Streaming SAX parse into a plain tree: no DTD (so no entity expansion or XXE), hard caps on size, element count and depth, fed in chunks so the first failure stops the work. */
export function parseXml(xml: string): XmlElement {
  if (Buffer.byteLength(xml) > XML_LIMITS.maxBytes)
    throw new XmlError(
      `problem.xml is larger than ${XML_LIMITS.maxBytes} bytes`,
    );
  const parser = new SaxesParser({ position: false });
  const stack: XmlElement[] = [];
  let root = null as XmlElement | null;
  let elements = 0;
  let failure = null as XmlError | null;
  const fail = (message: string) => {
    failure ??= new XmlError(message);
  };
  parser.on('error', (error) =>
    fail(`problem.xml is not well-formed: ${error.message}`),
  );
  parser.on('doctype', () => fail('problem.xml must not declare a DOCTYPE'));
  parser.on('opentag', (tag: SaxesTagPlain) => {
    if (++elements > XML_LIMITS.maxElements)
      return fail('problem.xml has too many elements');
    if (stack.length >= XML_LIMITS.maxDepth)
      return fail('problem.xml is nested too deep');
    const element: XmlElement = {
      name: tag.name,
      attributes: { ...tag.attributes },
      children: [],
      text: '',
    };
    const parent = stack.at(-1);
    if (parent) parent.children.push(element);
    else root ??= element;
    stack.push(element);
  });
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.on('text', (text) => {
    const current = stack.at(-1);
    if (current) current.text += text;
  });
  for (let offset = 0; offset < xml.length && !failure; offset += CHUNK_SIZE)
    parser.write(xml.slice(offset, offset + CHUNK_SIZE));
  if (!failure) parser.close();
  if (failure) throw failure;
  if (!root) throw new XmlError('problem.xml is empty');
  return root;
}

export const childrenOf = (element: XmlElement, name: string): XmlElement[] =>
  element.children.filter((child) => child.name === name);
export const childOf = (element: XmlElement, name: string): XmlElement | null =>
  childrenOf(element, name)[0] ?? null;
export const childText = (element: XmlElement, name: string): string | null =>
  childOf(element, name)?.text.trim() ?? null;

/** Breadth-first with an explicit queue: untrusted depth never recurses. */
export function descendants(
  element: XmlElement,
  name: string,
  matches: (candidate: XmlElement) => boolean = () => true,
): XmlElement[] {
  const found: XmlElement[] = [];
  const queue = [element];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (current.name === name && matches(current)) found.push(current);
    queue.push(...current.children);
  }
  return found;
}
export const descendant = (
  element: XmlElement,
  name: string,
  matches?: (candidate: XmlElement) => boolean,
): XmlElement | null => descendants(element, name, matches)[0] ?? null;
