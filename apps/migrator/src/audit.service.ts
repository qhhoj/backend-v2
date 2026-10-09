import { Injectable } from '@nestjs/common';
import {
  ENUM_CHECKS,
  ENUM_ERROR_TABLES,
  KNOWN_HASH_ALGORITHMS,
  ORPHAN_CHECKS,
  RANGE_CHECKS,
} from './audit-checks';
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
  ['judge_organization', 'slug', true],
  ['judge_problemgroup', 'name', true],
  ['judge_problemtype', 'name', true],
  ['judge_taggroup', 'code', true],
  ['judge_tag', 'code', true],
  ['judge_tagproblem', 'code', true],
  ['judge_language', 'key', true],
  ['judge_license', 'key', true],
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
    await this.checkRanges(report);
    await this.checkEnums(report);
    await this.checkOrphans(report);
    await this.checkFormatKeys(report);
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
      const groups = await this.source.query<{ ids: string }>(
        `SELECT GROUP_CONCAT(id ORDER BY id SEPARATOR ' ') ids FROM \`${tableName}\` WHERE \`${columnName}\` <> '' GROUP BY LOWER(\`${columnName}\`) COLLATE utf8mb4_bin HAVING COUNT(DISTINCT BINARY \`${columnName}\`) > 1 ORDER BY MIN(id)`,
      );
      if (!groups.length) continue;
      const named = groups.map(({ ids }) =>
        ids
          .split(' ')
          .map((id) => `${tableName}:${id}`)
          .join(' '),
      );
      (unique ? errors : warnings).push(
        `${tableName}.${columnName}: ${groups.length} case-only duplicate group(s): ${named.join('; ')}`,
      );
    }
  }

  /** Prints only an algorithm name from the known list; a field without `$`, or with an unknown prefix, may be a raw hash or plaintext and is counted as "unrecognised format". */
  private async checkPasswordHashes({ warnings }: AuditReport) {
    const hashes = await this.source.query<{
      algorithm: string;
      total: number;
    }>(
      "SELECT IF(LOCATE('$', password) > 0, SUBSTRING_INDEX(password, '$', 1), '') algorithm, COUNT(*) total FROM auth_user WHERE password NOT LIKE '!%' GROUP BY algorithm",
    );
    const mustReset = new Map<string, number>();
    for (const { algorithm, total } of hashes) {
      if (SUPPORTED_HASHES.includes(algorithm)) continue;
      const label = KNOWN_HASH_ALGORITHMS.includes(algorithm)
        ? algorithm
        : 'unrecognised format';
      mustReset.set(label, (mustReset.get(label) ?? 0) + Number(total));
    }
    for (const [label, total] of mustReset)
      warnings.push(`${total} user(s) with ${label} passwords must reset`);
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

  /** A `bound` line is an error: the kept rows can never pass `verify` (Step 6 stop rule). */
  private async checkRanges({ errors, warnings }: AuditReport) {
    for (const [what, sql, bound] of RANGE_CHECKS) {
      const total = await this.count(sql);
      if (total) (bound ? errors : warnings).push(`${what}: ${total} row(s)`);
    }
  }

  /** VNOJ keeps `LSO` upper-case (Task 11 renames it); every format/key pair is listed so an unknown key is seen before L5 runs. Keys only, never values. */
  private async checkFormatKeys({ warnings }: AuditReport) {
    const pairs = await this.source.query<{
      format: string;
      keys: string | null;
    }>(
      "SELECT DISTINCT format_name AS format, JSON_KEYS(format_config) AS `keys` FROM judge_contest WHERE format_config <> '' AND JSON_VALID(format_config)",
    );
    for (const { format, keys } of pairs)
      warnings.push(
        `judge_contest.format_config keys of ${format}: ${keys ?? '[]'}`,
      );
  }

  private async checkEnums({ errors, warnings }: AuditReport) {
    for (const [table, column, accepted] of ENUM_CHECKS) {
      const values = await this.source.query<{ value: string }>(
        `SELECT DISTINCT \`${column}\` AS value FROM \`${table}\` WHERE \`${column}\` IS NOT NULL`,
      );
      for (const { value } of values)
        if (!accepted.includes(value))
          (ENUM_ERROR_TABLES.includes(table) ? errors : warnings).push(
            `${table}.${column}: value "${value}" not in the v2 enum`,
          );
    }
  }

  private async checkOrphans({ warnings }: AuditReport) {
    for (const [child, column, parent] of ORPHAN_CHECKS) {
      const total = await this.count(
        `SELECT COUNT(*) total FROM \`${child}\` c LEFT JOIN \`${parent}\` p ON p.id = c.\`${column}\` WHERE c.\`${column}\` IS NOT NULL AND p.id IS NULL`,
      );
      if (total)
        warnings.push(
          `${child}.${column} → ${parent}: ${total} dangling row(s)`,
        );
    }
  }
}
