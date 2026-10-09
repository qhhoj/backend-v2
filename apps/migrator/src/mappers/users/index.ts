import { Type } from '@nestjs/common';
import { Mapper } from '../../mapper';
import { UsersMapper } from './users.mapper';

/** This area's backfill jobs in run order. */
export const USERS_MAPPERS: Type<Mapper>[] = [UsersMapper];
