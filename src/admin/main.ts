import { mount } from 'svelte';
import App from './App.svelte';
import { useLanguage } from './messages.ts';

// The server puts the words of the admin's language in the page (ADR 0021): a pack, or null for English.
useLanguage(JSON.parse(document.getElementById('cms-language')?.textContent || 'null'));
mount(App, { target: document.getElementById('app') as HTMLElement });
