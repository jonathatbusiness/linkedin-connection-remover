# LinkedIn Connection Remover

An experimental Google Chrome extension that processes a list of names and automates the visible removal flow on LinkedIn's connections page: search for a person, open the actions menu, select the removal option, and confirm.

> **Warning:** removing a connection is a real and potentially irreversible action. Review your list carefully before starting. LinkedIn may change its interface at any time, which can break the automation. Automated activity may also be subject to LinkedIn's terms and platform limits. Use this extension at your own risk and at a moderate pace.

## Features

- Accepts one name per line and automatically removes blank and duplicate entries.
- Requires explicit confirmation before processing the queue.
- Provides color-coded **Run**, **Pause**, and **Stop** controls.
- Processes names sequentially with short randomized intervals and waits for the interface when necessary.
- Uses exact name matching while ignoring letter case, repeated spaces, and accents.
- Prevents removal when a result is missing or ambiguous.
- Verifies the person's name again before the final confirmation.
- Displays an individual success or error result for each name.
- Stores the queue and its progress in `chrome.storage.local`.
- Lets you show or hide the panel by clicking the extension icon.

## Install locally

1. Open `chrome://extensions` in Google Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.
5. Open `https://www.linkedin.com/mynetwork/invite-connect/connections/`.
6. Click the extension icon to show or hide the panel. Reloading the LinkedIn page after updating the extension is still recommended, although the extension can also inject itself on demand.

## Usage

1. Open LinkedIn's connections page.
2. Paste the names into the panel, one per line.
3. Click **Run** and confirm the displayed number of names.
4. Click **Pause** to pause before the next step, then click **Run** to resume.
5. Click **Stop** to prevent further removals. If a LinkedIn confirmation dialog is open, the extension attempts to cancel it.

The name displayed on the connection card must exactly match the provided name. If no card or more than one card matches, the extension skips that entry without removing anyone.

For initial testing, use a single connection that you have deliberately chosen to remove. Do not begin with a large list.

## Project structure

- `manifest.json`: Manifest V3 extension configuration.
- `background.js`: shows or hides the panel and injects it when necessary.
- `content.js`: user interface, queue, validation, and automation logic.
- `content.css`: panel and dialog styles using the `lcr` prefix.

## Selectors

The implementation avoids LinkedIn's generated CSS classes. It prioritizes semantic attributes observed in the current interface:

- Search field: `data-testid="typeahead-input"`, scoped to the connections search component.
- Connection card: `componentkey` starting with `ConnectionCard_`.
- Profile: a link containing `/in/`.
- Actions button: an `aria-label` starting with `More actions for`.
- Actions menu: `role="menu"` and `role="menuitem"`.
- Confirmation dialog: `role="dialog"` or `role="alertdialog"`, additionally verified by the presence of a removal button.

Removal and cancellation controls are recognized in both English and Portuguese.

## Known limitations

- LinkedIn may change its page structure without notice.
- The connections page must remain open while the queue is running.
- Closing or reloading the tab interrupts the process. The queue remains saved as paused, but the user must deliberately restart it.
- Profile URL matching is not available in this version.
- CSV report export is not available yet.
- Names alone may not uniquely identify a person. Ambiguous exact matches are skipped.

## Connect the repository to GitHub

Run the following commands in Git Bash from this project folder:

```bash
git init
git add .
git commit -m "feat: initial Chrome extension"
git branch -M main
git remote add origin https://github.com/jonathatbusiness/linkedin-connection-remover.git
git push -u origin main
```

If the remote repository already contains a README, license, or any commit created through GitHub, synchronize it before the first push:

```bash
git pull origin main --allow-unrelated-histories
git push -u origin main
```

## Development

After changing the files:

1. Open `chrome://extensions`.
2. Find **LinkedIn Connection Remover**.
3. Click **Reload**.
4. Reload the LinkedIn connections page.

## Privacy

The extension does not use a separate server and does not send the submitted list to its developer or another external service. Names and queue progress are stored locally by Chrome. Searches and removal actions naturally interact with the LinkedIn account currently open in the browser.

## License

No license has been selected for this initial version. Add a license before public distribution if you intend to explicitly allow reuse or modification of the source code.
