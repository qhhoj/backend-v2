import type { License } from '@libs/database';
import { LicenseResponse } from '../../core/dto/problem-meta.response';

export class LicenseAdminResponse extends LicenseResponse {
  /** License text in markdown. */
  text!: string;

  static fromRow(license: License): LicenseAdminResponse {
    return { ...LicenseResponse.from(license), text: license.text };
  }
}
