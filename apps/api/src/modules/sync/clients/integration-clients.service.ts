import { Injectable, Logger } from '@nestjs/common';
import {
  generateServiceKey,
  hasPermission,
  IntegrationClientsRepository,
  parseCidr,
  PrincipalService,
  UsersRepository,
} from '@libs/auth';
import type { Principal, UserDocument } from '@libs/auth';
import {
  AppError,
  invalidField,
  Paginated,
  RateLimitService,
  unique,
} from '@libs/common';
import { uuidStr } from '@libs/database';
import { ACTS_AS_PERMISSIONS } from '../acts-as-permissions';
import type {
  CreateIntegrationClientDto,
  IntegrationClientListQueryDto,
} from './dto/integration-client.dto';
import {
  CreatedIntegrationClientResponse,
  IntegrationClientResponse,
} from './dto/integration-client.response';

/** Clients one administrator may create per day. */
const CREATE_LIMIT = 10;
const CREATE_WINDOW_SECONDS = 24 * 60 * 60;

/** Creating, listing and revoking integration clients. The key leaves the server once, in the creation response; logs carry ids, never the key. */
@Injectable()
export class IntegrationClientsService {
  private readonly logger = new Logger(IntegrationClientsService.name);

  constructor(
    private readonly clients: IntegrationClientsRepository,
    private readonly users: UsersRepository,
    private readonly principals: PrincipalService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async create(
    actor: Principal,
    dto: CreateIntegrationClientDto,
  ): Promise<CreatedIntegrationClientResponse> {
    const actsAs = await this.actingUser(dto.actsAs);
    assertCidrs(dto.allowedCidrs);
    const expiresAt = expiryOf(dto.expiresAt, new Date());
    await this.rateLimit.reserve(
      [`integration-client:user:${actor.userId}`],
      CREATE_LIMIT,
      CREATE_WINDOW_SECONDS,
    );
    const { key, hash } = generateServiceKey();
    const client = await this.clients.create({
      name: dto.name,
      keyHash: hash,
      keyPrefix: key.slice(0, 8),
      scopes: unique(dto.scopes),
      allowedCidrs: dto.allowedCidrs,
      actsAs: uuidStr(actsAs._id),
      createdBy: actor.userId,
      expiresAt,
    });
    this.logEvent('integration-client.created', actor, {
      client: uuidStr(client._id),
      actsAs: actsAs.username,
      scopes: client.scopes,
      allowedCidrs: client.allowedCidrs,
      expiresAt,
    });
    return { ...IntegrationClientResponse.from(client, actsAs.username), key };
  }

  async list({
    page,
    pageSize,
  }: IntegrationClientListQueryDto): Promise<
    Paginated<IntegrationClientResponse>
  > {
    const { items, total } = await this.clients.list(page, pageSize);
    const actingUsers = await this.users.findByIds(
      unique(items.map((client) => uuidStr(client.actsAs))),
    );
    const names = new Map(
      actingUsers.map((user) => [uuidStr(user._id), user.username]),
    );
    return new Paginated(
      items.map((client) =>
        IntegrationClientResponse.from(
          client,
          names.get(uuidStr(client.actsAs)) ?? '',
        ),
      ),
      { page, pageSize, total },
    );
  }

  /** Idempotent: revoking a revoked client is a no-op. The key stops working on its next request. */
  async revoke(actor: Principal, id: string): Promise<void> {
    const client = await this.clients.findById(id);
    if (!client)
      throw new AppError('not_found', 404, 'No such integration client');
    if (!(await this.clients.revoke(id, new Date()))) return;
    this.logEvent('integration-client.revoked', actor, {
      client: id,
      name: client.name,
    });
  }

  /** An active, non-superuser user holding every `ACTS_AS_PERMISSIONS` codename; anything else is a 400 on the `actsAs` field. */
  private async actingUser(username: string): Promise<UserDocument> {
    const user = await this.users.findByUsername(username);
    if (!user?.isActive)
      throw invalidField('actsAs', 'Unknown or inactive user.');
    const principal = this.principals.build(user);
    // A superuser sees and edits everything, so a key acting as one would hold more than the two codenames it needs.
    if (principal.isSuperuser)
      throw invalidField('actsAs', 'A superuser cannot be an acting user.');
    const missing = ACTS_AS_PERMISSIONS.find(
      (permission) => !hasPermission(principal, permission),
    );
    if (missing) throw invalidField('actsAs', `This user needs ${missing}.`);
    return user;
  }

  /** One structured line per irreversible admin action. */
  private logEvent(
    event: string,
    actor: Principal,
    details: Record<string, unknown>,
  ): void {
    this.logger.log(JSON.stringify({ event, actor: actor.userId, ...details }));
  }
}

function assertCidrs(cidrs: readonly string[]): void {
  for (const cidr of cidrs)
    if (!parseCidr(cidr))
      throw invalidField('allowedCidrs', `Not a CIDR block: ${cidr}`);
}

/** Null when omitted; a time not after `now` is a 400 (a key born expired is a mistake). */
function expiryOf(value: string | undefined, now: Date): Date | null {
  if (value === undefined) return null;
  const expiresAt = new Date(value);
  if (expiresAt <= now)
    throw invalidField('expiresAt', 'The expiry must be in the future.');
  return expiresAt;
}
