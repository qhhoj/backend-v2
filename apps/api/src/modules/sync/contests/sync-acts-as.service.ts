import { Injectable } from '@nestjs/common';
import { hasPermission, PrincipalService, UsersRepository } from '@libs/auth';
import type { Principal, ServiceClientPrincipal } from '@libs/auth';
import { AppError } from '@libs/common';
import { ACTS_AS_PERMISSIONS } from '../acts-as-permissions';

@Injectable()
export class SyncActsAsService {
  constructor(
    private readonly users: UsersRepository,
    private readonly principals: PrincipalService,
  ) {}

  /** The client's acting user as a principal. Re-read on every request: a deactivated user, or one who lost a required permission, ends the client's writes at once. */
  async principalOf(client: ServiceClientPrincipal): Promise<Principal> {
    const user = await this.users.findById(client.actsAs);
    if (!user?.isActive)
      throw new AppError(
        'forbidden',
        403,
        'The acting user of this client is inactive',
      );
    const principal = this.principals.build(user);
    const missing = ACTS_AS_PERMISSIONS.find(
      (permission) => !hasPermission(principal, permission),
    );
    if (missing)
      throw new AppError(
        'forbidden',
        403,
        `The acting user of this client lacks ${missing}`,
      );
    return principal;
  }
}
