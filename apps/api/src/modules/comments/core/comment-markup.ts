import { renderField } from '../../problems/editing/problem-markup';

/** Legacy `comment` markdown = safe mode: raw HTML shown as text. The one renderer of posting, editing and the preview. */
export const renderCommentBody = (body: string): string =>
  renderField(body, 'user', 'body');
