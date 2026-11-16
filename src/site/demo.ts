/** A small site to start from: what `thecms init` writes. */
import { paragraphs } from '../core/index.ts';

export const DEMO_SITE = {
  name: 'Atelier Nord',
  language: 'en',
  url: '',
  action: { label: 'Ask for a quote', href: '/contact/' },
  footer: '© Atelier Nord',
  footerLinks: [{ label: 'About', href: '/about/' }],
};

export const DEMO_PAGES = [
  {
    slug: '',
    title: 'Home',
    blocks: [
      {
        type: 'hero',
        variant: 'centered',
        content: {
          eyebrow: 'Furniture workshop',
          title: 'Solid wood furniture, made to measure',
          subtitle: 'We design and build tables, shelves and kitchens for homes that plan to keep them.',
          action: { label: 'Ask for a quote', href: '/contact/' },
          secondaryAction: { label: 'About us', href: '/about/' },
        },
      },
      {
        type: 'services',
        content: {
          title: 'What we make',
          items: [
            { title: 'Tables', text: 'Dining and work tables in oak, ash or walnut.' },
            { title: 'Shelving', text: 'Built to the wall it stands against.' },
            { title: 'Kitchens', text: 'Planned with you, fitted by us.' },
          ],
        },
      },
      {
        type: 'contact',
        content: { title: 'Visit the workshop', email: 'hello@example.com', phone: '+40 21 555 0100', address: '12 Workshop Street\nBucharest' },
        // One token-bound value and one free value, to show the difference on a theme change.
        style: { background: { token: 'surface' }, paddingBlock: { value: '6rem' } },
      },
    ],
  },
  {
    slug: 'about',
    title: 'About',
    blocks: [
      {
        type: 'text',
        content: {
          body: [
            { type: 'heading', level: 2, children: [{ text: 'Three people and a workshop' }] },
            ...paragraphs(
              'We started in 2014 with one bench. Everything we sell is still made by the people you talk to.',
              'Each piece is drawn first, agreed with you, then built.',
            ),
          ],
        },
      },
    ],
  },
  {
    slug: 'contact',
    title: 'Contact',
    blocks: [
      {
        type: 'contact',
        content: {
          title: 'Get in touch',
          text: 'Tell us what you have in mind and we will answer within two working days.',
          email: 'hello@example.com',
          phone: '+40 21 555 0100',
        },
      },
    ],
  },
];
