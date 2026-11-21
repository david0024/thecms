/** What each block type's `content` holds once cleaned: the shapes `BLOCKS` declares. */
import type { FileValue, ImageValue, LinkValue, TableValue } from './blocks.ts';
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
/** A block that lists entries of a content type: the latest posts, a few projects. What it lists is looked up when the page is drawn. */
/** A part of the entry being shown (ADR 0015): one of `ENTRY_PARTS`, or `field:<key>`. */
export interface EntryContent {
  part: string;
}

export interface EntriesContent {
  title: string;
  /** A content type's name. One the site does not have lists nothing. */
  source: string;
  count: number;
  /** The words of the link to the whole list; empty for no link. */
  more: string;
}
export interface FormContent {
  title: string;
  intro: string;
  /** What the visitor agrees to by ticking the box. The box is required. */
  consent: string;
  button: string;
  /** Shown once the message was sent. */
  sent: string;
  failed: string;
}
export interface GalleryContent {
  title: string;
  intro: string;
  images: { image: ImageValue | null; caption: string }[];
}
export interface FaqContent {
  title: string;
  intro: string;
  items: { question: string; answer: string }[];
}
export interface TestimonialsContent {
  title: string;
  items: { quote: string; name: string; role: string; photo: ImageValue | null }[];
}
export interface PricingContent {
  title: string;
  intro: string;
  /** `features` is one feature a line. */
  plans: { name: string; price: string; period: string; text: string; features: string; action: LinkValue | null }[];
}
export interface ContactContent {
  title: string;
  text: string;
  email: string;
  phone: string;
  address: string;
}
export interface ButtonsContent {
  items: { action: LinkValue | null }[];
}
export interface TableContent {
  title: string;
  table: TableValue;
  caption: string;
}
export interface EmbedContent {
  /** The address the author pasted; `embedOf` makes the player's own. */
  url: string;
  /** What the player is, for a reader that cannot see it. */
  title: string;
  caption: string;
}
export interface VideoContent {
  video: FileValue | null;
  title: string;
  poster: ImageValue | null;
  caption: string;
}
export interface AudioContent {
  audio: FileValue | null;
  title: string;
  caption: string;
}
export interface FilesContent {
  title: string;
  intro: string;
  items: { file: FileValue | null; text: string }[];
}
