/**
 * The screens of an extension (ADR 0031): `uhlaka.view/1`, checked against
 * its vocabulary and against what the extension declares, and what every
 * front end does the same way when it draws one.
 */
import { describe, expect, test } from 'bun:test';
import { buttonsFor, checkViews, findView, listRows, matches, readActionResult, resolveInput, rowWrites, shownFields, VIEW_SPEC, type ViewDocument, type ViewScope } from '../src/view/index.ts';

const scope: ViewScope = {
  collections: [
    { name: 'keys', fields: [{ key: 'name' }, { key: 'status' }, { key: 'expires' }, { key: 'uses' }] },
    { name: 'settings', fields: [{ key: 'mode' }] },
  ],
  actions: [
    { name: 'rotate', ask: [{ key: 'note' }, { key: 'days' }] },
    { name: 'report', ask: [] },
    { name: 'write', ask: [], on: 'block' },
  ],
};

const good = [
  {
    spec: VIEW_SPEC,
    id: 'keys.all',
    title: 'Keys',
    type: 'list',
    collection: 'keys',
    fields: ['name', { field: 'status', label: 'State', display: 'badge', tones: { active: 'success', revoked: 'danger' } }, 'expires'],
    filter: [{ field: 'status', op: 'neq', value: 'gone' }, { field: 'expires', op: 'not_null' }, { field: 'status', op: 'in', value: ['active', 'revoked'] }],
    sort: '-expires',
    create: false,
    rowActions: [{ label: 'Rotate', action: 'rotate', input: { id: { $record: 'id' }, on: { $today: true }, days: 30 }, prompt: ['note'], confirm: 'Sure?', tone: 'danger', when: [{ field: 'status', op: 'eq', value: 'active' }] }],
    actions: [{ label: 'Report', action: 'report' }, { label: 'Settings', navigate: 'keys.settings' }],
  },
  {
    spec: VIEW_SPEC,
    id: 'keys.more',
    title: 'More',
    type: 'tabs',
    views: [
      { type: 'form', id: 'keys.settings', title: 'Settings', collection: 'settings', singleton: true, fields: ['mode'] },
      { type: 'form', id: 'keys.ask', title: 'Rotate', action: 'rotate', submit: 'Go', fields: [{ field: 'note', label: 'Why' }] },
    ],
    actions: [{ label: 'Back', navigate: 'keys.all' }],
  },
];

describe('a screen', () => {
  test('that keeps to the vocabulary and names only what the extension declares is accepted as it is', () => {
    expect(checkViews(good, scope)).toEqual({ views: good as ViewDocument[], problems: [] });
    expect(checkViews(undefined, scope)).toEqual({ views: [], problems: [] });
  });

  test('that does not is refused, with every reason and where it is', () => {
    const top = { spec: VIEW_SPEC, id: 'x', title: 'X' };
    const problems = (views: unknown): string[] => checkViews(views, scope).problems;
    expect(problems('nope')).toEqual(['views: a list of screens']);
    expect(problems(Array.from({ length: 25 }, (_, i) => ({ ...top, id: `x${i}`, type: 'list', collection: 'keys' })))).toEqual(['views: at most 24 screens']);
    expect(problems([{ id: 'x' }, 'nonsense'])).toEqual(['views[0]: a screen starts with "spec": "uhlaka.view/1"', 'views[1]: a screen starts with "spec": "uhlaka.view/1"']);
    expect(problems([{ spec: VIEW_SPEC, type: 'list', collection: 'keys', url: '/x', class: 'big' }])).toEqual([
      'views[0]: "id" is required',
      'views[0]: "title" is a short text',
      'views[0]: "url" is not part of uhlaka.view/1',
      'views[0]: "class" is not part of uhlaka.view/1',
    ]);
    expect(problems([{ ...top, id: 'Bad Id', type: 'chart' }, { ...top, type: 'list', collection: 'users' }, { ...top, type: 'list', collection: 'keys' }])).toEqual([
      'views[0]: "id" is lower case words joined by dots: "ai.providers"',
      'views[0]: "type" is one of list, form, tabs, report, calendar',
      'views[1]: "users" is not one of the extension\'s collections',
      'views[2]: the id "x" is used twice',
    ]);
    expect(
      problems([
        {
          ...top,
          type: 'list',
          collection: 'keys',
          fields: ['name', 'colour', 7, { field: 'status', display: 'big', tones: { a: 'pink' }, label: '' }, { field: 'uses', tones: 'red' }],
          filter: [{ field: 'status', op: 'like' }, { field: 'uses', op: 'null', value: 1 }, { field: 'uses', op: 'null' }, { field: 'name', op: 'in', value: 'a' }, 'x', { field: 'name', op: 'eq', value: { $eval: '1' } }, { field: 'uses', op: 'eq', value: { $record: 'nothing' } }],
          sort: 7,
          edit: 'no',
        },
      ]),
    ).toEqual([
      'views[0].fields[1]: "keys" has no field "colour"',
      'views[0].fields[2]: a field is its key, or {field, label, display, tones}',
      'views[0].fields[3]: "label" is a short text',
      'views[0].fields[3]: "display" is text or badge',
      'views[0].fields[3]: a tone is one of neutral, success, warning, danger, muted',
      'views[0].fields[4]: "tones" names a tone for each value',
      'views[0].filter[0]: "op" is one of eq, neq, lt, lte, gt, gte, in, not_in, null, not_null',
      'views[0].filter[1]: "null" takes no value',
      'views[0].filter[2]: "uses null" is given twice',
      'views[0].filter[3]: "in" takes a list of values',
      'views[0].filter[4]: a condition is {field, op, value}',
      'views[0].filter[5]: a value is a text, a number, true, false, null, {"$record": field} or {"$today": true}',
      'views[0].filter[6]: "keys" has no field "nothing"',
      'views[0]: "sort" is a field, with - before it for the largest first',
      'views[0]: "edit" is true or false',
    ]);
    expect(problems([{ ...top, type: 'list', collection: 'keys', fields: [], filter: {}, sort: '-nothing' }])).toEqual(['views[0].fields: fields are a list of at least one', 'views[0].filter: conditions are a list', 'views[0].sort: "keys" has no field "nothing"']);
  });

  test('runs only actions a screen may run, sends only what they ask, and opens only views that are there', () => {
    const top = { spec: VIEW_SPEC, id: 'x', title: 'X', type: 'list', collection: 'keys' };
    const problems = (rowActions: unknown, actions?: unknown): string[] => checkViews([{ ...top, rowActions, ...(actions ? { actions } : {}) }], scope).problems;
    expect(problems({})).toEqual(['views[0].rowActions: buttons are a list']);
    expect(
      problems([
        'x',
        { label: 'A', action: 'gone' },
        { label: 'B', action: 'write' },
        { label: 'C', action: 'rotate', input: 'x', prompt: 'note' },
        { label: 'D', action: 'rotate', input: { note: 'given', field: { $record: 'colour' } }, prompt: ['note', 'other'] },
        { label: '', action: 'report', tone: 'loud', confirm: 7 },
        { label: 'E', navigate: 7 },
        { label: 'F', navigate: 'nowhere', href: '/x' },
        { label: 'G', action: 'report', when: [{ field: 'status', op: 'eq', value: 'active' }] },
      ]),
    ).toEqual([
      'views[0].rowActions[0]: a button is an object',
      'views[0].rowActions[1]: "gone" is not one of the extension\'s actions',
      'views[0].rowActions[2]: "write" runs in the editor, on a block; a screen does not run it',
      'views[0].rowActions[3]: "input" gives a value for each key',
      'views[0].rowActions[3]: "prompt" lists what to ask',
      'views[0].rowActions[4].input.field: "keys" has no field "colour"',
      'views[0].rowActions[4]: "note" is given in "input"; it is not asked',
      'views[0].rowActions[4]: "rotate" asks nothing called "other"',
      'views[0].rowActions[5]: "label" is a short text',
      'views[0].rowActions[5]: "confirm" is a short text',
      'views[0].rowActions[5]: "tone" is one of neutral, success, warning, danger, muted',
      'views[0].rowActions[6]: "navigate" names a view by its id',
      'views[0].rowActions[7]: "href" is not part of uhlaka.view/1',
      'views[0].rowActions[7]: no view has the id "nowhere"',
    ]);
    expect(problems([], [{ label: 'R', action: 'rotate', input: { id: { $record: 'id' } }, when: [] }])).toEqual(['views[0].actions[0].input.id: $record is only for a button on a row', 'views[0].actions[0]: "when" is only for a button on a row']);
  });

  test('a form is one row of a collection or an action\'s questions; tabs are two or more titled views', () => {
    const top = { spec: VIEW_SPEC, id: 'x', title: 'X' };
    const problems = (view: Record<string, unknown>): string[] => checkViews([{ ...top, ...view }], scope).problems;
    expect(problems({ type: 'form', collection: 'settings', singleton: 'yes', fields: ['nothing'], actions: [{ label: 'R', action: 'report' }] })).toEqual(['views[0]: a form over a collection is its one row: "singleton": true', 'views[0].fields[0]: "settings" has no field "nothing"']);
    expect(problems({ type: 'form', collection: 'settings' })).toEqual(['views[0]: "singleton" is required', 'views[0]: a form over a collection is its one row: "singleton": true']);
    expect(problems({ type: 'form', action: 'gone', fields: ['x'], submit: '' })).toEqual(['views[0]: "gone" is not one of the extension\'s actions', 'views[0]: "submit" is a short text']);
    expect(problems({ type: 'form', action: 'rotate', fields: ['days', 'colour'] })).toEqual(['views[0].fields[1]: "rotate" has no field "colour"']);
    expect(problems({ type: 'tabs', views: [{ type: 'list', collection: 'keys', title: 'A' }] })).toEqual(['views[0]: "views" are two or more']);
    expect(problems({ type: 'tabs', views: [{ type: 'list', collection: 'keys' }, 'x'], actions: [{ label: 'R', action: 'report' }] })).toEqual(['views[0].views[0]: a tab has a title', 'views[0].views[1]: a view is an object']);
  });
});

describe('drawing a screen', () => {
  const declared = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }, { key: 'e' }, { key: 'f' }, { key: 'g' }];

  test('shows the fields it names, or the collection\'s first six', () => {
    expect(shownFields(undefined, declared).map((f) => f.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(shownFields(['g', { field: 'a', label: 'First', display: 'badge', tones: { x: 'success' } }, { field: 'b' }], declared)).toEqual([
      { key: 'g', display: 'text', tones: {} },
      { key: 'a', label: 'First', display: 'badge', tones: { x: 'success' } },
      { key: 'b', display: 'text', tones: {} },
    ]);
  });

  test('keeps the rows its filter meets, in its order', () => {
    const rows = [
      { id: '1', n: 10, s: 'b', d: '2026-01-01' },
      { id: '2', n: 2, s: 'a', d: null },
      { id: '3', n: 30, s: 'c', d: '2999-01-01' },
    ];
    expect(listRows(rows, undefined, undefined).map((r) => r.id)).toEqual(['1', '2', '3']);
    expect(listRows(rows, undefined, 'n').map((r) => r.id)).toEqual(['2', '1', '3']);
    expect(listRows(rows, undefined, '-s').map((r) => r.id)).toEqual(['3', '1', '2']);
    expect(listRows(rows, [{ field: 'n', op: 'gte', value: 10 }], '-n').map((r) => r.id)).toEqual(['3', '1']);
    const ids = (conditions: Parameters<typeof matches>[1]): string[] => rows.filter((r) => matches(r, conditions)).map((r) => r.id);
    expect(ids([{ field: 'd', op: 'null' }])).toEqual(['2']);
    expect(ids([{ field: 'd', op: 'not_null' }, { field: 'd', op: 'gt', value: { $today: true } }])).toEqual(['3']);
    expect(ids([{ field: 'd', op: 'lt', value: { $today: true } }])).toEqual(['1', '2']);
    expect(ids([{ field: 's', op: 'in', value: ['a', 'c'] }])).toEqual(['2', '3']);
    expect(ids([{ field: 's', op: 'not_in', value: ['a'] }, { field: 'n', op: 'lte', value: 10 }])).toEqual(['1']);
    expect(ids([{ field: 's', op: 'eq', value: 'b' }])).toEqual(['1']);
    expect(ids([{ field: 's', op: 'neq', value: 'b' }])).toEqual(['2', '3']);
    expect(ids([{ field: 'n', op: 'eq', value: { $record: 'n' } }])).toEqual(['1', '2', '3']);
  });

  test('draws a button only on the rows it is for, and sends what it says, read from the row', () => {
    const buttons = [{ label: 'Always', action: 'a' }, { label: 'Active', action: 'b', when: [{ field: 's', op: 'eq' as const, value: 'on' }] }];
    expect(buttonsFor(buttons, { s: 'on' }).map((b) => b.label)).toEqual(['Always', 'Active']);
    expect(buttonsFor(buttons, { s: 'off' }).map((b) => b.label)).toEqual(['Always']);
    expect(buttonsFor(buttons, null).map((b) => b.label)).toEqual(['Always']);
    expect(buttonsFor(undefined, null)).toEqual([]);
    expect(resolveInput({ id: { $record: 'id' }, gone: { $record: 'nothing' }, on: { $today: true }, n: 3 }, { id: 'r1' })).toEqual({ id: 'r1', gone: null, on: new Date().toISOString().slice(0, 10), n: 3 });
    expect(resolveInput({ id: { $record: 'id' } }, null)).toEqual({ id: undefined });
    expect(resolveInput(undefined, null)).toEqual({});
  });

  test('finds a view by its id, in the screen that holds it', () => {
    const docs = good as ViewDocument[];
    expect(findView(docs, 'keys.all')?.view).toBe(docs[0]!);
    const nested = findView(docs, 'keys.ask');
    expect([nested?.doc.id, nested?.view.title]).toEqual(['keys.more', 'Rotate']);
    expect(findView(docs, 'nothing')).toBeNull();
  });

  test('lets rows be written by hand only as a screen offers', () => {
    const docs = good as ViewDocument[];
    expect(rowWrites(docs, 'keys')).toEqual({ read: true, create: false, edit: true, delete: true });
    expect(rowWrites(docs, 'settings')).toEqual({ read: true, create: true, edit: true, delete: false });
    expect(rowWrites(docs, 'other')).toEqual({ read: false, create: false, edit: false, delete: false });
  });

  test('reads what an action answers: a secret to show once, a view to open, or values', () => {
    expect(readActionResult({ reveal: 'sk-1' })).toEqual({ kind: 'reveal', text: 'sk-1' });
    expect(readActionResult({ view: 'keys.all' })).toEqual({ kind: 'navigate', view: 'keys.all' });
    expect(readActionResult({ reveal: 'sk-1', other: 1 })).toEqual({ kind: 'values', value: { reveal: 'sk-1', other: 1 } });
    expect(readActionResult([1])).toEqual({ kind: 'values', value: [1] });
    expect(readActionResult(null)).toEqual({ kind: 'values', value: null });
  });
});
