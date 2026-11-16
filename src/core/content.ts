/** What each block type's `content` holds once cleaned: the shapes `BLOCKS` declares. */
import type { ImageValue, LinkValue } from './blocks.ts';
import type { RichText } from './richtext.ts';

export interface HeroContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  image: ImageValue | null;
  action: LinkValue | null;
  secondaryAction: LinkValue | null;
}
export interface TextContent {
  body: RichText;
}
export interface ImageContent {
  image: ImageValue | null;
  caption: string;
}
export interface ServicesContent {
  title: string;
  intro: string;
  items: { title: string; text: string }[];
}
export interface ContactContent {
  title: string;
  text: string;
  email: string;
  phone: string;
  address: string;
}
