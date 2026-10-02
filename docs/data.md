# Data

One SQLite file per container. Foreign keys are on. The journal mode is WAL. Dates and times are UTC text. A calendar date is `YYYY-MM-DD`. A timestamp is ISO-8601.

The parent rules and the rank rules are enforced by the application when it writes. SQLite holds the shape and the simple checks.

## Tables

### users

| Column | Notes |
| --- | --- |
| id | Integer primary key |
| email | Unique, stored lowercase |
| password_hash | scrypt hash |
| role | `admin` or `member` |
| created_at | Timestamp |

The first user is the admin, created on the setup page. Further users are created by an admin.

Password hashing uses Node `scrypt` with a random salt, `N=16384`, `r=8`, `p=1`, and a 32-byte key. The stored value contains the parameters, the salt, and the key.

### sessions

| Column | Notes |
| --- | --- |
| id | Hash of the cookie token, mixed with `SESSION_SECRET` |
| user_id | References users. Deleting a user deletes their sessions |
| csrf_token | Random token echoed by forms |
| expires_at | Timestamp |

The cookie value is the raw token. It is httpOnly, SameSite=Lax, and Secure when `PUBLIC_BASE_URL` is `https`. A session lasts 30 days and slides forward on use.

### cards

| Column | Notes |
| --- | --- |
| id | Integer primary key |
| type | `goal`, `initiative`, `epic`, `task`, or `subtask` |
| parent_id | Null only for a Goal. Otherwise references cards |
| title | Required, trimmed, 1 to 200 characters |
| description | Plain text, default empty, at most 20,000 characters |
| due_on | Calendar date, or null |
| assignee_id | References users, or null. Set null when that user is deleted |
| priority | Integer 0 through 4. Default 2. 0 is Urgent, 4 is Lowest |
| status | `backlog`, `ready`, `in_progress`, `blocked`, or `done` |
| rank | Integer. Order among the same parent and the same status |
| created_at | Timestamp |
| updated_at | Timestamp |

Index: `(parent_id, status, rank)`.

### labels

| Column | Notes |
| --- | --- |
| id | Integer primary key |
| name | Unique ignoring case, trimmed, 1 to 30 characters |
| color | One of `gray`, `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink` |

### card_labels

`card_id` and `label_id`, together the primary key. Deleting a card or a label removes the link rows.

### comments

| Column | Notes |
| --- | --- |
| id | Integer primary key |
| card_id | References cards. Deleting a card deletes its comments |
| user_id | References users. A user with comments cannot be deleted |
| body | Plain text, trimmed, 1 to 5,000 characters |
| created_at | Timestamp |

## Parent rules

| Type | Parent |
| --- | --- |
| goal | None |
| initiative | goal |
| epic | initiative |
| task | epic |
| subtask | task |

A write that breaks this is refused. The first version has no way to change `parent_id` after create.

## Status and rank

Status is the column. The column order is Backlog, Ready, In progress, Blocked, Done.

`rank` orders cards that share a parent and a status. Gaps start at 1024. A new card in a column gets a rank 1024 above the current highest sibling in that column, or 1024 when the column is empty. A drop between two siblings uses a rank halfway between them. When the gap is smaller than 2, that parent and status are renumbered to 1024, 2048, 3072, and so on.

On a nested board, the column sorts by `rank`. Priority does not change `rank`.

On the All view, swimlanes for the same parent sort by `priority` ascending, then by title ignoring case. Sub-task cards in one cell sort by `rank`. A move on the All view updates `status` and, for a sub-task dropped among its siblings, `rank`. The server refuses a move whose new parent would differ.

## Deletes

- A card with children is kept. The delete is refused.
- A label delete removes the label and its links.
- A user delete is refused when that user has comments, and when that user is the last admin.
- A user delete clears `assignee_id` on their cards and deletes their sessions.

## Setup values

A new card starts at priority 2 (Normal), with an empty description, no due date, no assignee, and no labels. Its status is the column it was added in.
