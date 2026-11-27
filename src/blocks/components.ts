/**
 * Which component draws which block type. `Record<BlockType, …>` makes a
 * missing one a type error, and `test/contract.test.ts` checks the same at run
 * time, against the core's list.
 */
import type { Component } from 'svelte';
import type { Block, BlockType } from '../core/index.ts';
import Audio from './Audio.svelte';
import Buttons from './Buttons.svelte';
import Code from './Code.svelte';
import Contact from './Contact.svelte';
import Embed from './Embed.svelte';
import Archive from './Archive.svelte';
import Entries from './Entries.svelte';
import Entry from './Entry.svelte';
import Extension from './Extension.svelte';
import Faq from './Faq.svelte';
import Files from './Files.svelte';
import Form from './Form.svelte';
import Gallery from './Gallery.svelte';
import Group from './Group.svelte';
import Hero from './Hero.svelte';
import Image from './Image.svelte';
import Pricing from './Pricing.svelte';
import Search from './Search.svelte';
import Section from './Section.svelte';
import Services from './Services.svelte';
import Table from './Table.svelte';
import Testimonials from './Testimonials.svelte';
import Text from './Text.svelte';
import Video from './Video.svelte';

export const COMPONENTS: Record<BlockType, Component<{ block: Block }>> = {
  hero: Hero,
  text: Text,
  image: Image,
  services: Services,
  contact: Contact,
  form: Form,
  extension: Extension,
  search: Search,
  buttons: Buttons,
  table: Table,
  code: Code,
  embed: Embed,
  video: Video,
  audio: Audio,
  files: Files,
  gallery: Gallery,
  faq: Faq,
  testimonials: Testimonials,
  pricing: Pricing,
  entries: Entries,
  archive: Archive,
  entry: Entry,
  section: Section,
  group: Group,
};
