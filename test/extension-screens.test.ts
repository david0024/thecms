/**
 * Two kinds of screen and two kinds of field (ADR 0062 d7): a report drawn
 * from what an action answers, a calendar of a collection's rows, and the
 * `date` and `datetime` fields it places them by.
 */
import { describe, expect, test } from 'bun:test';
import { cleanRow, EXTENSION_FORMAT, EXTENSION_FORMAT_2, parseExtension } from '../src/core/index.ts';
import { dayOf, monthOf, nextMonth, readReport, rowWrites } from '../src/view/index.ts';

const manifest = {
  name: 'bookings',
  displayName: 'Bookings',
  version: '1.0.0',
  collections: [
    {
      name: 'visits',
      label: 'Visits',
      fields: [
        { key: 'guest', label: 'Guest', kind: 'text', required: true },
        { key: 'day', label: 'Day', kind: 'date' },
        { key: 'starts', label: 'Starts', kind: 'datetime' },
      ],
    },
  ],
  actions: [{ name: 'numbers', label: 'Numbers', reads: ['visits'] }],
  views: [
    { spec: 'uhlaka.view/1', id: 'bookings.report', title: 'Report', type: 'report', action: 'numbers', ranges: ['7', '30'] },
    { spec: 'uhlaka.view/1', id: 'bookings.calendar', title: 'Calendar', type: 'calendar', collection: 'visits', date: 'starts', name: 'guest', create: false },
  ],
};

describe('the screens of the third format', () => {
  test('a report names an action and its times; a calendar a collection, a date field and a name', () => {
    const { pkg, problems } = parseExtension({ format: EXTENSION_FORMAT, manifest, code: 'export const actions = {};' });
    expect(problems).toEqual([]);
    expect(pkg!.manifest.views.map((v) => v.type)).toEqual(['report', 'calendar']);
    expect(pkg!.manifest.collections[0]!.fields.map((f) => f.kind)).toEqual(['text', 'date', 'datetime']);
    // A calendar lets the rows be opened and changed, and here not added.
    expect(rowWrites(pkg!.manifest.views, 'visits')).toEqual({ read: true, create: false, edit: true, delete: false });
  });

  test('what does not fit is said', () => {
    const wrong = parseExtension({
      format: EXTENSION_FORMAT,
      manifest: {
        ...manifest,
        views: [
          { spec: 'uhlaka.view/1', id: 'a', title: 'A', type: 'report', action: 'missing', ranges: ['week'], url: '/x' },
          { spec: 'uhlaka.view/1', id: 'b', title: 'B', type: 'calendar', collection: 'visits', date: 'guest', name: 'nobody' },
        ],
      },
      code: 'export const actions = {};',
    });
    expect(wrong.problems).toEqual([
      'views[0]: "url" is not part of uhlaka.view/1',
      'views[0]: "missing" is not one of the extension\'s actions',
      'views[0]: "ranges" lists some of today, 7, 30, 365, each once',
      'views[1].name: "visits" has no field "nobody"',
      'views[1].date: "guest" is not a date or a date and time',
    ]);
  });

  test('the second format has neither the screens nor the fields', () => {
    const { problems } = parseExtension({ format: EXTENSION_FORMAT_2, manifest, code: 'export const actions = {};' });
    expect(problems).toContain('visits.day: a field is one of text, longtext, number, boolean, choice, secret, url');
    const screens = parseExtension({ format: EXTENSION_FORMAT_2, manifest: { ...manifest, collections: [{ ...manifest.collections[0], fields: [{ key: 'guest', label: 'Guest', kind: 'text' }] }], views: [manifest.views[0]] }, code: 'export const actions = {};' });
    expect(screens.problems).toEqual(['a screen of the kind "report" needs uhlaka.extension/3']);
  });
});

describe('a date and a date and time', () => {
  const of = parseExtension({ format: EXTENSION_FORMAT, manifest, code: 'export const actions = {};' }).pkg!.manifest.collections[0]!;
  test('are kept as the browser\'s fields give them, and nothing else', () => {
    expect(cleanRow(of, { guest: 'Ana', day: '2026-11-22', starts: '2026-11-22T14:30' })).toEqual({ row: { guest: 'Ana', day: '2026-11-22', starts: '2026-11-22T14:30' }, problems: [] });
    expect(cleanRow(of, { guest: 'Ana', day: '' })).toEqual({ row: { guest: 'Ana', day: null, starts: null }, problems: [] });
    expect(cleanRow(of, { guest: 'Ana', day: '22.11.2026', starts: '2026-13-40T99:00' }).problems).toEqual(['Day: a day is like 2026-11-22', 'Starts: a day and time is like 2026-11-22T14:30']);
  });
});

describe('what the screens draw', () => {
  test('a report\'s answer, with what does not fit left out', () => {
    expect(
      readReport({
        totals: [{ label: 'Visitors', value: 12 }, { label: 'Odd', value: 'many' }, 'nothing'],
        chart: { labels: ['Mon', 'Tue'], series: [{ label: 'Visitors', values: [3, 9, 100] }, { label: 'Pages', values: [5] }] },
        lists: [{ title: 'Pages', rows: [{ label: '/', value: 7 }] }, null],
      }),
    ).toEqual({
      totals: [
        { label: 'Visitors', value: 12 },
        { label: 'Odd', value: 0 },
      ],
      chart: {
        labels: ['Mon', 'Tue'],
        series: [
          { label: 'Visitors', values: [3, 9] },
          { label: 'Pages', values: [5, 0] },
        ],
      },
      lists: [{ title: 'Pages', rows: [{ label: '/', value: 7 }] }],
    });
    expect(readReport('nothing')).toEqual({ totals: [], chart: null, lists: [] });
    expect(readReport({ chart: { labels: [], series: [] } }).chart).toBeNull();
  });

  test('a month, Monday first, with the rows on their days in order', () => {
    const rows = [
      { id: 'b', starts: '2026-11-22T15:00', guest: 'Bo' },
      { id: 'a', starts: '2026-11-22T09:30', guest: 'Ana' },
      { id: 'c', starts: '2026-12-01T10:00', guest: 'Cy' },
      { id: 'd', starts: 'someday', guest: 'Dan' },
    ];
    const { weeks, on } = monthOf('2026-11', rows, 'starts');
    // 1 November 2026 is a Sunday: six days of the week before it are not of the month.
    expect(weeks[0]).toEqual(['', '', '', '', '', '', '2026-11-01']);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(Object.keys(on)).toEqual(['2026-11-22']);
    expect(on['2026-11-22']!.map((r) => r.guest)).toEqual(['Ana', 'Bo']);
    expect(nextMonth('2026-12', 1)).toBe('2027-01');
    expect(nextMonth('2026-01', -1)).toBe('2025-12');
    expect(dayOf('2026-11-22')).toBe('2026-11-22');
    expect(dayOf(42)).toBe('');
  });
});
