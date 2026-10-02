import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GroupsModule } from './groups/groups.module';
import { AuthGuard } from './guards/auth.guard';
import { PwnedPasswordService } from './password/pwned-password.service';
import { PrincipalService } from './principal/principal.service';
import { SessionService } from './session/session.service';
import { UsersRepository } from './users/users.repository';

const services = [
  SessionService,
  UsersRepository,
  PrincipalService,
  PwnedPasswordService,
];

@Module({
  imports: [GroupsModule],
  providers: [...services, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [...services, GroupsModule],
})
export class AuthModule {}
