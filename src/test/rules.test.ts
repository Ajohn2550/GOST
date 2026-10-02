import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../db.js';
import { hashPassword, verifyPassword } from '../password.js';
import { renderCardPage } from '../render.js';
import {
  addComment,
  createCard,
  createSession,
  createUser,
  deleteCard,
  deleteComment,
  deleteUser,
  getCard,
  listComments,
  moveCard,
  readSession,
  updateCard,
  type CardPatch,
} from '../store.js';
import { type Card, type Label } from '../types.js';
import { Refusal } from '../validate.js';

function patch(card: Card, overrides: Partial<CardPatch> = {}): CardPatch {
  return {
    title: card.title,
    description: card.description,
    due_on: card.due_on,
    assignee_id: card.assignee_id,
    priority: card.priority,
    status: card.status,
    labelIds: [],
    ...overrides,
  };
}

test('parent type rules follow the chain and refuse bad pairs', () => {
  const db = openDatabase(':memory:');
  try {
    const goal = createCard(db, { parentId: null, title: 'Goal', status: 'backlog' });
    assert.equal(goal.type, 'goal');
    assert.equal(goal.parent_id, null);
    assert.equal(goal.priority, 2);
    assert.equal(goal.description, '');
    assert.equal(goal.due_on, null);
    assert.equal(goal.assignee_id, null);

    const initiative = createCard(db, {
      parentId: goal.id,
      title: 'Initiative',
      status: 'ready',
    });
    const epic = createCard(db, { parentId: initiative.id, title: 'Epic', status: 'backlog' });
    const task = createCard(db, { parentId: epic.id, title: 'Task', status: 'in_progress' });
    const subtask = createCard(db, { parentId: task.id, title: 'Sub-task', status: 'blocked' });
    assert.equal(initiative.type, 'initiative');
    assert.equal(initiative.parent_id, goal.id);
    assert.equal(epic.type, 'epic');
    assert.equal(epic.parent_id, initiative.id);
    assert.equal(task.type, 'task');
    assert.equal(task.parent_id, epic.id);
    assert.equal(subtask.type, 'subtask');
    assert.equal(subtask.parent_id, task.id);

    const refused = (err: unknown) => err instanceof Refusal && err.code === 'parent';
    assert.throws(
      () => createCard(db, { parentId: goal.id, type: 'epic', title: 'Bad', status: 'backlog' }),
      refused,
    );
    assert.throws(
      () => createCard(db, { parentId: null, type: 'task', title: 'Bad', status: 'backlog' }),
      refused,
    );
    assert.throws(
      () =>
        createCard(db, {
          parentId: initiative.id,
          type: 'subtask',
          title: 'Bad',
          status: 'backlog',
        }),
      refused,
    );
    assert.throws(
      () => createCard(db, { parentId: subtask.id, title: 'Nope', status: 'backlog' }),
      refused,
    );
    assert.throws(
      () => createCard(db, { parentId: task.id, type: 'goal', title: 'Nope', status: 'backlog' }),
      refused,
    );
    assert.equal(getCard(db, goal.id)?.type, 'goal');
  } finally {
    db.close();
  }
});

test('rank inserts leave a gap and renumber when the gap is exhausted', () => {
  const db = openDatabase(':memory:');
  try {
    const first = createCard(db, { parentId: null, title: 'A', status: 'backlog' });
    const second = createCard(db, { parentId: null, title: 'B', status: 'backlog' });
    const third = createCard(db, { parentId: null, title: 'C', status: 'backlog' });
    assert.equal(first.rank, 1024);
    assert.equal(second.rank, 2048);
    assert.equal(third.rank, 3072);

    const between = moveCard(db, third.id, { status: 'backlog', beforeId: second.id });
    assert.equal(between.rank, 1536);
    assert.equal(getCard(db, first.id)?.rank, 1024);
    assert.equal(getCard(db, second.id)?.rank, 2048);

    const otherColumn = createCard(db, { parentId: null, title: 'D', status: 'ready' });
    assert.equal(otherColumn.rank, 1024);

    // Adjacent integers have no room between them, so the column is renumbered.
    db.prepare('UPDATE cards SET rank = ? WHERE id = ?').run(10, first.id);
    db.prepare('UPDATE cards SET rank = ? WHERE id = ?').run(11, second.id);
    const renumbered = moveCard(db, third.id, { status: 'backlog', beforeId: second.id });
    assert.equal(getCard(db, first.id)?.rank, 1024);
    assert.equal(renumbered.rank, 2048);
    assert.equal(getCard(db, second.id)?.rank, 3072);
    assert.equal(getCard(db, otherColumn.id)?.rank, 1024);
  } finally {
    db.close();
  }
});

test('password hash verifies the right password and rejects the wrong one', () => {
  const hash = hashPassword('correct-password');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(verifyPassword('correct-password', hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);
  assert.notEqual(hashPassword('correct-password'), hash);
});

test('delete refuses cards with children, commented users, and the last admin', () => {
  const db = openDatabase(':memory:');
  try {
    const goal = createCard(db, { parentId: null, title: 'Goal', status: 'backlog' });
    const child = createCard(db, { parentId: goal.id, title: 'Initiative', status: 'backlog' });
    assert.throws(() => deleteCard(db, goal.id), (err: unknown) => {
      return err instanceof Refusal && err.code === 'children';
    });
    assert.ok(getCard(db, goal.id));
    deleteCard(db, child.id);
    assert.equal(getCard(db, child.id), undefined);

    const admin = createUser(db, {
      email: 'Admin@Example.com',
      password: 'password-1',
      role: 'admin',
    });
    assert.equal(admin.email, 'admin@example.com');
    assert.throws(() => deleteUser(db, admin.id), (err: unknown) => {
      return err instanceof Refusal && err.code === 'last_admin';
    });

    const member = createUser(db, {
      email: 'member@example.com',
      password: 'password-2',
      role: 'member',
    });
    updateCard(db, goal.id, patch(goal, { assignee_id: member.id }));
    addComment(db, goal.id, member.id, 'Still here');
    const session = createSession(db, member.id, 'test-secret');
    assert.throws(() => deleteUser(db, member.id), (err: unknown) => {
      return err instanceof Refusal && err.code === 'comments';
    });
    assert.equal(getCard(db, goal.id)?.assignee_id, member.id);

    const comment = listComments(db, goal.id)[0];
    assert.ok(comment);
    deleteComment(db, comment.id, member);
    deleteUser(db, member.id);
    assert.equal(getCard(db, goal.id)?.assignee_id, null);
    assert.equal(readSession(db, session.token, 'test-secret'), null);
    assert.throws(() => deleteUser(db, admin.id), (err: unknown) => {
      return err instanceof Refusal && err.code === 'last_admin';
    });
  } finally {
    db.close();
  }
});

test('a move that would change parent is refused', () => {
  const db = openDatabase(':memory:');
  try {
    const goal = createCard(db, { parentId: null, title: 'Goal', status: 'backlog' });
    const other = createCard(db, { parentId: null, title: 'Other', status: 'backlog' });
    const initiative = createCard(db, {
      parentId: goal.id,
      title: 'Initiative',
      status: 'backlog',
    });
    const elsewhere = createCard(db, {
      parentId: other.id,
      title: 'Elsewhere',
      status: 'done',
    });
    assert.throws(
      () => moveCard(db, initiative.id, { status: 'done', parentId: other.id }),
      (err: unknown) => err instanceof Refusal && err.code === 'move',
    );
    assert.throws(
      () => moveCard(db, initiative.id, { status: 'done', beforeId: elsewhere.id }),
      (err: unknown) => err instanceof Refusal && err.code === 'move',
    );
    const moved = moveCard(db, initiative.id, { status: 'done' });
    assert.equal(moved.status, 'done');
    assert.equal(moved.parent_id, goal.id);
    assert.equal(moved.rank, 1024);
  } finally {
    db.close();
  }
});

test('keep-rank changes status only, and a drop with no before_id still assigns rank', () => {
  const db = openDatabase(':memory:');
  try {
    const first = createCard(db, { parentId: null, title: 'A', status: 'backlog' });
    const second = createCard(db, { parentId: null, title: 'B', status: 'backlog' });
    const third = createCard(db, { parentId: null, title: 'C', status: 'backlog' });
    assert.throws(
      () => moveCard(db, second.id, { status: 'done', keepRank: true, parentId: first.id }),
      (err: unknown) => err instanceof Refusal && err.code === 'move',
    );
    const kept = moveCard(db, second.id, { status: 'done', keepRank: true });
    assert.equal(kept.status, 'done');
    assert.equal(kept.rank, 2048);
    assert.equal(getCard(db, first.id)?.rank, 1024);
    assert.equal(getCard(db, third.id)?.rank, 3072);
    const end = moveCard(db, first.id, { status: 'backlog' });
    assert.equal(end.status, 'backlog');
    assert.equal(end.rank, 4096);
    assert.equal(getCard(db, third.id)?.rank, 3072);
    assert.equal(getCard(db, second.id)?.rank, 2048);
  } finally {
    db.close();
  }
});

test('priority outside 0 through 4 is refused and a valid change keeps rank', () => {
  const db = openDatabase(':memory:');
  try {
    const goal = createCard(db, { parentId: null, title: 'Goal', status: 'backlog' });
    assert.throws(
      () => updateCard(db, goal.id, patch(goal, { priority: 5 })),
      (err: unknown) => err instanceof Refusal && err.code === 'priority',
    );
    assert.throws(
      () => updateCard(db, goal.id, patch(goal, { priority: -1 })),
      (err: unknown) => err instanceof Refusal && err.code === 'priority',
    );
    assert.throws(
      () => updateCard(db, goal.id, patch(goal, { priority: 1.5 })),
      (err: unknown) => err instanceof Refusal && err.code === 'priority',
    );
    const updated = updateCard(db, goal.id, patch(goal, { priority: 0 }));
    assert.equal(updated.priority, 0);
    assert.equal(updated.rank, goal.rank);
    const lowest = updateCard(db, goal.id, patch(updated, { priority: 4 }));
    assert.equal(lowest.priority, 4);
    assert.equal(lowest.rank, goal.rank);
  } finally {
    db.close();
  }
});

test('HTML in a title or comment is stored as text and escaped when rendered', () => {
  const db = openDatabase(':memory:');
  try {
    const title = '<img src=x onerror=alert(1)>';
    const body = '<script>alert(1)</script>';
    const admin = createUser(db, {
      email: 'admin@example.com',
      password: 'password-1',
      role: 'admin',
    });
    const card = createCard(db, { parentId: null, title, status: 'backlog' });
    addComment(db, card.id, admin.id, body);
    const stored = getCard(db, card.id);
    const comments = listComments(db, card.id);
    assert.equal(stored?.title, title);
    assert.equal(comments[0]?.body, body);

    const html = renderCardPage({
      origin: 'http://127.0.0.1:8080',
      viewer: { id: admin.id, email: admin.email, role: 'admin', csrf: 'csrf-token' },
      card: stored ?? card,
      chain: [],
      children: [],
      comments,
      labels: [],
      cardLabelIds: [],
      labelsByCard: new Map<number, Label[]>(),
      users: [admin],
      counts: new Map<number, number>(),
      today: '2026-10-01',
      error: null,
    });
    assert.equal(html.includes(title), false);
    assert.equal(html.includes(body), false);
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  } finally {
    db.close();
  }
});
