# Product

GOST is a small Kanban app for one client. One running container is one client. People on that client share one board tree.

Work has five levels. A Goal contains Initiatives. An Initiative contains Epics. An Epic contains Tasks. A Task contains Sub-tasks. A Sub-task contains nothing.

There are two ways to see the work. Nested boards drill into one parent. The All view shows the whole tree at once.

## Nested boards

The home page is a board of Goals. Opening a card shows a summary of that card, then the board of its children. Edit is a separate page for the fields, the comments, and delete.

| Page | What the columns hold |
| --- | --- |
| Home | Goals |
| Goal | Initiatives |
| Initiative | Epics |
| Epic | Tasks |
| Task | Sub-tasks |
| Sub-task | No child board. A summary, and an edit page for the note and comments. |

A breadcrumb walks back up the chain. Each card shows how many children it has. A card's column is its own status. That status is separate from how its children are arranged.

New cards are created on the parent's board. The type is implied by the page you are on. A card stays under the parent it was created on.

## Columns

Every board, including the All view, uses the same columns, left to right:

1. Backlog
2. Ready
3. In progress
4. Blocked
5. Done

Nobody adds, removes, or renames a column. Blocked means work on that card has stopped. It is a status of its own. A card leaves In progress for Blocked, and it leaves Blocked for In progress or Done.

Dragging a card moves it within a column or to another column. A status control on the card does the same move without dragging.

## All view

The All view is a second board of every card in the container. The columns are the five statuses above. The rows are swimlanes, and each swimlane contains the next child level.

- Each Goal is a swimlane. Its card sits in the column of the Goal's status. Inside it are that Goal's Initiatives.
- Each Initiative is a swimlane inside its Goal, with its Epics inside it.
- Each Epic is a swimlane inside its Initiative, with its Tasks inside it.
- Each Task is a swimlane inside its Epic. Sub-tasks are cards in that Task's columns. A Sub-task has no swimlane of its own.
- Sibling swimlanes are ordered by priority, urgent first, then by title.
- Sub-tasks inside one column stay in the manual order from the Task board.
- A swimlane can be collapsed. The collapsed state stays in the browser.
- An empty parent still shows its swimlane.

Dragging on the All view changes status only among cards that share a parent. A drop onto a different parent is refused. Creating a card and reordering siblings happen on the nested board. The card title opens that page. Fields and comments are on the card's edit page.

Home and every nested board link to the All view.

## Card

A card has:

- Title
- Priority, from 0 through 4. 0 is Urgent. 4 is Lowest. New cards start at 2, Normal.
- Description, plain text. Line breaks are kept. HTML is escaped.
- Due date, an optional calendar date. A date before today is marked late while the card is not Done. A Blocked card can be late.
- One assignee, optional, chosen from people on this container
- Labels, optional. A label has a name and a color from a fixed palette.
- Comments. Each comment stores the author and the time. The author can delete their own comment. An admin can delete any comment.
- Status, one of the five columns
- Parent, except a Goal

Priority is shown on the card. On a nested board, the order inside a column is the manual drag order. Priority does not reshuffle that order.

## People

Each container has its own accounts. A person signs in with email and password.

The first visit, when there are no accounts yet, creates the admin. The admin adds other people from a settings page by typing an email and a password. The app does not send email. There is no SSO.

An admin adds and removes people. A member uses the boards. Anyone signed in can change their own password. Anyone signed in can add a label. An admin can delete a label.

Removing a person is refused when that person still has comments, and when they are the last admin.

## Later

These are out of the first version:

- Moving a card to another parent
- Markdown descriptions
- File attachments
- Notifications, SSO, and outbound mail
- A control plane that creates containers for clients
- A phone app
