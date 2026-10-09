import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { IntegrationClient, isUuid } from '@libs/database';
import type { HydratedDocument, Model } from 'mongoose';

export type IntegrationClientDocument = HydratedDocument<IntegrationClient>;

const TOUCH_INTERVAL_MS = 60_000;

/** A key works until it is revoked or its expiry passes; both end it on the very next request. */
export const isUsableClient = (
  client: Pick<IntegrationClient, 'revokedAt' | 'expiresAt'>,
  now: Date,
): boolean =>
  client.revokedAt === null &&
  (client.expiresAt === null || client.expiresAt > now);

@Injectable()
export class IntegrationClientsRepository {
  constructor(
    @InjectModel(IntegrationClient.name)
    private readonly clients: Model<IntegrationClient>,
  ) {}

  findByKeyHash(keyHash: string): Promise<IntegrationClientDocument | null> {
    return this.clients.findOne({ keyHash }).exec();
  }

  async findById(id: string): Promise<IntegrationClientDocument | null> {
    return isUuid(id) ? this.clients.findById(id).exec() : null;
  }

  async list(
    page: number,
    pageSize: number,
  ): Promise<{ items: IntegrationClientDocument[]; total: number }> {
    const [items, total] = await Promise.all([
      this.clients
        .find({})
        .sort({ _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.clients.countDocuments({}).exec(),
    ]);
    return { items, total };
  }

  create(
    fields: Partial<IntegrationClient>,
  ): Promise<IntegrationClientDocument> {
    return this.clients.create(fields);
  }

  /** True when this call revoked it; false when it was already revoked. */
  async revoke(id: string, at: Date): Promise<boolean> {
    const { modifiedCount } = await this.clients
      .updateOne({ _id: id, revokedAt: null }, { $set: { revokedAt: at } })
      .exec();
    return modifiedCount === 1;
  }

  /** Clients whose key still works: not revoked and not expired. */
  countActive(now = new Date()): Promise<number> {
    return this.clients
      .countDocuments({
        revokedAt: null,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      })
      .exec();
  }

  /** Stamps the last use at most once a minute, so a busy client does not write on every request. */
  async touch(id: string, now: Date): Promise<void> {
    await this.clients
      .updateOne(
        {
          _id: id,
          $or: [
            { lastUsedAt: null },
            {
              lastUsedAt: { $lt: new Date(now.getTime() - TOUCH_INTERVAL_MS) },
            },
          ],
        },
        { $set: { lastUsedAt: now } },
      )
      .exec();
  }
}
