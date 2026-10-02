import { randomBytes } from 'node:crypto';
import { type DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite';
import { hashPassword } from './password.js';
import { planInsert } from './rank.js';
import { hashSessionToken, SESSION_MS } from './session.js';
import {
  isCardType,
  isColor,
  isStatus,
  type Card,
  type CardType,
  type CommentView,
  type Label,
  type Role,
  type Status,
  type User,
} from './types.js';
import {
  assertParentRule,
  CHILD_TYPE,
  nowIso,
  parseComment,
  parseDescription,
  parseDue,
  parseColor,
  parseEmail,
  parseLabelName,
  parsePassword,
  parsePriority,
  parseStatus,
  parseTitle,
  Refusal,
  requireCardType,
} from './validate.js';

export type UserWithHash = User & { password_hash: string };

export type CardPatch = {
  title: string;
  description: string;
  due_on: string | null;
  assignee_id: number | null;
  priority: string | number;
  status: string;
  labelIds: number[];
};

export type CreateCardInput = {
  parentId: number | null;
  title: string;
  status: string;
  type?: string;
};

export type MoveCardInput = {
  status: string;
  beforeId?: number | null;
  parentId?: number | null;
  keepRank?: boolean;
};

export type SessionRecord = {
  user: User;
  csrf: string;
  sessionId: string;
};

function num(value: SQLOutputValue): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new Error('Expected a number');
}

function str(value: SQLOutputValue): string {
  if (typeof value === 'string') return value;
  throw new Error('Expected text');
}

function numOrNull(value: SQLOutputValue): number | null {
  if (value == null) return null;
  return num(value);
}

function strOrNull(value: SQLOutputValue): string | null {
  if (value == null) return null;
  return str(value);
}

function countOf(db: DatabaseSync, sql: string, ...args: SQLInputValue[]): number {
  const row = db.prepare(sql).get(...args);
  if (!row) return 0;
  return num(row.n);
}

function insertedId(result: { lastInsertRowid: number | bigint; changes: number | bigint }): number {
  if (Number(result.changes) < 1) throw new Error('Insert failed');
  return Number(result.lastInsertRowid);
}

function isUnique(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE');
}

function transaction(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // BEGIN failed, so this connection is not in a transaction.
    }
    throw err;
  }
}

function asUser(row: Record<string, SQLOutputValue>): User {
  const role = str(row.role);
  if (role !== 'admin' && role !== 'member') throw new Error('Bad role');
  return {
    id: num(row.id),
    email: str(row.email),
    role,
    created_at: str(row.created_at),
  };
}

function asCard(row: Record<string, SQLOutputValue>): Card {
  const type = str(row.type);
  const status = str(row.status);
  if (!isCardType(type)) throw new Error('Bad card type');
  if (!isStatus(status)) throw new Error('Bad status');
  return {
    id: num(row.id),
    type,
    parent_id: numOrNull(row.parent_id),
    title: str(row.title),
    description: str(row.description),
    due_on: strOrNull(row.due_on),
    assignee_id: numOrNull(row.assignee_id),
    priority: num(row.priority),
    status,
    rank: num(row.rank),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
}

function asLabel(row: Record<string, SQLOutputValue>): Label {
  const color = str(row.color);
  if (!isColor(color)) throw new Error('Bad label color');
  return { id: num(row.id), name: str(row.name), color };
}

export function userCount(db: DatabaseSync): number {
  return countOf(db, 'SELECT COUNT(*) AS n FROM users');
}

export function listUsers(db: DatabaseSync): User[] {
  return db
    .prepare('SELECT id, email, role, created_at FROM users ORDER BY email, id')
    .all()
    .map(asUser);
}

export function getUser(db: DatabaseSync, id: number): User | undefined {
  const row = db
    .prepare('SELECT id, email, role, created_at FROM users WHERE id = ?')
    .get(id);
  return row ? asUser(row) : undefined;
}

export function findUserByEmail(db: DatabaseSync, email: string): UserWithHash | undefined {
  const row = db
    .prepare('SELECT id, email, role, created_at, password_hash FROM users WHERE email = ?')
    .get(email);
  if (!row) return undefined;
  return { ...asUser(row), password_hash: str(row.password_hash) };
}

export function getUserWithHash(db: DatabaseSync, id: number): UserWithHash | undefined {
  const row = db
    .prepare('SELECT id, email, role, created_at, password_hash FROM users WHERE id = ?')
    .get(id);
  if (!row) return undefined;
  return { ...asUser(row), password_hash: str(row.password_hash) };
}

function mustUser(db: DatabaseSync, id: number): User {
  const user = getUser(db, id);
  if (!user) throw new Refusal('missing', 'That person was not found');
  return user;
}

export function createUser(
  db: DatabaseSync,
  input: { email: string; password: string; role: Role },
): User {
  const email = parseEmail(input.email);
  const password = parsePassword(input.password);
  const hash = hashPassword(password);
  try {
    const id = insertedId(
      db
        .prepare(
          'INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(email, hash, input.role, nowIso()),
    );
    return mustUser(db, id);
  } catch (err) {
    if (isUnique(err)) throw new Refusal('taken', 'That email is already in use');
    throw err;
  }
}

export function createFirstAdmin(db: DatabaseSync, emailRaw: string, passwordRaw: string): User {
  const email = parseEmail(emailRaw);
  const password = parsePassword(passwordRaw);
  const hash = hashPassword(password);
  const now = nowIso();
  let id = 0;
  transaction(db, () => {
    if (userCount(db) > 0) throw new Refusal('forbidden', 'Setup is already done');
    id = insertedId(
      db
        .prepare(
          'INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(email, hash, 'admin', now),
    );
  });
  return mustUser(db, id);
}

export function setPassword(db: DatabaseSync, userId: number, password: string): void {
  const next = parsePassword(password);
  const hash = hashPassword(next);
  const result = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  if (Number(result.changes) !== 1) throw new Refusal('missing', 'That person was not found');
}

export function deleteUser(db: DatabaseSync, userId: number): void {
  const user = getUser(db, userId);
  if (!user) throw new Refusal('missing', 'That person was not found');
  if (user.role === 'admin') {
    const admins = countOf(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
    if (admins <= 1) throw new Refusal('last_admin', 'The last admin cannot be removed');
  }
  const comments = countOf(db, 'SELECT COUNT(*) AS n FROM comments WHERE user_id = ?', userId);
  if (comments > 0) throw new Refusal('comments', 'This person still has comments');
  const now = nowIso();
  transaction(db, () => {
    db.prepare('UPDATE cards SET assignee_id = NULL, updated_at = ? WHERE assignee_id = ?').run(
      now,
      userId,
    );
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
}

export function deleteSessionsForUser(db: DatabaseSync, userId: number): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function createSession(
  db: DatabaseSync,
  userId: number,
  secret: string,
): { token: string; csrf: string } {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(32).toString('base64url');
  const id = hashSessionToken(token, secret);
  const expires = new Date(Date.now() + SESSION_MS).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    csrf,
    expires,
  );
  return { token, csrf };
}

export function readSession(
  db: DatabaseSync,
  token: string,
  secret: string,
): SessionRecord | null {
  const id = hashSessionToken(token, secret);
  const row = db
    .prepare(
      `SELECT sessions.csrf_token AS csrf_token, sessions.expires_at AS expires_at,
              users.id AS id, users.email AS email, users.role AS role, users.created_at AS created_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ?`,
    )
    .get(id);
  if (!row) return null;
  if (str(row.expires_at) <= nowIso()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
  const expires = new Date(Date.now() + SESSION_MS).toISOString();
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(expires, id);
  return { user: asUser(row), csrf: str(row.csrf_token), sessionId: id };
}

export function deleteSession(db: DatabaseSync, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function getCard(db: DatabaseSync, id: number): Card | undefined {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  return row ? asCard(row) : undefined;
}

export function mustGetCard(db: DatabaseSync, id: number): Card {
  const card = getCard(db, id);
  if (!card) throw new Refusal('missing', 'That card was not found');
  return card;
}

export function listChildren(db: DatabaseSync, parentId: number | null): Card[] {
  const rows =
    parentId == null
      ? db.prepare('SELECT * FROM cards WHERE parent_id IS NULL ORDER BY rank, id').all()
      : db.prepare('SELECT * FROM cards WHERE parent_id = ? ORDER BY rank, id').all(parentId);
  return rows.map(asCard);
}

export function listAllCards(db: DatabaseSync): Card[] {
  return db.prepare('SELECT * FROM cards').all().map(asCard);
}

function listColumn(db: DatabaseSync, parentId: number | null, status: Status): Card[] {
  const rows =
    parentId == null
      ? db
          .prepare(
            'SELECT * FROM cards WHERE parent_id IS NULL AND status = ? ORDER BY rank, id',
          )
          .all(status)
      : db
          .prepare(
            'SELECT * FROM cards WHERE parent_id = ? AND status = ? ORDER BY rank, id',
          )
          .all(parentId, status);
  return rows.map(asCard);
}

export function childCounts(db: DatabaseSync): Map<number, number> {
  const rows = db
    .prepare(
      'SELECT parent_id, COUNT(*) AS n FROM cards WHERE parent_id IS NOT NULL GROUP BY parent_id',
    )
    .all();
  const map = new Map<number, number>();
  for (const row of rows) map.set(num(row.parent_id), num(row.n));
  return map;
}

export function ancestors(db: DatabaseSync, card: Card): Card[] {
  const chain: Card[] = [];
  const seen = new Set<number>();
  let parentId = card.parent_id;
  while (parentId != null) {
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = getCard(db, parentId);
    if (!parent) break;
    chain.push(parent);
    parentId = parent.parent_id;
  }
  chain.reverse();
  return chain;
}

export function createCard(db: DatabaseSync, input: CreateCardInput): Card {
  const title = parseTitle(input.title);
  const status = parseStatus(input.status);
  let parent: Card | null = null;
  if (input.parentId != null) {
    parent = getCard(db, input.parentId) ?? null;
    if (!parent) throw new Refusal('parent', 'Parent not found');
  }
  const parentType: CardType | null = parent ? parent.type : null;
  let type: CardType;
  if (input.type !== undefined) {
    type = requireCardType(input.type);
  } else if (!parent) {
    type = 'goal';
  } else {
    const child = CHILD_TYPE[parent.type];
    if (!child) throw new Refusal('parent', 'This card cannot have children');
    type = child;
  }
  assertParentRule(type, parentType);
  const siblings = listColumn(db, input.parentId, status);
  const planned = planInsert(
    siblings.map((item) => ({ id: item.id, rank: item.rank })),
    siblings.length,
  );
  const now = nowIso();
  const id = insertedId(
    db
      .prepare(
        `INSERT INTO cards
          (type, parent_id, title, description, due_on, assignee_id, priority, status, rank, created_at, updated_at)
         VALUES (?, ?, ?, '', NULL, NULL, 2, ?, ?, ?, ?)`,
      )
      .run(type, input.parentId, title, status, planned.rank, now, now),
  );
  return mustGetCard(db, id);
}

export function moveCard(db: DatabaseSync, id: number, input: MoveCardInput): Card {
  const card = mustGetCard(db, id);
  const status = parseStatus(input.status);
  if (input.parentId !== undefined && (input.parentId ?? null) !== card.parent_id) {
    throw new Refusal('move', 'A card cannot move to a different parent');
  }
  const now = nowIso();
  // All-view status moves keep the stored rank so nested sibling order stays put.
  if (input.keepRank) {
    db.prepare('UPDATE cards SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      now,
      card.id,
    );
    return mustGetCard(db, id);
  }
  const siblings = listColumn(db, card.parent_id, status).filter((item) => item.id !== card.id);
  let insertAt = siblings.length;
  if (input.beforeId != null) {
    const before = getCard(db, input.beforeId);
    if (!before || before.id === card.id) throw new Refusal('move', 'That position is not valid');
    if ((before.parent_id ?? null) !== (card.parent_id ?? null)) {
      throw new Refusal('move', 'A card cannot move to a different parent');
    }
    if (before.status !== status) throw new Refusal('move', 'That position is not valid');
    insertAt = siblings.findIndex((item) => item.id === before.id);
    if (insertAt < 0) throw new Refusal('move', 'That position is not valid');
  }
  const planned = planInsert(
    siblings.map((item) => ({ id: item.id, rank: item.rank })),
    insertAt,
  );
  transaction(db, () => {
    if (planned.renumber) {
      const updateRank = db.prepare('UPDATE cards SET rank = ?, updated_at = ? WHERE id = ?');
      for (const row of planned.renumber) updateRank.run(row.rank, now, row.id);
    }
    db.prepare('UPDATE cards SET status = ?, rank = ?, updated_at = ? WHERE id = ?').run(
      status,
      planned.rank,
      now,
      card.id,
    );
  });
  return mustGetCard(db, id);
}

export function updateCard(db: DatabaseSync, id: number, patch: CardPatch): Card {
  const card = mustGetCard(db, id);
  const title = parseTitle(patch.title);
  const description = parseDescription(patch.description);
  const due = parseDue(patch.due_on);
  const priority = parsePriority(patch.priority);
  const status = parseStatus(patch.status);
  if (patch.assignee_id != null && !getUser(db, patch.assignee_id)) {
    throw new Refusal('assignee', 'That assignee is not on this board');
  }
  const known = new Set(listLabels(db).map((label) => label.id));
  const labelIds = [...new Set(patch.labelIds)];
  for (const labelId of labelIds) {
    if (!known.has(labelId)) throw new Refusal('label', 'That label was not found');
  }
  const now = nowIso();
  transaction(db, () => {
    db.prepare(
      `UPDATE cards
       SET title = ?, description = ?, due_on = ?, assignee_id = ?, priority = ?, updated_at = ?
       WHERE id = ?`,
    ).run(title, description, due, patch.assignee_id, priority, now, id);
    db.prepare('DELETE FROM card_labels WHERE card_id = ?').run(id);
    const insert = db.prepare('INSERT INTO card_labels (card_id, label_id) VALUES (?, ?)');
    for (const labelId of labelIds) insert.run(id, labelId);
  });
  if (status !== card.status) moveCard(db, id, { status });
  return mustGetCard(db, id);
}

export function deleteCard(db: DatabaseSync, id: number): void {
  mustGetCard(db, id);
  const children = countOf(db, 'SELECT COUNT(*) AS n FROM cards WHERE parent_id = ?', id);
  if (children > 0) throw new Refusal('children', 'Delete the children first');
  db.prepare('DELETE FROM cards WHERE id = ?').run(id);
}

export function listLabels(db: DatabaseSync): Label[] {
  return db.prepare('SELECT id, name, color FROM labels ORDER BY lower(name), id').all().map(asLabel);
}

export function labelsByCard(db: DatabaseSync): Map<number, Label[]> {
  const labels = new Map<number, Label>();
  for (const label of listLabels(db)) labels.set(label.id, label);
  const rows = db.prepare('SELECT card_id, label_id FROM card_labels').all();
  const map = new Map<number, Label[]>();
  for (const row of rows) {
    const label = labels.get(num(row.label_id));
    if (!label) continue;
    const cardId = num(row.card_id);
    const list = map.get(cardId) ?? [];
    list.push(label);
    map.set(cardId, list);
  }
  return map;
}

export function addLabel(db: DatabaseSync, nameRaw: string, colorRaw: string): Label {
  const name = parseLabelName(nameRaw);
  const color = parseColor(colorRaw);
  const existing = db.prepare('SELECT id FROM labels WHERE lower(name) = lower(?)').get(name);
  if (existing) throw new Refusal('label', 'That label already exists');
  try {
    const id = insertedId(
      db.prepare('INSERT INTO labels (name, color) VALUES (?, ?)').run(name, color),
    );
    const row = db.prepare('SELECT id, name, color FROM labels WHERE id = ?').get(id);
    if (!row) throw new Refusal('label', 'That label was not found');
    return asLabel(row);
  } catch (err) {
    if (isUnique(err)) throw new Refusal('label', 'That label already exists');
    throw err;
  }
}

export function deleteLabel(db: DatabaseSync, id: number): void {
  const row = db.prepare('SELECT id FROM labels WHERE id = ?').get(id);
  if (!row) throw new Refusal('label', 'That label was not found');
  db.prepare('DELETE FROM labels WHERE id = ?').run(id);
}

export function listComments(db: DatabaseSync, cardId: number): CommentView[] {
  return db
    .prepare(
      `SELECT comments.id AS id, comments.card_id AS card_id, comments.user_id AS user_id,
              comments.body AS body, comments.created_at AS created_at,
              users.email AS author_email
       FROM comments JOIN users ON users.id = comments.user_id
       WHERE comments.card_id = ?
       ORDER BY comments.created_at, comments.id`,
    )
    .all(cardId)
    .map((row) => ({
      id: num(row.id),
      card_id: num(row.card_id),
      user_id: num(row.user_id),
      body: str(row.body),
      created_at: str(row.created_at),
      author_email: str(row.author_email),
    }));
}

export function addComment(
  db: DatabaseSync,
  cardId: number,
  userId: number,
  bodyRaw: string,
): CommentView {
  mustGetCard(db, cardId);
  if (!getUser(db, userId)) throw new Refusal('missing', 'That person was not found');
  const body = parseComment(bodyRaw);
  const id = insertedId(
    db
      .prepare('INSERT INTO comments (card_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(cardId, userId, body, nowIso()),
  );
  const comments = listComments(db, cardId);
  const created = comments.find((comment) => comment.id === id);
  if (!created) throw new Refusal('comment', 'That comment was not found');
  return created;
}

export function deleteComment(
  db: DatabaseSync,
  commentId: number,
  actor: { id: number; role: Role },
): void {
  const row = db.prepare('SELECT id, user_id FROM comments WHERE id = ?').get(commentId);
  if (!row) throw new Refusal('missing', 'That comment was not found');
  if (num(row.user_id) !== actor.id && actor.role !== 'admin') {
    throw new Refusal('forbidden', 'You cannot delete that comment');
  }
  db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
}
