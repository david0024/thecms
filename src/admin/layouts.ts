/** What the admin calls a layout (ADR 0035): a ready one in the admin's language until the owner renames it. */
import { type Layout, READY_LAYOUTS } from '../core/index.ts';
import { t } from './messages.ts';

export const layoutName = (layout: Layout): string => (READY_LAYOUTS.some((r) => r.id === layout.id && r.name === layout.name) ? (t.layouts.ready[layout.id] ?? layout.name) : layout.name);
