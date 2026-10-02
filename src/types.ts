export const STATUSES = [
  { value: 'backlog', name: 'Backlog' },
  { value: 'ready', name: 'Ready' },
  { value: 'in_progress', name: 'In progress' },
  { value: 'blocked', name: 'Blocked' },
  { value: 'done', name: 'Done' },
] as const;

export const PRIORITIES = [
  { value: 0, name: 'Urgent' },
  { value: 1, name: 'High' },
  { value: 2, name: 'Normal' },
  { value: 3, name: 'Low' },
  { value: 4, name: 'Lowest' },
] as const;

export const COLORS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
] as const;

export type Status = (typeof STATUSES)[number]['value'];
export type LabelColor = (typeof COLORS)[number];
export type Role = 'admin' | 'member';
export type CardType = 'goal' | 'initiative' | 'epic' | 'task' | 'subtask';

export type User = {
  id: number;
  email: string;
  role: Role;
  created_at: string;
};

export type Card = {
  id: number;
  type: CardType;
  parent_id: number | null;
  title: string;
  description: string;
  due_on: string | null;
  assignee_id: number | null;
  priority: number;
  status: Status;
  rank: number;
  created_at: string;
  updated_at: string;
};

export type Label = {
  id: number;
  name: string;
  color: LabelColor;
};

export type Comment = {
  id: number;
  card_id: number;
  user_id: number;
  body: string;
  created_at: string;
};

export type CommentView = Comment & { author_email: string };

export type Viewer = {
  id: number;
  email: string;
  role: Role;
  csrf: string;
};

export function priorityName(value: number): string {
  const found = PRIORITIES.find((item) => item.value === value);
  return found ? found.name : String(value);
}

export function isCardType(value: string): value is CardType {
  return (
    value === 'goal' ||
    value === 'initiative' ||
    value === 'epic' ||
    value === 'task' ||
    value === 'subtask'
  );
}

export function isStatus(value: string): value is Status {
  return STATUSES.some((item) => item.value === value);
}

export function isColor(value: string): value is LabelColor {
  return COLORS.some((item) => item === value);
}
