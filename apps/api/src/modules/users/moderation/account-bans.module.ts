import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { FeedModule } from '../../contests/feed/feed.module';
import { AccountBans } from './account-bans.service';

/** The one definition of what banning and unbanning an account does. */
@Module({
  imports: [AuthModule, FeedModule],
  providers: [AccountBans],
  exports: [AccountBans],
})
export class AccountBansModule {}
