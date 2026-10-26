# Chromatic 0.2.2

- Browsers start about 2 seconds sooner. Chromatic now checks whether a profile's data folder is in use from the lock Chromium holds while running (about 1 ms) instead of querying Windows processes before every launch. Right after Chromatic starts a browser for the same folder, or if the lock can't be read, it still uses the process query.
- The app opens about 2 seconds sooner: the default-browser lookup uses the registry directly and finishes in the background.
- Forks are up to 20 times faster. Closure checks no longer pause copying, files copy in parallel, and safety checks for linked folders are much cheaper. The browser is confirmed closed before copying, checked continuously while copying, and checked again before the fork is published.
- Cache preview and cleanup are about 7 and 25 times faster. Storage scans are about 7 times faster.
- The manager and quick launcher stay responsive with large libraries. Long lists render in pages as you scroll, rows update individually, and progress updates no longer resend every profile. With 1,000 profiles, selection, menus, and search now update within a frame, and the manager uses less than half the memory.
- The quick launcher is prepared at startup, so the first shortcut press opens it immediately. It resets when hidden, and resting the mouse over the list no longer moves the keyboard selection.
- Saving re-validates only changed profiles.

## Install

Download `Chromatic.Setup.0.2.2.exe` and optionally verify it against `SHA256SUMS.txt`. Install over the existing version; settings, profile references, and browser data remain in place.

The build is unsigned and has no automatic updater. Keep Chromatic running while using its proxy forwarding. See `VERIFICATION.md` for test results and limitations.
