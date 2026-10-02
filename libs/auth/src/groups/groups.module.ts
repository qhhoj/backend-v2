import { Module } from '@nestjs/common';
import { GroupsQuerier } from './groups.querier';

@Module({ providers: [GroupsQuerier], exports: [GroupsQuerier] })
export class GroupsModule {}
