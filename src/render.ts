import {
  COLORS,
  PRIORITIES,
  STATUSES,
  priorityName,
  type Card,
  type CommentView,
  type Label,
  type User,
  type Viewer,
} from './types.js';
import { childHeading, isLate, typeName } from './validate.js';

const ERROR_TEXT: Record<string, string> = {
  title: 'Title must be 1 to 200 characters.',
  priority: 'Priority must be from 0 to 4.',
  parent: 'That parent is not allowed.',
  children: 'Delete the children first.',
  comments: 'This person still has comments.',
  last_admin: 'The last admin cannot be removed.',
  password: 'Check the password and try again.',
  mismatch: 'Those passwords do not match.',
  email: 'Enter an email address.',
  taken: 'That email is already in use.',
  label: 'That label was not accepted.',
  csrf: 'The form expired. Try again.',
  login: 'Email or password is wrong.',
  due: 'Due date must be YYYY-MM-DD.',
  status: 'That status is not allowed.',
  move: 'A card cannot move to a different parent.',
  description: 'Description is too long.',
  comment: 'Comment must be 1 to 5,000 characters.',
  forbidden: 'You cannot do that.',
  assignee: 'That assignee is not on this board.',
  missing: 'That was not found.',
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function e(value: string): string {
  return escapeHtml(value);
}

function href(origin: string, path: string): string {
  return origin + path;
}

function errorMessage(code: string | null): string | null {
  if (!code || !Object.hasOwn(ERROR_TEXT, code)) return null;
  const message = ERROR_TEXT[code];
  return typeof message === 'string' ? message : null;
}

type RenderCtx = {
  origin: string;
  viewer: Viewer;
  labelsByCard: Map<number, Label[]>;
  usersById: Map<number, User>;
  counts: Map<number, number>;
  today: string;
  nextPath: string;
  mode: 'board' | 'all';
};

function usersById(users: User[]): Map<number, User> {
  const map = new Map<number, User>();
  for (const user of users) map.set(user.id, user);
  return map;
}

function byRank(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => a.rank - b.rank || a.id - b.id);
}

function bySwimlane(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const title = a.title.localeCompare(b.title, 'en', { sensitivity: 'accent' });
    if (title !== 0) return title;
    return a.id - b.id;
  });
}

function layout(opts: {
  origin: string;
  viewer: Viewer | null;
  title: string;
  body: string;
  board: '' | 'board' | 'all';
  error: string | null;
}): string {
  const nav = opts.viewer
    ? `<header>
        <a class="logo" href="${href(opts.origin, '/')}">GOST</a>
        <nav>
          <a href="${href(opts.origin, '/')}">Board</a>
          <a href="${href(opts.origin, '/all')}">All</a>
          <a href="${href(opts.origin, '/settings')}">Settings</a>
          <span>${e(opts.viewer.email)}</span>
          <form method="post" action="${href(opts.origin, '/logout')}">
            <input type="hidden" name="csrf" value="${e(opts.viewer.csrf)}">
            <button type="submit">Sign out</button>
          </form>
        </nav>
      </header>`
    : '';
  const message = errorMessage(opts.error);
  const banner = message ? `<p class="banner" role="alert">${e(message)}</p>` : '';
  const csrf = opts.viewer
    ? `<meta name="csrf" content="${e(opts.viewer.csrf)}">`
    : '';
  const script = opts.board ? `<script>${PAGE_SCRIPT}</script>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${csrf}
<title>${e(opts.title)}</title>
<style>${CSS}</style>
</head>
<body data-board="${opts.board}">
${nav}
<main>
${banner}
${opts.body}
</main>
${script}
</body>
</html>`;
}

function renderMiniCard(card: Card, ctx: RenderCtx): string {
  const labels = ctx.labelsByCard.get(card.id) ?? [];
  const assignee = card.assignee_id == null ? undefined : ctx.usersById.get(card.assignee_id);
  const late = isLate(card.due_on, card.status, ctx.today);
  const count = ctx.counts.get(card.id) ?? 0;
  const toggle =
    ctx.mode === 'all' && card.type !== 'subtask'
      ? `<button type="button" class="lane-toggle quiet" aria-expanded="true">Collapse</button>`
      : '';
  const statusOptions = STATUSES.map(
    (status) =>
      `<option value="${status.value}"${status.value === card.status ? ' selected' : ''}>${e(status.name)}</option>`,
  ).join('');
  const labelHtml = labels
    .map((label) => `<span class="label label-${label.color}">${e(label.name)}</span>`)
    .join('');
  const due = card.due_on
    ? `<span class="${late ? 'late' : ''}">${e(card.due_on)}${late ? ' late' : ''}</span>`
    : '';
  return `<article class="card${late ? ' is-late' : ''}" draggable="true" data-id="${card.id}" data-parent-id="${card.parent_id ?? ''}" data-type="${card.type}">
    <div class="card-line">
      <span class="grip" title="Drag">Drag</span>
      <a href="${href(ctx.origin, '/cards/' + String(card.id))}">${e(card.title)}</a>
      <span class="pri pri-${card.priority}">${e(priorityName(card.priority))}</span>
    </div>
    <div class="meta">
      <span class="count" title="Children">${count}</span>
      ${labelHtml}
      ${assignee ? `<span>${e(assignee.email)}</span>` : ''}
      ${due}
      ${toggle}
    </div>
    <form method="post" action="${href(ctx.origin, '/cards/' + String(card.id) + '/move')}">
      <input type="hidden" name="csrf" value="${e(ctx.viewer.csrf)}">
      <input type="hidden" name="next" value="${e(ctx.nextPath)}">
      ${ctx.mode === 'all' && card.type !== 'subtask' ? '<input type="hidden" name="keep_rank" value="1">' : ''}
      <select name="status" aria-label="Status" onchange="this.form.submit()">${statusOptions}</select>
    </form>
  </article>`;
}

function renderColumns(cards: Card[], parentId: number | null, ctx: RenderCtx): string {
  const columns = STATUSES.map((status) => {
    const inColumn = byRank(cards.filter((card) => card.status === status.value));
    return `<section class="column">
      <h2>${e(status.name)}</h2>
      <div class="cell" data-status="${status.value}" data-parent-id="${parentId ?? ''}">
        ${inColumn.map((card) => renderMiniCard(card, ctx)).join('')}
      </div>
      <form method="post" action="${href(ctx.origin, '/cards')}" class="add">
        <input type="hidden" name="csrf" value="${e(ctx.viewer.csrf)}">
        <input type="hidden" name="next" value="${e(ctx.nextPath)}">
        <input type="hidden" name="parent_id" value="${parentId ?? ''}">
        <input type="hidden" name="status" value="${status.value}">
        <input name="title" required maxlength="200" autocomplete="off" aria-label="Title in ${e(status.name)}" placeholder="Title">
        <button type="submit">Add</button>
      </form>
    </section>`;
  }).join('');
  return `<div class="board-wrap"><div class="board">${columns}</div></div>`;
}

function renderSwimlane(card: Card, childrenOf: Map<number, Card[]>, ctx: RenderCtx): string {
  const cells = STATUSES.map((status) => {
    const inner = card.status === status.value ? renderMiniCard(card, ctx) : '';
    return `<div class="cell" data-status="${status.value}" data-parent-id="${card.parent_id ?? ''}">${inner}</div>`;
  }).join('');
  const kids = childrenOf.get(card.id) ?? [];
  let nested = '';
  const heading = childHeading(card.type);
  if (heading === 'Sub-tasks') {
    const subs = byRank(kids);
    const subCells = STATUSES.map((status) => {
      const inner = subs
        .filter((item) => item.status === status.value)
        .map((item) => renderMiniCard(item, ctx))
        .join('');
      return `<div class="cell" data-status="${status.value}" data-parent-id="${card.id}">${inner}</div>`;
    }).join('');
    nested = `<div class="lane-children"><div class="lane-grid">${subCells}</div></div>`;
  } else if (heading) {
    nested = `<div class="lane-children">${bySwimlane(kids)
      .map((child) => renderSwimlane(child, childrenOf, ctx))
      .join('')}</div>`;
  }
  return `<section class="lane" data-lane="${card.id}"><div class="lane-grid">${cells}</div>${nested}</section>`;
}

function crumbs(origin: string, chain: Card[], current: Card): string {
  const parts = [`<a href="${href(origin, '/')}">Home</a>`];
  for (const card of chain) {
    parts.push(`<a href="${href(origin, '/cards/' + String(card.id))}">${e(card.title)}</a>`);
  }
  parts.push(`<span>${e(current.title)}</span>`);
  return `<nav class="crumbs">${parts.join(' / ')}</nav>`;
}

export type CardPageModel = {
  origin: string;
  viewer: Viewer;
  card: Card;
  chain: Card[];
  children: Card[];
  comments: CommentView[];
  labels: Label[];
  cardLabelIds: number[];
  labelsByCard: Map<number, Label[]>;
  users: User[];
  counts: Map<number, number>;
  today: string;
  error: string | null;
};

export function renderCardPage(model: CardPageModel): string {
  const nextPath = '/cards/' + String(model.card.id);
  const ctx: RenderCtx = {
    origin: model.origin,
    viewer: model.viewer,
    labelsByCard: model.labelsByCard,
    usersById: usersById(model.users),
    counts: model.counts,
    today: model.today,
    nextPath,
    mode: 'board',
  };
  const selectedLabels = new Set(model.cardLabelIds);
  const priorityOptions = PRIORITIES.map(
    (item) =>
      `<option value="${item.value}"${item.value === model.card.priority ? ' selected' : ''}>${item.value} ${e(item.name)}</option>`,
  ).join('');
  const statusOptions = STATUSES.map(
    (item) =>
      `<option value="${item.value}"${item.value === model.card.status ? ' selected' : ''}>${e(item.name)}</option>`,
  ).join('');
  const assigneeOptions = [
    `<option value="">Unassigned</option>`,
    ...model.users.map(
      (user) =>
        `<option value="${user.id}"${user.id === model.card.assignee_id ? ' selected' : ''}>${e(user.email)}</option>`,
    ),
  ].join('');
  const labelBoxes =
    model.labels.length === 0
      ? `<p class="muted">No labels yet. Add one in settings.</p>`
      : `<div class="checks">${model.labels
          .map(
            (label) =>
              `<label class="check"><input type="checkbox" name="label" value="${label.id}"${selectedLabels.has(label.id) ? ' checked' : ''}> <span class="label label-${label.color}">${e(label.name)}</span></label>`,
          )
          .join('')}</div>`;
  const comments = model.comments
    .map((comment) => {
      const canDelete = comment.user_id === model.viewer.id || model.viewer.role === 'admin';
      const remove = canDelete
        ? `<form method="post" action="${href(model.origin, '/comments/' + String(comment.id) + '/delete')}">
            <input type="hidden" name="csrf" value="${e(model.viewer.csrf)}">
            <input type="hidden" name="next" value="${e(nextPath)}">
            <button type="submit" class="quiet">Delete</button>
          </form>`
        : '';
      return `<article class="comment">
        <div class="row"><strong>${e(comment.author_email)}</strong><span class="muted">${e(formatTime(comment.created_at))}</span>${remove}</div>
        <p class="comment-body">${e(comment.body)}</p>
      </article>`;
    })
    .join('');
  const heading = childHeading(model.card.type);
  const childBoard = heading
    ? `<section><h2>${e(heading)}</h2>${renderColumns(model.children, model.card.id, ctx)}</section>`
    : '';
  const body = `${crumbs(model.origin, model.chain, model.card)}
    <p class="muted">${e(typeName(model.card.type))}</p>
    <h1>${e(model.card.title)}</h1>
    <form method="post" action="${href(model.origin, nextPath)}" class="stack">
      <input type="hidden" name="csrf" value="${e(model.viewer.csrf)}">
      <input type="hidden" name="next" value="${e(nextPath)}">
      <label class="field"><span>Title</span><input name="title" required maxlength="200" value="${e(model.card.title)}"></label>
      <label class="field"><span>Priority</span><select name="priority">${priorityOptions}</select></label>
      <label class="field"><span>Status</span><select name="status">${statusOptions}</select></label>
      <label class="field"><span>Due date</span><input name="due_on" type="date" value="${e(model.card.due_on ?? '')}"></label>
      <label class="field"><span>Assignee</span><select name="assignee_id">${assigneeOptions}</select></label>
      <label class="field"><span>Description</span><textarea name="description" maxlength="20000">${e(model.card.description)}</textarea></label>
      <fieldset><legend>Labels</legend>${labelBoxes}</fieldset>
      <button type="submit">Save</button>
    </form>
    <form method="post" action="${href(model.origin, nextPath + '/delete')}" class="delete-card">
      <input type="hidden" name="csrf" value="${e(model.viewer.csrf)}">
      <input type="hidden" name="next" value="${e(nextPath)}">
      <button type="submit" class="quiet">Delete card</button>
    </form>
    <section class="comments">
      <h2>Comments</h2>
      ${comments}
      <form method="post" action="${href(model.origin, nextPath + '/comments')}" class="stack">
        <input type="hidden" name="csrf" value="${e(model.viewer.csrf)}">
        <input type="hidden" name="next" value="${e(nextPath)}">
        <label class="field"><span>Comment</span><textarea name="body" required maxlength="5000"></textarea></label>
        <button type="submit">Add comment</button>
      </form>
    </section>
    ${childBoard}`;
  return layout({
    origin: model.origin,
    viewer: model.viewer,
    title: model.card.title + ' · GOST',
    body,
    board: 'board',
    error: model.error,
  });
}

export function renderHome(opts: {
  origin: string;
  viewer: Viewer;
  cards: Card[];
  labelsByCard: Map<number, Label[]>;
  users: User[];
  counts: Map<number, number>;
  today: string;
  error: string | null;
}): string {
  const ctx: RenderCtx = {
    origin: opts.origin,
    viewer: opts.viewer,
    labelsByCard: opts.labelsByCard,
    usersById: usersById(opts.users),
    counts: opts.counts,
    today: opts.today,
    nextPath: '/',
    mode: 'board',
  };
  const body = `<h1>Goals</h1>${renderColumns(opts.cards, null, ctx)}`;
  return layout({
    origin: opts.origin,
    viewer: opts.viewer,
    title: 'Goals · GOST',
    body,
    board: 'board',
    error: opts.error,
  });
}

export function renderAll(opts: {
  origin: string;
  viewer: Viewer;
  cards: Card[];
  labelsByCard: Map<number, Label[]>;
  users: User[];
  counts: Map<number, number>;
  today: string;
  error: string | null;
}): string {
  const ctx: RenderCtx = {
    origin: opts.origin,
    viewer: opts.viewer,
    labelsByCard: opts.labelsByCard,
    usersById: usersById(opts.users),
    counts: opts.counts,
    today: opts.today,
    nextPath: '/all',
    mode: 'all',
  };
  const childrenOf = new Map<number, Card[]>();
  const roots: Card[] = [];
  for (const card of opts.cards) {
    if (card.parent_id == null) roots.push(card);
    else {
      const list = childrenOf.get(card.parent_id) ?? [];
      list.push(card);
      childrenOf.set(card.parent_id, list);
    }
  }
  const headers = STATUSES.map((status) => `<div>${e(status.name)}</div>`).join('');
  const lanes = bySwimlane(roots)
    .map((card) => renderSwimlane(card, childrenOf, ctx))
    .join('');
  const body = `<h1>All</h1><p class="muted">Drag changes status among cards that share a parent. Edit and reorder on the card.</p>
    <div class="board-wrap"><div class="lane-grid headers">${headers}</div>${lanes}</div>`;
  return layout({
    origin: opts.origin,
    viewer: opts.viewer,
    title: 'All · GOST',
    body,
    board: 'all',
    error: opts.error,
  });
}

export function renderSettings(opts: {
  origin: string;
  viewer: Viewer;
  users: User[];
  labels: Label[];
  error: string | null;
}): string {
  const people =
    opts.viewer.role === 'admin'
      ? `<section>
          <h2>People</h2>
          <form method="post" action="${href(opts.origin, '/users')}" class="stack">
            <input type="hidden" name="csrf" value="${e(opts.viewer.csrf)}">
            <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="off"></label>
            <label class="field"><span>Password</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
            <label class="field"><span>Role</span><select name="role"><option value="member">Member</option><option value="admin">Admin</option></select></label>
            <button type="submit">Add person</button>
          </form>
          ${opts.users
            .map(
              (user) => `<div class="row"><span>${e(user.email)} <span class="muted">${e(user.role)}</span></span>
                <form method="post" action="${href(opts.origin, '/users/' + String(user.id) + '/delete')}">
                  <input type="hidden" name="csrf" value="${e(opts.viewer.csrf)}">
                  <button type="submit" class="quiet">Remove</button>
                </form>
              </div>`,
            )
            .join('')}
        </section>`
      : '';
  const labelRows = opts.labels
    .map((label) => {
      const remove =
        opts.viewer.role === 'admin'
          ? `<form method="post" action="${href(opts.origin, '/labels/' + String(label.id) + '/delete')}">
              <input type="hidden" name="csrf" value="${e(opts.viewer.csrf)}">
              <button type="submit" class="quiet">Delete</button>
            </form>`
          : '';
      return `<div class="row"><span class="label label-${label.color}">${e(label.name)}</span>${remove}</div>`;
    })
    .join('');
  const colors = COLORS.map((color) => `<option value="${color}">${color}</option>`).join('');
  const body = `<h1>Settings</h1>
    <section class="stack">
      <h2>Your password</h2>
      <form method="post" action="${href(opts.origin, '/account/password')}" class="stack">
        <input type="hidden" name="csrf" value="${e(opts.viewer.csrf)}">
        <label class="field"><span>Current password</span><input name="current" type="password" required autocomplete="current-password"></label>
        <label class="field"><span>New password</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <label class="field"><span>Confirm</span><input name="confirm" type="password" required minlength="8" autocomplete="new-password"></label>
        <button type="submit">Change password</button>
      </form>
    </section>
    ${people}
    <section>
      <h2>Labels</h2>
      <form method="post" action="${href(opts.origin, '/labels')}" class="stack">
        <input type="hidden" name="csrf" value="${e(opts.viewer.csrf)}">
        <label class="field"><span>Name</span><input name="name" required maxlength="30"></label>
        <label class="field"><span>Color</span><select name="color">${colors}</select></label>
        <button type="submit">Add label</button>
      </form>
      ${labelRows}
    </section>`;
  return layout({
    origin: opts.origin,
    viewer: opts.viewer,
    title: 'Settings · GOST',
    body,
    board: '',
    error: opts.error,
  });
}

export function renderLogin(origin: string, error: string | null): string {
  const body = `<form method="post" action="${href(origin, '/login')}" class="auth stack">
    <h1>Sign in</h1>
    <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="username"></label>
    <label class="field"><span>Password</span><input name="password" type="password" required autocomplete="current-password"></label>
    <button type="submit">Sign in</button>
  </form>`;
  return layout({ origin, viewer: null, title: 'Sign in · GOST', body, board: '', error });
}

export function renderSetup(origin: string, error: string | null): string {
  const body = `<form method="post" action="${href(origin, '/setup')}" class="auth stack">
    <h1>Create the admin</h1>
    <p class="muted">This board has no people yet. The first account is the admin.</p>
    <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="username"></label>
    <label class="field"><span>Password</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
    <label class="field"><span>Confirm</span><input name="confirm" type="password" required minlength="8" autocomplete="new-password"></label>
    <button type="submit">Create admin</button>
  </form>`;
  return layout({ origin, viewer: null, title: 'Setup · GOST', body, board: '', error });
}

export function renderStatus(title: string, message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${e(title)}</title></head><body><h1>${e(title)}</h1><p>${e(message)}</p></body></html>`;
}

function formatTime(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace(/Z$/, ' UTC');
}

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.45 "Segoe UI", Helvetica, Arial, sans-serif; color: #1c1915; background: #f3efe6; }
header { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 12px 16px; background: #1c1915; color: #f3efe6; }
header a { color: #f3efe6; }
.logo { font-weight: 700; letter-spacing: 0.04em; text-decoration: none; }
header nav, .row, .card-line, .meta, .checks { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
header form, .card form, .add { margin: 0; }
main { padding: 16px; }
a { color: #1f4d3a; }
button, input, select, textarea { font: inherit; }
input, select, textarea { padding: 6px 8px; border: 1px solid #cfc6b8; border-radius: 4px; background: #fff; }
textarea { width: 100%; min-height: 8rem; }
button { padding: 6px 10px; border: 1px solid #1c1915; background: #1c1915; color: #f3efe6; border-radius: 4px; cursor: pointer; }
.quiet { background: #fff; color: #1c1915; }
.board, .lane-grid { display: grid; grid-template-columns: repeat(5, minmax(12rem, 1fr)); gap: 8px; align-items: start; }
.board-wrap { overflow-x: auto; }
.column { background: #e7e1d6; border-radius: 8px; padding: 8px; min-height: 12rem; }
.column h2, .headers div { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; margin: 0 0 8px; }
.cell { min-height: 3rem; }
.card { background: #fff; border: 1px solid #ddd4c6; border-radius: 6px; padding: 8px; margin: 0 0 8px; }
.card.is-late { border-color: #b42318; }
.card-line a { flex: 1; font-weight: 650; }
.grip { color: #8a8175; font-size: 12px; cursor: grab; }
.meta { margin-top: 6px; font-size: 12px; color: #4a453d; }
.pri, .label { border-radius: 999px; padding: 1px 6px; }
.pri-0, .label-red { background: #f8d0d0; }
.pri-1, .label-orange { background: #fde0c4; }
.pri-2, .label-gray { background: #eceae4; }
.pri-3, .label-blue { background: #d6e8fb; }
.pri-4 { background: #eee; }
.label-yellow { background: #fbf3c5; }
.label-green { background: #d8f3e4; }
.label-purple { background: #e6dff8; }
.label-pink { background: #f8d9ea; }
.late { color: #9b1c1c; font-weight: 700; }
.lane { margin: 0 0 8px; border: 1px solid #e0d8cc; border-radius: 8px; background: #faf8f4; }
.lane-children { margin: 0 8px 8px 12px; padding-left: 10px; border-left: 2px solid #e0d8cc; }
.lane.collapsed .lane-children { display: none; }
.banner { background: #f8e4e2; border: 1px solid #e4b2ac; padding: 8px 10px; border-radius: 6px; }
.stack, .auth { display: grid; gap: 10px; }
.stack { max-width: 40rem; }
.auth { max-width: 24rem; margin: 10vh auto; background: #fff; padding: 20px; border-radius: 8px; }
.field { display: grid; gap: 4px; }
.comment { border-top: 1px solid #e0d8cc; padding: 8px 0; }
.comment-body { white-space: pre-wrap; margin: 4px 0; }
.crumbs { font-size: 13px; margin-bottom: 12px; }
.muted { color: #6b645b; }
.drop { outline: 2px dashed #1f4d3a; }
.delete-card, .comments, section { margin-top: 20px; }
.add { display: grid; gap: 6px; margin-top: 8px; }
.card select, .card button, .row button { width: auto; }
.card form { margin-top: 6px; }
`;

// Swimlane order is priority, not rank, so an All-view status drop does not reorder.
const PAGE_SCRIPT = `
(function () {
  var meta = document.querySelector('meta[name="csrf"]');
  if (!meta) return;
  var csrf = meta.getAttribute('content') || '';
  var board = document.body.getAttribute('data-board') || '';
  var dragging = null;

  function collapsedStored(id) {
    try {
      return sessionStorage.getItem('gost-lane-' + id) === '1';
    } catch {
      return false;
    }
  }

  function rememberCollapsed(id, collapsed) {
    try {
      sessionStorage.setItem('gost-lane-' + id, collapsed ? '1' : '0');
    } catch {
      // Private browsing can reject sessionStorage. Collapse still works for this page.
    }
  }

  document.querySelectorAll('.lane').forEach(function (lane) {
    var id = lane.getAttribute('data-lane');
    if (!id || !collapsedStored(id)) return;
    lane.classList.add('collapsed');
    var btn = lane.querySelector('.lane-toggle');
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = 'Expand';
    }
  });

  document.querySelectorAll('.lane-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var lane = btn.closest('.lane');
      if (!lane) return;
      var id = lane.getAttribute('data-lane');
      var collapsed = lane.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.textContent = collapsed ? 'Expand' : 'Collapse';
      if (id) rememberCollapsed(id, collapsed);
    });
  });

  function parentOf(el) {
    return el.getAttribute('data-parent-id') || '';
  }

  document.querySelectorAll('.card').forEach(function (card) {
    card.addEventListener('dragstart', function (e) {
      var target = e.target;
      if (target && target.closest && target.closest('a, button, input, select, textarea, form')) {
        e.preventDefault();
        return;
      }
      dragging = card;
      card.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', card.getAttribute('data-id') || '');
        e.dataTransfer.effectAllowed = 'move';
      }
    });
    card.addEventListener('dragend', function () {
      card.classList.remove('dragging');
      var cardEl = card;
      // drop can run after dragend. Clear on the next turn so the drop still sees the card.
      window.setTimeout(function () {
        if (dragging === cardEl) dragging = null;
        document.querySelectorAll('.cell.drop').forEach(function (cell) {
          cell.classList.remove('drop');
        });
      }, 0);
    });
  });

  function cardAfter(cell, y) {
    var cards = cell.querySelectorAll(':scope > .card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card === dragging) continue;
      var box = card.getBoundingClientRect();
      if (y < box.top + box.height / 2) return card;
    }
    return null;
  }

  document.querySelectorAll('.cell').forEach(function (cell) {
    cell.addEventListener('dragover', function (e) {
      if (!dragging) return;
      if (parentOf(dragging) !== parentOf(cell)) return;
      e.preventDefault();
      cell.classList.add('drop');
    });
    cell.addEventListener('dragleave', function () {
      cell.classList.remove('drop');
    });
    cell.addEventListener('drop', function (e) {
      if (!dragging) return;
      if (parentOf(dragging) !== parentOf(cell)) return;
      e.preventDefault();
      cell.classList.remove('drop');
      var id = dragging.getAttribute('data-id');
      var type = dragging.getAttribute('data-type');
      var status = cell.getAttribute('data-status') || '';
      var reorder = board !== 'all' || type === 'subtask';
      var from = dragging.closest('.cell');
      var fromStatus = from ? (from.getAttribute('data-status') || '') : '';
      if (!reorder && status === fromStatus) return;
      var before = reorder ? cardAfter(cell, e.clientY) : null;
      var body = new URLSearchParams();
      body.set('csrf', csrf);
      body.set('status', status);
      body.set('parent_id', parentOf(dragging));
      if (!reorder) body.set('keep_rank', '1');
      if (before) body.set('before_id', before.getAttribute('data-id') || '');
      fetch('/cards/' + id + '/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: body.toString()
      }).then(function (res) {
        if (!res.ok) {
          return res.json().then(function (data) {
            window.alert((data && data.error) || 'Move refused');
          }).catch(function () {
            window.alert('Move refused');
          });
        }
        window.location.reload();
      }).catch(function () {
        window.alert('Move refused');
      });
    });
  });
})();
`;
