export const RESERVED_PREFIX = 'voicelink.';

export const SAVE_SITE_MAP_ACTION = `${RESERVED_PREFIX}saveSiteMap` as const;
export const START_RECORDING_ACTION = `${RESERVED_PREFIX}startRecording` as const;
export const STOP_RECORDING_ACTION = `${RESERVED_PREFIX}stopRecording` as const;
export const READ_SITEMAP_ACTION = `${RESERVED_PREFIX}readSitemap` as const;

export const RESERVED_ACTIONS = [
  SAVE_SITE_MAP_ACTION,
  START_RECORDING_ACTION,
  STOP_RECORDING_ACTION,
  READ_SITEMAP_ACTION,
] as const;
