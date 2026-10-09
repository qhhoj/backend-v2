/** The state of a user's or a contest's data export: nothing built, building, or a file ready. */
export const DATA_EXPORT_STATES = ['none', 'preparing', 'ready'] as const;
export type DataExportState = (typeof DATA_EXPORT_STATES)[number];
