# History & cookies

## History

Every request you send is recorded in the **History** sidebar, grouped by day. Entries hold the resolved request, the response (up to 256 KB of body) and test results.

- Filter by URL with the search box.
- Click an entry to view the response again.
- **Open as new request** turns an entry into an editable draft.
- The trash icon clears your own history in the current workspace.

History is private to you. The admin sets how many days it is kept (30 by default).

## Cookies

Cookies set by responses are stored in a **cookie jar** that belongs to you and the current workspace. They are sent automatically to matching domains and paths, as a browser would.

- View or delete them under **Environments → Cookie jar**.
- To stop sending cookies on one request, turn off **Send cookies** on its **Settings** tab.
- Scripts can read cookies with `pm.cookies.get(name)`.
