import { mount } from 'svelte';
import Door from './Door.svelte';
import { useLanguage } from './messages.ts';

// The server puts the words of the admin's language in the page (ADR 0021): a pack, or null for English.
useLanguage(JSON.parse(document.getElementById('cms-language')?.textContent || 'null'));
// The door opens the admin once the person may be in it (ADR 0022).
mount(Door, { target: document.getElementById('app') as HTMLElement });
// A one-time link opened over the admin changes only the address's end: open it as the link it is.
addEventListener('hashchange', () => location.hash.startsWith('#link=') && location.reload());
