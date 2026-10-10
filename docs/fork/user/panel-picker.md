# Panel picker

The panel picker opens any right panel from one searchable list. It appears when the
right panel has no tabs, and when you click **+** in the panel's tab bar. Each row shows
the panel's name, a one-line description and the letter that opens it. Panels you used
recently are listed first. Panels that cannot open yet are listed last with the reason.

To open a panel, press its letter while the empty panel is showing, or type to search and
press Enter. In the empty panel, press `/` or any key that is not a panel letter to start
searching. In the **+** popover the search field is focused, so typing always searches; a
single letter that matches a panel's letter puts that panel first. Up and Down move the
selection. Escape clears the search, and a second Escape closes the popover.

When you have more than one browser profile, select **Browser** and press Right, or click
its arrow, to list the profiles. Searching for a profile name also finds it.

## Opening the picker from anywhere

Press `Cmd+Shift+'` on macOS or `Ctrl+Shift+'` on Windows and Linux in any thread. Loom
shows the thread's right panel and focuses the picker. The command palette offers
**Open panel picker** too. To use a different key, open **Settings > Keybindings** and bind
**Loom: Panel Picker: Open**. A key you bind yourself always takes precedence over the
default.

## Settings

**Settings > Loom > Panel picker** has two switches, both on by default:

- **Use the compact panel picker.** Off restores the standard list and **+** menu.
- **`mod+shift+'` opens the panel picker.** Off leaves that key alone. A binding you set in
  Keybindings keeps working.

These are stored in this browser or desktop app, not on the server, so each device keeps
its own choice and its own recent panels. The picker works on web and desktop with any
server, including upstream T3 servers.
