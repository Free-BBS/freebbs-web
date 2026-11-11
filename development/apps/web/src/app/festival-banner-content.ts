export interface FestivalBannerMessage {
  id: string;
  text: string;
  source?: string;
}

export interface FestivalBannerConfiguration {
  enabled: boolean;
  messages: readonly FestivalBannerMessage[];
}

/** Fill the approved banner wording here; an empty list is never published as a placeholder. */
export const BOYS_DAY_BANNER: FestivalBannerConfiguration = {
  enabled: true,
  messages: [],
};
