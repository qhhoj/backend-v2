import { AuditService } from '../src/audit.service';
import { setupMigratorTest } from './setup';

describe('audit', () => {
  let harness: Awaited<ReturnType<typeof setupMigratorTest>>;
  let report: { errors: string[]; warnings: string[] };

  beforeAll(async () => {
    harness = await setupMigratorTest();
    report = await harness.testingModule.get(AuditService).run();
  });
  afterAll(() => harness.teardown());

  it('errors on invalid JSON', () =>
    expect(report.errors).toContainEqual(
      expect.stringMatching(
        /judge_contest\.format_config: invalid JSON in 1 row/,
      ),
    ));
  it('warns on zero dates', () =>
    expect(report.warnings).toContainEqual(
      expect.stringMatching(/judge_profile\.data_last_downloaded: 1 zero date/),
    ));
  it('warns on case-only email duplicates', () =>
    expect(report.warnings).toContainEqual(
      expect.stringMatching(
        /auth_user\.email: case-only duplicate "bob@example\.com"/,
      ),
    ));
  it('warns on unsupported password hashes', () =>
    expect(report.warnings).toContainEqual(
      expect.stringMatching(/1 user\(s\) with md5 passwords/),
    ));
  it('reports webauthn credentials', () =>
    expect(report.warnings).toContainEqual(
      expect.stringMatching(/1 legacy WebAuthn credential/),
    ));
});
