export type FontPreset =
  'transistor-lab' | 'zhongsong-study' | 'quantum-board' | 'night-oscilloscope';
export type TypeScale = 'standard' | 'comfortable' | 'large';
export type FontRole = 'zhBody' | 'zhTitle' | 'zhUi' | 'latin' | 'math' | 'code';

export interface TypographyPreferences {
  fontPreset: FontPreset;
  typeScale: TypeScale;
}

export interface TypographyPreset {
  readonly name: string;
  readonly description: string;
  readonly fonts: Readonly<Record<FontRole, string>>;
  readonly weights?: Readonly<{ zhBody: number }>;
}

export interface TypographyContract {
  readonly STORAGE_KEY: string;
  readonly presets: Readonly<Record<FontPreset, TypographyPreset>>;
  readonly typeScalePresets: Readonly<
    Record<TypeScale, Readonly<{ name: string; description: string; rootSize: string }>>
  >;
  readonly defaults: Readonly<TypographyPreferences>;
  readonly knowledgeBody: Readonly<{ family: string; weight: number }>;
  normalize(preferences: unknown): TypographyPreferences;
  read(readStoredPreferences: () => string | null): TypographyPreferences;
  cssVariables(preferences: unknown): Record<string, string>;
  mainSiteVariables(preferences: unknown): Record<string, string>;
}

declare global {
  var freeBbsTypographyPreferences: TypographyContract;
  interface Window {
    freeBbsTypographyPreferences: TypographyContract;
  }
}
