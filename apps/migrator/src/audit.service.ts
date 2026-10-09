import { Injectable } from '@nestjs/common';
import { LegacySourceService } from './legacy-source.service';

const JSON_COLUMNS = [
  ['judge_contest', 'format_config'],
  ['judge_contestparticipation', 'format_data'],
];
/** [table, column, unique-in-v2]: unique duplicates are errors, others warnings. */
const CASE_INSENSITIVE_COLUMNS: [string, string, boolean][] = [
  ['auth_user', 'username', true],
  ['auth_user', 'email', false],
  ['auth_group', 'name', true],
];
const SUPPORTED_HASHES = ['pbkdf2_sha256', 'pbkdf2_sha1'];

export interface AuditReport {
  errors: string[];
  warnings: string[];
}

/** Read-only pre-import checks of the legacy MariaDB: each check appends to the report. */
@Injectable()
export class AuditService {
  constructor(private readonly source: LegacySourceService) {}

  async run(): Promise<AuditReport> {
    const report: AuditReport = { errors: [], warnings: [] };
    await this.checkZeroDates(report);
    await this.checkJson(report);
    await this.checkCaseDuplicates(report);
    await this.checkPasswordHashes(report);
    await this.checkWebauthn(report);
    return report;
  }

  private async count(sql: string): Promise<number> {
    return Number((await this.source.query<{ total: number }>(sql))[0].total);
  }

  private async checkZeroDates({ warnings }: AuditReport) {
    const dateColumns = await this.source.query<{
      tableName: string;
      columnName: string;
    }>(
      "SELECT table_name AS tableName, column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND data_type IN ('date', 'datetime', 'timestamp')",
    );
    for (const { tableName, columnName } of dateColumns) {
      const zeroDates = await this.count(
        `SELECT COUNT(*) total FROM \`${tableName}\` WHERE CAST(\`${columnName}\` AS CHAR) LIKE '0000-00-00%'`,
      );
      if (zeroDates)
        warnings.push(
          `${tableName}.${columnName}: ${zeroDates} zero date(s) → null`,
        );
    }
  }

  private async checkJson({ errors }: AuditReport) {
    for (const [tableName, columnName] of JSON_COLUMNS) {
      const invalid = await this.count(
        `SELECT COUNT(*) total FROM \`${tableName}\` WHERE \`${columnName}\` IS NOT NULL AND \`${columnName}\` <> '' AND JSON_VALID(\`${columnName}\`) = 0`,
      );
      if (invalid)
        errors.push(
          `${tableName}.${columnName}: invalid JSON in ${invalid} row(s)`,
        );
    }
  }

  private async checkCaseDuplicates({ errors, warnings }: AuditReport) {
    for (const [tableName, columnName, unique] of CASE_INSENSITIVE_COLUMNS) {
      const duplicates = await this.source.query<{ value: string }>(
        `SELECT LOWER(\`${columnName}\`) value FROM \`${tableName}\` WHERE \`${columnName}\` <> '' GROUP BY LOWER(\`${columnName}\`) HAVING COUNT(DISTINCT BINARY \`${columnName}\`) > 1`,
      );
      for (const { value } of duplicates)
        (unique ? errors : warnings).push(
          `${tableName}.${columnName}: case-only duplicate "${value}"`,
        );
    }
  }

  private async checkPasswordHashes({ warnings }: AuditReport) {
    const hashes = await this.source.query<{
      algorithm: string;
      total: number;
    }>(
      "SELECT SUBSTRING_INDEX(password, '$', 1) algorithm, COUNT(*) total FROM auth_user GROUP BY algorithm",
    );
    for (const { algorithm, total } of hashes)
      if (!SUPPORTED_HASHES.includes(algorithm) && !algorithm.startsWith('!'))
        warnings.push(
          `${total} user(s) with ${algorithm} passwords must reset`,
        );
  }

  private async checkWebauthn({ warnings }: AuditReport) {
    const credentials = await this.count(
      'SELECT COUNT(*) total FROM judge_webauthncredential',
    );
    if (credentials)
      warnings.push(
        `${credentials} legacy WebAuthn credential(s): verify publicKey format`,
      );
  }
}
