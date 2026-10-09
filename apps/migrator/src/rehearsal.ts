/**
 * Rehearsal-only switch for a run without LEGACY_SECRET_KEY: users migrate with 2FA off and the key canary is skipped.
 * Refused unless MIGRATION_REHEARSAL=1; the real cutover never sets either (RUNBOOK).
 */
let skipLegacySecrets = false;

export function setSkipLegacySecrets(skip: boolean): void {
  if (skip && process.env.MIGRATION_REHEARSAL !== '1')
    throw new Error(
      '--skip-legacy-secrets is rehearsal-only and needs MIGRATION_REHEARSAL=1; never use it in the real cutover',
    );
  skipLegacySecrets = skip;
}

export const legacySecretsSkipped = (): boolean => skipLegacySecrets;
