import { Injectable } from '@nestjs/common';
import { uuidStr } from '@libs/database';
import { GroupsQuerier } from '../groups/groups.querier';
import { UserDocument } from '../users/users.repository';
import { Principal } from './principal';

@Injectable()
export class PrincipalService {
  constructor(private readonly groups: GroupsQuerier) {}

  build(user: UserDocument): Principal {
    // UUID array `.map` yields raw MongooseBuffer, so normalise through uuidStr.
    return {
      userId: uuidStr(user._id),
      username: user.username,
      isSuperuser: user.isSuperuser,
      isStaff: user.isStaff,
      permissions: new Set([
        ...user.permissions,
        ...this.groups.permissionsOf(user.groups.map(uuidStr)),
      ]),
      organizationIds: user.organizations.map(uuidStr),
    };
  }
}
