/** One path segment, with the characters `encodeURIComponent` leaves alone escaped too, so a key never ends a Markdown link. */
const segment = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*~]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** SPA pages the backend links to (mails, Discord, feeds, notifications, API `link` fields): the SPA's own plural routes. The SPA keeps redirects from the old singular paths for links already sent. */
export const sitePaths = {
  problem: (code: string) => `/problems/${segment(code)}`,
  editorial: (code: string) => `/problems/${segment(code)}?tab=editorial`,
  contest: (key: string) => `/contests/${segment(key)}`,
  contestAnnouncements: (key: string) =>
    `/contests/${segment(key)}/announcements`,
  post: (id: string) => `/blog/${segment(id)}`,
  ticket: (id: string) => `/tickets/${segment(id)}`,
  user: (username: string) => `/users/${segment(username)}`,
  organization: (slug: string) => `/organizations/${segment(slug)}`,
};
