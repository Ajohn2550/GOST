import {
  isCardType,
  isColor,
  isStatus,
  type CardType,
  type LabelColor,
  type Role,
  type Status,
} from './types.js';

export class Refusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'Refusal';
    this.code = code;
  }
}

const PARENT_TYPE: Record<CardType, CardType | null> = {
  goal: null,
  initiative: 'goal',
  epic: 'initiative',
  task: 'epic',
  subtask: 'task',
};

export const CHILD_TYPE: Record<CardType, CardType | null> = {
  goal: 'initiative',
  initiative: 'epic',
  epic: 'task',
  task: 'subtask',
  subtask: null,
};

export function assertParentRule(childType: CardType, parentType: CardType | null): void {
  if (PARENT_TYPE[childType] !== parentType) {
    throw new Refusal('parent', 'That parent is not allowed for this card');
  }
}

export function childHeading(type: CardType): string | null {
  switch (CHILD_TYPE[type]) {
    case 'initiative':
      return 'Initiatives';
    case 'epic':
      return 'Epics';
    case 'task':
      return 'Tasks';
    case 'subtask':
      return 'Sub-tasks';
    default:
      return null;
  }
}

export function typeName(type: CardType): string {
  switch (type) {
    case 'goal':
      return 'Goal';
    case 'initiative':
      return 'Initiative';
    case 'epic':
      return 'Epic';
    case 'task':
      return 'Task';
    case 'subtask':
      return 'Sub-task';
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isLate(due: string | null, status: string, today: string): boolean {
  return due != null && due < today && status !== 'done';
}

export function parseStatus(raw: string): Status {
  if (!isStatus(raw)) throw new Refusal('status', 'That status is not allowed');
  return raw;
}

export function parsePriority(raw: string | number): number {
  const text = typeof raw === 'number' ? String(raw) : raw.trim();
  if (!/^[0-4]$/.test(text)) throw new Refusal('priority', 'Priority must be from 0 to 4');
  return Number(text);
}

export function parseTitle(raw: string): string {
  const title = raw.replace(/[\r\n]+/g, ' ').trim();
  if (title.length < 1 || title.length > 200) {
    throw new Refusal('title', 'Title must be 1 to 200 characters');
  }
  return title;
}

export function parseDescription(raw: string): string {
  const description = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (description.length > 20000) throw new Refusal('description', 'Description is too long');
  return description;
}

export function parseDue(raw: string | null): string | null {
  if (raw == null) return null;
  const value = raw.trim();
  if (value === '') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Refusal('due', 'Due date must be YYYY-MM-DD');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Refusal('due', 'Due date must be YYYY-MM-DD');
  }
  return value;
}

export function parseEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > 200 ||
    !email.includes('@') ||
    /\s/.test(email) ||
    email.startsWith('@') ||
    email.endsWith('@')
  ) {
    throw new Refusal('email', 'Enter an email address');
  }
  return email;
}

export function parsePassword(raw: string): string {
  if (raw.length < 8 || raw.length > 200) {
    throw new Refusal('password', 'Password must be 8 to 200 characters');
  }
  return raw;
}

export function parseRole(raw: string): Role {
  if (raw !== 'admin' && raw !== 'member') {
    throw new Refusal('forbidden', 'Role must be admin or member');
  }
  return raw;
}

export function parseColor(raw: string): LabelColor {
  if (!isColor(raw)) throw new Refusal('label', 'Pick a label color');
  return raw;
}

export function parseLabelName(raw: string): string {
  const name = raw.trim();
  if (name.length < 1 || name.length > 30) {
    throw new Refusal('label', 'Label name must be 1 to 30 characters');
  }
  return name;
}

export function parseComment(raw: string): string {
  const body = raw.trim();
  if (body.length < 1 || body.length > 5000) {
    throw new Refusal('comment', 'Comment must be 1 to 5,000 characters');
  }
  return body;
}

export function parseId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

export function safeNext(raw: string | null | undefined, fallback: string): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return fallback;
  if (!/^\/[A-Za-z0-9/_\-?.=&]*$/.test(raw)) return fallback;
  return raw;
}

export function requireCardType(raw: string): CardType {
  if (!isCardType(raw)) throw new Refusal('parent', 'That type is not allowed');
  return raw;
}
