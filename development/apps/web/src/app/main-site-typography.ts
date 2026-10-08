// Import the DOM-free contract used by the main site; never duplicate font stacks.
import '../../../../../public/typography-preferences.js';

const typography = globalThis.freeBbsTypographyPreferences;

export const MAIN_SITE_TYPOGRAPHY_STORAGE_KEY = typography.STORAGE_KEY;

export function readMainSiteTypography(readStoredPreferences: () => string | null) {
  return typography.mainSiteVariables(typography.read(readStoredPreferences));
}
