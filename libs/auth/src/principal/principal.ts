import { Permission } from './permissions';

export interface Principal {
  userId: string;
  username: string;
  isSuperuser: boolean;
  isStaff: boolean;
  permissions: ReadonlySet<string>;
  organizationIds: string[];
}

export const hasPermission = (
  principal: Principal,
  permission: Permission,
): boolean => principal.isSuperuser || principal.permissions.has(permission);
