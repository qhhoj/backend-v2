import { MAIL_ADDRESS_PATTERN, MailMessage, Mailer } from './mailer';

export class InMemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    if (!MAIL_ADDRESS_PATTERN.test(message.to))
      return Promise.reject(new Error('Invalid mail recipient'));
    this.sent.push(message);
    return Promise.resolve();
  }
}
