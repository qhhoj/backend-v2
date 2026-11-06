import { assertMailMessage, MailMessage, Mailer } from './mailer';

export class InMemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    try {
      assertMailMessage(message);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}
