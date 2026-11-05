# Chromatic 0.2.3

- Chromatic now starts minimized to the tray when you sign in to Windows, and this is on by default for new installs. Existing installs keep their saved choice. The Windows startup entry is re-registered every time Chromatic starts, so it can no longer go missing after an update. Before, it was only written when preferences were saved.
- Updated to Electron 45. Electron 41 no longer receives security fixes.
- PIN attempts are now checked one at a time. Before, several attempts made at once could all run before the lockout started.
- Developer tools are turned off in the installed app.
- If you change a proxy's protocol, host or port, Chromatic now asks for its password again. Before, the saved password was sent to the new address.

## Install

Download `Chromatic.Setup.0.2.3.exe` and optionally verify it against `SHA256SUMS.txt`. Install over the existing version; settings, profile references, and browser data remain in place.

The build is unsigned and has no automatic updater. Keep Chromatic running while using its proxy forwarding. See `VERIFICATION.md` for test results and limitations.
