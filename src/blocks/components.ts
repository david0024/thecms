/**
 * Which component draws which block type. `Record<BlockType, …>` makes a
 * missing one a type error, and `test/contract.test.ts` checks the same at run
 * time, against the core's list.
 */
import type { Component } from 'svelte';
import type { Block, BlockType } from '../core/index.ts';
import Contact from './Contact.svelte';
import Entries from './Entries.svelte';
import Entry from './Entry.svelte';
import Faq from './Faq.svelte';
import Gallery from './Gallery.svelte';
import Group from './Group.svelte';
import Hero from './Hero.svelte';
import Image from './Image.svelte';
import Pricing from './Pricing.svelte';
import Services from './Services.svelte';
import Testimonials from './Testimonials.svelte';
import Text from './Text.svelte';

export const COMPONENTS: Record<BlockType, Component<{ block: Block }>> = {
  hero: Hero,
  text: Text,
  image: Image,
  services: Services,
  contact: Contact,
  gallery: Gallery,
  faq: Faq,
  testimonials: Testimonials,
  pricing: Pricing,
  entries: Entries,
  entry: Entry,
  group: Group,
};
