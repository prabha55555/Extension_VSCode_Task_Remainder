# Desk Buddy

A 3D character that lives inside VS Code and reminds you to drink water and finish your tasks.

- **A visitor on your desktop.** By default (`deskBuddy.display` = `overlay`) nothing opens in VS Code: the character flies in from the left edge of your screen in its own transparent window, says its message, and leaves when you answer. This needs an Electron runtime (`electron.exe`): the extension finds one in your workspace's `node_modules` or a global npm install, or you set `deskBuddy.overlayElectronPath`. Without one it asks once, then falls back to the side bar (`deskBuddy.display` = `sidebar`). Reminders are only delivered while VS Code is the focused window.
- **5 built-in 3D characters** (Bolt, Mochi, Astro, Waddle, Bloop). Drag to spin, click to make them hop; they look at your mouse and wave when a reminder is showing.
- **Upload your own**: a `.glb` 3D model (animated ones play their idle clip), a transparent PNG (3D standee) or a normal photo (floating photo card).
- **Tasks**: time, repeat (every day / weekdays / weekends / one time) and a character per task, so each task can be announced by a different character or photo.
- **Water reminders** every N minutes. *Yes* restarts the timer, *Remind me later* snoozes.
- If the view can't open, a normal VS Code notification with the same buttons is used.

## Settings
`deskBuddy.display`, `deskBuddy.overlayElectronPath`, `deskBuddy.closeAfterAnswer`, `deskBuddy.userName`, `deskBuddy.waterEveryMinutes` (0 = off), `deskBuddy.snoozeMinutes`, `deskBuddy.autoReveal`, `deskBuddy.sound`.

## Develop
```
npm install
npm run build      # bundles webview/ into media/ with esbuild
npm test           # scheduler unit tests
npm run package    # builds desk-buddy-<version>.vsix
```
Open the folder in VS Code and press F5 to launch an Extension Development Host. `dev/preview.html` shows the webview in a plain browser with a mocked VS Code API (serve the folder over http).

## Notes
- Tasks, uploaded characters and settings are stored per user (not per workspace); uploaded files are copied into the extension's global storage.
- `.glb` must be self-contained and not Draco/meshopt-compressed. Export `.gltf` as `.glb`.
- A task fires up to 10 minutes late if VS Code was closed or asleep at its time, and at most once per day.
