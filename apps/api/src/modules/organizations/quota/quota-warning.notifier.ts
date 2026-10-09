import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { NotificationsService } from '@libs/community';
import { Organization, OrganizationUsage, uuidStr } from '@libs/database';
import type { QuotaMeterName } from '@libs/database';

interface WarningKey {
  organizationId: string;
  month: string;
}

const WHAT: Record<QuotaMeterName, string> = {
  credits: 'tín dụng tháng này',
  storage: 'dung lượng dữ liệu',
};

/** Tells an organization's admins once per month and meter that the meter passed 80%. */
@Injectable()
export class QuotaWarningNotifier {
  private readonly logger = new Logger(QuotaWarningNotifier.name);

  constructor(
    private readonly notifications: NotificationsService,
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
    @InjectModel(OrganizationUsage.name)
    private readonly usage: Model<OrganizationUsage>,
  ) {}

  /** Claim first, send second: the atomic `$addToSet` (guarded by `$ne`) makes parallel crossings send one notification, and a failed send is logged and not retried. Never throws. */
  async warnOnce(key: WarningKey, meter: QuotaMeterName): Promise<void> {
    try {
      const claim = await this.usage
        .updateOne(
          {
            organization: key.organizationId,
            month: key.month,
            warnedMeters: { $ne: meter },
          },
          { $addToSet: { warnedMeters: meter } },
        )
        .exec();
      if (claim.modifiedCount !== 1) return;
      await this.notifyAdmins(key, meter);
    } catch (error) {
      this.logger.error(
        `Quota warning for ${key.organizationId} failed: ${(error as Error).message}`,
      );
    }
  }

  private async notifyAdmins(
    key: WarningKey,
    meter: QuotaMeterName,
  ): Promise<void> {
    const organization = await this.organizations
      .findById(key.organizationId, { adminIds: 1, slug: 1, shortName: 1 })
      .lean()
      .exec();
    if (!organization?.adminIds.length) return;
    await this.notifications.notify(organization.adminIds.map(uuidStr), {
      kind: 'quota-warning',
      title: `${organization.shortName} đã dùng 80% ${WHAT[meter]}`,
      body: 'Xem trang Hạn mức của tổ chức để biết chi tiết.',
      path: `/organizations/${encodeURIComponent(organization.slug)}`,
      priority: 'normal',
      groupKey: `quota:${key.organizationId}:${meter}:${key.month}`,
    });
  }
}
