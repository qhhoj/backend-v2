/** Shapes of the PCD VJudge API (behaviour of the legacy client), parsed defensively: every field may be missing or of the wrong type. */

export interface RemoteLanguage {
  id: string;
  name: string;
}

export interface RemoteOj {
  oj: string;
  languages: RemoteLanguage[];
}

export interface RemoteProblemSummary {
  oj: string;
  problemId: string;
  title: string;
  source: string;
}

export interface RemoteProblemPage {
  items: RemoteProblemSummary[];
  total: number;
  page: number;
}

export interface RemoteProblem {
  oj: string;
  problemId: string;
  title: string;
  languages: RemoteLanguage[];
}

/** A submit or status answer. */
export interface RemoteRun {
  remoteId: string | null;
  /** Lower case with `_` (`queued`, `done`, `submit_failed`). */
  systemStatus: string;
  /** Upper case with `_` (`AC`, `PENDING`, `SUBMIT_FAILED`). */
  statusCanonical: string;
  processing: boolean | null;
  remoteUrl: string | null;
  scoreText: string | null;
  runtimeMs: number | null;
  memoryKb: number | null;
  errorMessage: string | null;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
const optionalText = (value: unknown): string | null => text(value) || null;
const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
/** Only an http(s) link is kept: the UI renders it as a link. */
const httpUrl = (value: unknown): string | null => {
  const url = text(value);
  return /^https?:\/\//i.test(url) && URL.canParse(url) ? url : null;
};
const statusToken = (value: unknown): string =>
  text(value).replace(/[\s-]+/g, '_');

/** `{data: x}` envelopes are unwrapped. */
export const unwrapData = (body: unknown): unknown =>
  isObject(body) && 'data' in body ? body.data : body;

/** A list of `{id|value, name|text}` (or bare strings), or an `{id: name}` map whose numeric side is the id. */
export function remoteLanguagesOf(payload: unknown): RemoteLanguage[] {
  if (!isObject(payload)) return [];
  const raw = payload.languages ?? payload.languageMap ?? payload.language_map;
  if (Array.isArray(raw))
    return raw.flatMap((entry) => {
      if (isObject(entry)) {
        const id = text(entry.id ?? entry.value);
        const name = text(entry.name ?? entry.text) || id;
        return id ? [{ id, name }] : [];
      }
      const id = text(entry);
      return id ? [{ id, name: id }] : [];
    });
  if (isObject(raw))
    return Object.entries(raw).flatMap(([key, value]) => {
      const name = text(value);
      if (!key || !name) return [];
      return /^\d+$/.test(key) || !/^\d+$/.test(name)
        ? [{ id: key, name }]
        : [{ id: name, name: key }];
    });
  return [];
}

/** `{items: [...]}` or a bare list. */
export function remoteOjsOf(body: unknown): RemoteOj[] {
  const items = isObject(body) ? body.items : body;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) =>
    isObject(item) && text(item.oj)
      ? [{ oj: text(item.oj), languages: remoteLanguagesOf(item) }]
      : [],
  );
}

export function remoteProblemPageOf(
  body: unknown,
  page: number,
): RemoteProblemPage {
  const raw = isObject(body) && Array.isArray(body.items) ? body.items : [];
  const items = raw.flatMap((item) => {
    if (!isObject(item)) return [];
    const oj = text(item.oj);
    const problemId = text(item.problemId ?? item.problem_id);
    return oj && problemId
      ? [{ oj, problemId, title: text(item.title), source: text(item.source) }]
      : [];
  });
  const total = isObject(body) ? finite(body.total) : null;
  const answeredPage = isObject(body) ? finite(body.page) : null;
  return {
    items,
    total: Math.max(total ?? items.length, items.length),
    page: answeredPage && answeredPage >= 1 ? answeredPage : page,
  };
}

export function remoteProblemOf(
  body: unknown,
  oj: string,
  problemId: string,
): RemoteProblem {
  const data = isObject(body) ? body : {};
  return {
    oj: text(data.oj) || oj,
    problemId: text(data.problemId) || problemId,
    title: text(data.title ?? data.name),
    languages: remoteLanguagesOf(data),
  };
}

/** The canonical status and score may also sit in `rawVjudgeStatus`. */
export function remoteRunOf(body: unknown): RemoteRun {
  const data = isObject(body) ? body : {};
  const raw = isObject(data.rawVjudgeStatus) ? data.rawVjudgeStatus : {};
  return {
    remoteId: optionalText(data.submissionId),
    systemStatus: statusToken(data.systemStatus ?? data.status).toLowerCase(),
    statusCanonical: statusToken(
      data.statusCanonical ??
        data.vjudgeStatusCanonical ??
        raw.statusCanonical ??
        raw.vjudgeStatusCanonical,
    ).toUpperCase(),
    processing: typeof data.processing === 'boolean' ? data.processing : null,
    remoteUrl: httpUrl(data.remoteUrl),
    scoreText: optionalText(
      data.scoreText ??
        data.vjudgeScoreText ??
        raw.scoreText ??
        raw.vjudgeScoreText,
    ),
    runtimeMs: finite(data.runtimeMs),
    memoryKb: finite(data.memoryKb),
    errorMessage: optionalText(data.errorMessage),
  };
}
