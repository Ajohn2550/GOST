import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type DatabaseSync } from 'node:sqlite';
import { type Config, loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  renderAll,
  renderCardPage,
  renderHome,
  renderLogin,
  renderSettings,
  renderSetup,
  renderStatus,
} from './render.js';
import {
  clearSessionCookie,
  COOKIE_NAME,
  readCookie,
  sessionCookie,
  tokensEqual,
} from './session.js';
import {
  addComment,
  addLabel,
  ancestors,
  childCounts,
  createCard,
  createFirstAdmin,
  createSession,
  createUser,
  deleteCard,
  deleteComment,
  deleteLabel,
  deleteSession,
  deleteSessionsForUser,
  deleteUser,
  findUserByEmail,
  getUserWithHash,
  labelsByCard,
  listAllCards,
  listChildren,
  listComments,
  listLabels,
  listUsers,
  moveCard,
  mustGetCard,
  readSession,
  setPassword,
  updateCard,
  userCount,
  type SessionRecord,
} from './store.js';
import { type Viewer } from './types.js';
import { parseEmail, parseId, parseRole, Refusal, safeNext, todayUtc } from './validate.js';

const MAX_BODY = 1_000_000;

let dummyHash: string | null = null;

function dummyPasswordHash(): string {
  // A missing account still pays for one scrypt, so login timing stays closer.
  if (!dummyHash) dummyHash = hashPassword('not-a-real-password');
  return dummyHash;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk: any) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > MAX_BODY) {
        if (!settled) {
          settled = true;
          reject(new Refusal('description', 'The form is too large'));
        }
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolveBody(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(await readBody(req));
}

function wantsJson(req: IncomingMessage): boolean {
  return (req.headers.accept ?? '').includes('application/json');
}

function httpStatus(err: Refusal): number {
  if (err.code === 'missing') return 404;
  if (err.code === 'forbidden' || err.code === 'csrf') return 403;
  return 400;
}

function redirect(res: ServerResponse, config: Config, path: string, cookie?: string): void {
  const headers: Record<string, string> = { Location: config.origin + path };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(303, headers);
  res.end();
}

function html(res: ServerResponse, status: number, body: string, cookie?: string): void {
  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self'",
  };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(status, headers);
  res.end(body);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function withError(path: string, code: string): string {
  const joiner = path.includes('?') ? '&' : '?';
  return path + joiner + 'error=' + encodeURIComponent(code);
}

function runPost(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  next: string,
  fn: () => void,
): void {
  try {
    fn();
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    if (res.headersSent) return;
    if (wantsJson(req)) {
      json(res, httpStatus(err), { error: err.message });
      return;
    }
    redirect(res, config, withError(next, err.code));
  }
}

function viewerOf(session: SessionRecord): Viewer {
  return {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
    csrf: session.csrf,
  };
}

function requireAdmin(session: SessionRecord): void {
  if (session.user.role !== 'admin') {
    throw new Refusal('forbidden', 'An admin has to do that');
  }
}

function idFrom(match: string | undefined): number {
  const id = match ? parseId(match) : null;
  if (id == null) throw new Refusal('missing', 'That was not found');
  return id;
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  db: DatabaseSync,
  config: Config,
): Promise<void> {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'POST') {
    res.writeHead(405, { Allow: 'GET, POST', 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;

  if (userCount(db) === 0) {
    if (path === '/setup' && method === 'GET') {
      html(res, 200, renderSetup(config.origin, url.searchParams.get('error')));
      return;
    }
    if (path === '/setup' && method === 'POST') {
      postSetup(req, res, db, config, await readForm(req));
      return;
    }
    redirect(res, config, '/setup');
    return;
  }

  if (path === '/setup') {
    html(res, 404, renderStatus('Not found', 'Setup is already done.'));
    return;
  }

  const token = readCookie(req.headers.cookie, COOKIE_NAME);
  const session = token ? readSession(db, token, config.sessionSecret) : null;
  // Cookie Max-Age is set at login. Refresh it on use so the browser expiry slides too.
  // A later writeHead Set-Cookie, such as logout, replaces this one.
  if (session && token) res.setHeader('Set-Cookie', sessionCookie(token, config.secure));

  if (path === '/login' && method === 'GET') {
    if (session) {
      redirect(res, config, '/');
      return;
    }
    html(
      res,
      200,
      renderLogin(config.origin, url.searchParams.get('error')),
      token ? clearSessionCookie(config.secure) : undefined,
    );
    return;
  }
  if (path === '/login' && method === 'POST') {
    postLogin(req, res, db, config, await readForm(req));
    return;
  }
  if (!session) {
    redirect(res, config, '/login', token ? clearSessionCookie(config.secure) : undefined);
    return;
  }
  if (method === 'POST') {
    const form = await readForm(req);
    if (!tokensEqual(session.csrf, form.get('csrf') ?? '')) {
      if (wantsJson(req)) {
        json(res, 403, { error: 'The form expired. Try again.' });
        return;
      }
      redirect(res, config, withError(safeNext(form.get('next'), '/'), 'csrf'));
      return;
    }
    postAuthed(req, res, db, config, session, path, form);
    return;
  }
  getAuthed(res, db, config, session, path, url);
}

function postSetup(
  req: IncomingMessage,
  res: ServerResponse,
  db: DatabaseSync,
  config: Config,
  form: URLSearchParams,
): void {
  runPost(req, res, config, '/setup', () => {
    const password = form.get('password') ?? '';
    if (password !== (form.get('confirm') ?? '')) {
      throw new Refusal('mismatch', 'Those passwords do not match.');
    }
    const user = createFirstAdmin(db, form.get('email') ?? '', password);
    const created = createSession(db, user.id, config.sessionSecret);
    redirect(res, config, '/', sessionCookie(created.token, config.secure));
  });
}

function postLogin(
  req: IncomingMessage,
  res: ServerResponse,
  db: DatabaseSync,
  config: Config,
  form: URLSearchParams,
): void {
  runPost(req, res, config, '/login', () => {
    const password = form.get('password') ?? '';
    let email: string;
    try {
      email = parseEmail(form.get('email') ?? '');
    } catch (err) {
      if (!(err instanceof Refusal)) throw err;
      verifyPassword(password, dummyPasswordHash());
      throw new Refusal('login', 'Email or password is wrong.');
    }
    const user = findUserByEmail(db, email);
    const ok = verifyPassword(password, user ? user.password_hash : dummyPasswordHash());
    if (!user || !ok) throw new Refusal('login', 'Email or password is wrong.');
    const created = createSession(db, user.id, config.sessionSecret);
    redirect(res, config, '/', sessionCookie(created.token, config.secure));
  });
}

function postAuthed(
  req: IncomingMessage,
  res: ServerResponse,
  db: DatabaseSync,
  config: Config,
  session: SessionRecord,
  path: string,
  form: URLSearchParams,
): void {
  if (path === '/logout') {
    deleteSession(db, session.sessionId);
    redirect(res, config, '/login', clearSessionCookie(config.secure));
    return;
  }
  if (path === '/account/password') {
    runPost(req, res, config, '/settings', () => {
      const password = form.get('password') ?? '';
      if (password !== (form.get('confirm') ?? '')) {
        throw new Refusal('mismatch', 'Those passwords do not match.');
      }
      const user = getUserWithHash(db, session.user.id);
      if (!user || !verifyPassword(form.get('current') ?? '', user.password_hash)) {
        throw new Refusal('password', 'Check the password and try again.');
      }
      setPassword(db, user.id, password);
      deleteSessionsForUser(db, user.id);
      const created = createSession(db, user.id, config.sessionSecret);
      redirect(res, config, '/settings', sessionCookie(created.token, config.secure));
    });
    return;
  }
  if (path === '/users') {
    runPost(req, res, config, '/settings', () => {
      requireAdmin(session);
      createUser(db, {
        email: form.get('email') ?? '',
        password: form.get('password') ?? '',
        role: parseRole(form.get('role') ?? 'member'),
      });
      redirect(res, config, '/settings');
    });
    return;
  }
  if (path === '/labels') {
    runPost(req, res, config, '/settings', () => {
      addLabel(db, form.get('name') ?? '', form.get('color') ?? '');
      redirect(res, config, '/settings');
    });
    return;
  }
  if (path === '/cards') {
    const parentRaw = form.get('parent_id') ?? '';
    const parentId = parentRaw === '' ? null : parseId(parentRaw);
    const next = safeNext(form.get('next'), parentId == null ? '/' : '/cards/' + parentRaw);
    runPost(req, res, config, next, () => {
      if (parentRaw !== '' && parentId == null) throw new Refusal('parent', 'That parent is not allowed');
      createCard(db, {
        parentId,
        title: form.get('title') ?? '',
        status: form.get('status') ?? '',
      });
      redirect(res, config, next);
    });
    return;
  }

  const userDelete = /^\/users\/(\d+)\/delete$/.exec(path);
  if (userDelete) {
    runPost(req, res, config, '/settings', () => {
      requireAdmin(session);
      const id = idFrom(userDelete[1]);
      const removingSelf = id === session.user.id;
      deleteUser(db, id);
      if (removingSelf) {
        redirect(res, config, '/login', clearSessionCookie(config.secure));
        return;
      }
      redirect(res, config, '/settings');
    });
    return;
  }

  const labelDelete = /^\/labels\/(\d+)\/delete$/.exec(path);
  if (labelDelete) {
    runPost(req, res, config, '/settings', () => {
      requireAdmin(session);
      deleteLabel(db, idFrom(labelDelete[1]));
      redirect(res, config, '/settings');
    });
    return;
  }

  const commentDelete = /^\/comments\/(\d+)\/delete$/.exec(path);
  if (commentDelete) {
    const next = safeNext(form.get('next'), '/');
    runPost(req, res, config, next, () => {
      deleteComment(db, idFrom(commentDelete[1]), session.user);
      redirect(res, config, next);
    });
    return;
  }

  const cardDelete = /^\/cards\/(\d+)\/delete$/.exec(path);
  if (cardDelete) {
    runPost(req, res, config, safeNext(form.get('next'), '/'), () => {
      const card = mustGetCard(db, idFrom(cardDelete[1]));
      const next = card.parent_id == null ? '/' : '/cards/' + String(card.parent_id);
      deleteCard(db, card.id);
      redirect(res, config, next);
    });
    return;
  }

  const cardMove = /^\/cards\/(\d+)\/move$/.exec(path);
  if (cardMove) {
    const next = safeNext(form.get('next'), '/');
    runPost(req, res, config, next, () => {
      const beforeRaw = form.get('before_id');
      let beforeId: number | null = null;
      if (beforeRaw) {
        beforeId = parseId(beforeRaw);
        if (beforeId == null) throw new Refusal('move', 'That position is not valid');
      }
      let parentId: number | null | undefined;
      if (form.has('parent_id')) {
        const raw = form.get('parent_id') ?? '';
        if (raw === '') parentId = null;
        else {
          const parsed = parseId(raw);
          if (parsed == null) throw new Refusal('parent', 'That parent is not allowed');
          parentId = parsed;
        }
      }
      moveCard(db, idFrom(cardMove[1]), {
        status: form.get('status') ?? '',
        beforeId,
        parentId,
        keepRank: form.get('keep_rank') === '1',
      });
      if (wantsJson(req)) {
        json(res, 200, { ok: true });
        return;
      }
      redirect(res, config, next);
    });
    return;
  }

  const cardComment = /^\/cards\/(\d+)\/comments$/.exec(path);
  if (cardComment) {
    const id = idFrom(cardComment[1]);
    const next = safeNext(form.get('next'), '/cards/' + String(id));
    runPost(req, res, config, next, () => {
      addComment(db, id, session.user.id, form.get('body') ?? '');
      redirect(res, config, next);
    });
    return;
  }

  const cardUpdate = /^\/cards\/(\d+)$/.exec(path);
  if (cardUpdate) {
    const id = idFrom(cardUpdate[1]);
    const next = safeNext(form.get('next'), '/cards/' + String(id));
    runPost(req, res, config, next, () => {
      const assigneeRaw = form.get('assignee_id') ?? '';
      const assigneeId = assigneeRaw === '' ? null : parseId(assigneeRaw);
      if (assigneeRaw !== '' && assigneeId == null) {
        throw new Refusal('assignee', 'That assignee is not on this board');
      }
      const labelIds = form.getAll('label').map((raw) => {
        const parsed = parseId(raw);
        if (parsed == null) throw new Refusal('label', 'That label was not found');
        return parsed;
      });
      updateCard(db, id, {
        title: form.get('title') ?? '',
        description: form.get('description') ?? '',
        due_on: form.get('due_on') ?? '',
        assignee_id: assigneeId,
        priority: form.get('priority') ?? '',
        status: form.get('status') ?? '',
        labelIds,
      });
      redirect(res, config, next);
    });
    return;
  }

  html(res, 404, renderStatus('Not found', 'That page was not found.'));
}

function getAuthed(
  res: ServerResponse,
  db: DatabaseSync,
  config: Config,
  session: SessionRecord,
  path: string,
  url: URL,
): void {
  const error = url.searchParams.get('error');
  const viewer = viewerOf(session);
  if (path === '/') {
    html(
      res,
      200,
      renderHome({
        origin: config.origin,
        viewer,
        cards: listChildren(db, null),
        labelsByCard: labelsByCard(db),
        users: listUsers(db),
        counts: childCounts(db),
        today: todayUtc(),
        error,
      }),
    );
    return;
  }
  if (path === '/all') {
    html(
      res,
      200,
      renderAll({
        origin: config.origin,
        viewer,
        cards: listAllCards(db),
        labelsByCard: labelsByCard(db),
        users: listUsers(db),
        counts: childCounts(db),
        today: todayUtc(),
        error,
      }),
    );
    return;
  }
  if (path === '/settings') {
    html(
      res,
      200,
      renderSettings({
        origin: config.origin,
        viewer,
        users: listUsers(db),
        labels: listLabels(db),
        error,
      }),
    );
    return;
  }
  const cardMatch = /^\/cards\/(\d+)$/.exec(path);
  if (cardMatch) {
    try {
      const card = mustGetCard(db, idFrom(cardMatch[1]));
      const linked = labelsByCard(db);
      html(
        res,
        200,
        renderCardPage({
          origin: config.origin,
          viewer,
          card,
          chain: ancestors(db, card),
          children: card.type === 'subtask' ? [] : listChildren(db, card.id),
          comments: listComments(db, card.id),
          labels: listLabels(db),
          cardLabelIds: (linked.get(card.id) ?? []).map((label) => label.id),
          labelsByCard: linked,
          users: listUsers(db),
          counts: childCounts(db),
          today: todayUtc(),
          error,
        }),
      );
    } catch (err) {
      if (err instanceof Refusal && err.code === 'missing') {
        html(res, 404, renderStatus('Not found', err.message));
        return;
      }
      throw err;
    }
    return;
  }
  html(res, 404, renderStatus('Not found', 'That page was not found.'));
}

function main(): void {
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : 'Invalid configuration');
    process.exit(1);
  }
  let db: DatabaseSync;
  try {
    db = openDatabase(config.dataPath);
  } catch (err) {
    console.error(err instanceof Error ? err.message : 'Could not open the database');
    process.exit(1);
  }
  const server = createServer((req, res) => {
    route(req, res, db, config).catch((err: unknown) => {
      if (err instanceof Refusal) {
        if (!res.headersSent) {
          if (wantsJson(req)) json(res, httpStatus(err), { error: err.message });
          else html(res, httpStatus(err), renderStatus('Not available', err.message));
        }
        return;
      }
      console.error(err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal error');
      }
    });
  });
  server.on('error', (err: unknown) => {
    console.error(err instanceof Error ? err.message : 'Server failed');
    process.exit(1);
  });
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`GOST listening on 0.0.0.0:${config.port}`);
  });
}

main();
