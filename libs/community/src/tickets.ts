import { excerpt } from './discord';

export const TICKET_TITLE_MAX_LENGTH = 100;
/** A message body (new; legacy had no cap). */
export const TICKET_BODY_MAX_LENGTH = 8192;
export const TICKET_NOTES_MAX_LENGTH = 8192;
export const TICKET_ISSUE_URL_MAX_LENGTH = 200;
/** Embedded messages per ticket; enforced inside the `$push` filter. */
export const TICKET_MESSAGE_CAP = 500;
/** Legacy `TicketList.paginate_by`. */
export const TICKETS_PAGE_SIZE = 50;
export const TICKET_ASSIGNEES_MAX = 20;

export const ticketPath = (id: string): string => `/ticket/${id}`;
export const problemPath = (code: string): string =>
  `/problem/${encodeURIComponent(code)}`;

/** Legacy `Message: ` prefix, then the first 100 code points of the whole line. */
export const ticketMessageDescription = (body: string): string =>
  excerpt(`Message: ${body}`, 100);

/** A title must not close the link text and rewrite the target. */
const escapeLinkText = (text: string): string =>
  text.replace(/[[\]()]/g, '\\$&');

/** Legacy `on_new_ticket` description (title brackets escaped): the title line, then the cut message line. */
export const newTicketDescription = ({
  title,
  ticketUrl,
  body,
}: {
  title: string;
  ticketUrl: string;
  body: string;
}): string =>
  `Title: [${escapeLinkText(title)}](${ticketUrl})\n${ticketMessageDescription(body)}`;
