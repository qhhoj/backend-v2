import { Module } from '@nestjs/common';
import { PermissionRenameService } from './permission-rename.service';

@Module({ providers: [PermissionRenameService] })
export class PermissionRenameModule {}
