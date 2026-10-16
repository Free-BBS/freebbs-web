export interface ShowcaseImage {
  src: string;
  alt: string;
  caption?: string;
  fit?: 'cover' | 'contain';
  position?: string;
  aspectRatio?: number;
  mobileAspectRatio?: number;
}

export interface ShowcaseItem {
  title: string;
  description?: string;
  paragraphs?: string[];
  image?: ShowcaseImage;
  images?: ShowcaseImage[];
  href?: string;
  linkLabel?: string;
  meta?: string;
}

export interface ShowcaseSection {
  id: string;
  title: string;
  eyebrow?: string;
  introduction?: string;
  paragraphs?: string[];
  layout: 'cards' | 'editorial' | 'gallery' | 'timeline' | 'projects' | 'quotes' | 'carousel';
  items?: ShowcaseItem[];
  images?: ShowcaseImage[];
}

export interface ShowcaseContent {
  slug: string;
  departmentId: string;
  name: string;
  shortName?: string;
  englishName: string;
  tagline: string;
  summary: string;
  keywords?: string[];
  introduction: string[];
  duties: string[];
  contacts: Array<{ name: string; email: string }>;
  contactNote?: string;
  accent: string;
  darkAccent: string;
  layout: 'editorial' | 'community' | 'studio' | 'field' | 'lab';
  hero?: ShowcaseImage;
  logo?: ShowcaseImage;
  sections: ShowcaseSection[];
  faq?: Array<{ question: string; answer: string }>;
  site?: { entry: string; title: string };
  sourceNotes: string[];
}
