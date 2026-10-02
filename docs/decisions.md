# Decisions

Each choice below is the one the docs and the first build follow.

## Nested boards, plus an All view

A Goal is a board of Initiatives, an Initiative is a board of Epics, an Epic is a board of Tasks, and a Task is a board of Sub-tasks. Home is the board of Goals.

The All view shows the same cards again. Columns stay the five statuses. Swimlanes follow the tree, so a parent swimlane contains the next child level. Sub-tasks are cards inside the Task swimlane.

Creating, editing, and reordering stay on the nested board. The All view is for seeing the tree and changing status. A drop onto a different parent is refused. The first version does not re-parent a card.

Collapsed swimlanes are remembered in the browser. The server does not store that preference.

## Fixed columns, including Blocked

The columns are Backlog, Ready, In progress, Blocked, and Done. They are the same on every nested board and on the All view. There is no column editor.

Blocked is a real status. A blocked card is not In progress with a flag. The happy path reads left to right and ends at Done. Blocked sits next to In progress because that is the column work leaves when it stops, and the column it returns to.

Status values are `backlog`, `ready`, `in_progress`, `blocked`, and `done`.

## Priority 0 through 4

Every card has a priority. The scale is fixed.

| Value | Name |
| --- | --- |
| 0 | Urgent |
| 1 | High |
| 2 | Normal |
| 3 | Low |
| 4 | Lowest |

0 is the most urgent. 4 is the lowest. New cards start at Normal (2). The field is required.

On a nested board, drag order inside a column stays put when priority changes. The badge shows the priority. People move a card by dragging it.

On the All view, sibling swimlanes sort by priority, urgent first, then by title. A swimlane spans every column, and a card's drag rank lives inside one column, so that rank cannot order siblings that sit in different columns. Priority is the order that works across the row.

## A few accounts on each container

Sign-in is email and password. The first visit creates the admin when the database has no users. The admin types the email and password of each additional person. There is no mail sender and no SSO.

Roles are admin and member. Passwords are hashed with Node's built-in scrypt. The sign-in cookie is httpOnly and holds a random token. The database stores a hash of that token mixed with `SESSION_SECRET`. Forms post a CSRF token stored on the session.

## One Node process

The app is Node 22 and TypeScript. One process renders the HTML and accepts the form posts. A small page script handles drag-and-drop and swimlane collapse. SQLite is the built-in `node:sqlite` module, so the image does not compile a database driver. The database file is on a volume. WAL mode is on.

The repository has no React app, no second frontend build, and no second service.

## One container per client

The app serves one client. It does not look at the hostname to choose a tenant. The proxy on the shared host does that. `PUBLIC_BASE_URL` is the origin used in links. `SESSION_SECRET` is required. `DATA_PATH` is the SQLite file.

This repository ships the app image and the hosting doc. Adding a client is a container, a volume, and a proxy site, done by hand. A subdomain and a custom domain are the same kind of site entry. The repository has no provisioner and no billing.

Local runs use Apple's `container` CLI. The Dockerfile is also the OCI image a shared host runs. See `docs/local.md` and `docs/hosting.md`.

## Plain text, and deletes that stop at children

Descriptions and comments are plain text. The page escapes HTML.

Deleting a card that still has children is refused. Deleting a person who still has comments is refused. Deleting the last admin is refused. Deleting a label removes it from cards. Deleting a person clears their assignee field on cards.
