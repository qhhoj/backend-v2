import { v5 } from 'uuid';

/** Fixed namespace of the config keys' revision ids. */
const MISC_CONFIG_NAMESPACE = '0f0c7a3e-5b8a-4c1e-9d2f-6a7b8c9d0e1f';

/** Misc config rows are replaced by key (a deleted, recreated key gets a new row id), so a key's history hangs off an id derived from the key itself. */
export const configEntityId = (key: string): string =>
  v5(key, MISC_CONFIG_NAMESPACE);
