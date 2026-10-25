import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitService } from '@libs/common';
import { GroupsModule } from './groups/groups.module';
import { AuthGuard } from './guards/auth.guard';
import { IntegrationClientsRepository } from './integration/integration-clients.repository';
import { PwnedPasswordService } from './password/pwned-password.service';
import { PrincipalService } from './principal/principal.service';
import { SessionKeyMigrationService } from './session/session-key-migration.service';
import { SessionService } from './session/session.service';
import { PasswordVerificationBackfillService } from './users/password-verification-backfill.service';
import { UsersRepository } from './users/users.repository';

const services = [
  SessionService,
  UsersRepository,
  PrincipalService,
  PwnedPasswordService,
  IntegrationClientsRepository,
];

@Module({
  imports: [GroupsModule],
  providers: [
    ...services,
    RateLimitService,
    SessionKeyMigrationService,
    PasswordVerificationBackfillService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [...services, GroupsModule],
})
export class AuthModule {}
