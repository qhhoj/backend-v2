import { Global, Module } from '@nestjs/common';
import { MAILER } from '@libs/common';
import { SmtpMailer } from './smtp.mailer';

@Global()
@Module({
  providers: [{ provide: MAILER, useClass: SmtpMailer }],
  exports: [MAILER],
})
export class MailModule {}
