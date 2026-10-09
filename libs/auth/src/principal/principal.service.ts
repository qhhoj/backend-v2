import { Injectable } from '@nestjs/common';
import { uuidStr } from '@libs/database';
import { GroupsQuerier } from '../groups/groups.querier';
import { UserDocument } from '../users/users.repository';
import { Principal } from './principal';
import { buildPrincipal } from './build-principal';

@Injectable()
export class PrincipalService {
  constructor(private readonly groups: GroupsQuerier) {}

  build(user: UserDocument): Principal {
    // UUID array `.map` yields raw MongooseBuffer, so normalise through uuidStr.
    return buildPrincipal(user, this.groups.groupsOf(user.groups.map(uuidStr)));
  }
}
