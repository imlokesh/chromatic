# Chromatic 0.2.0

- **Duplicate** copies settings into a fresh browser profile; **Fork** also copies persistent browser data, excluding disposable caches. Forks show progress and support cancellation.
- **Labels** replace tags, with filters, grouping, autocomplete, and bulk editing. Profiles in multiple groups are counted once for batch actions.
- **Storage** shows total profile size and disposable-cache estimates, with a separate cleanup review.
- **Proxies** support HTTP/HTTPS Basic authentication and SOCKS5 credentials, Windows-protected passwords, and manual public-IP tests. Keep Chromatic running in the tray for proxy connections.
- **Launch recovery** explains missing browser executables, unavailable folders, and restarts needed for changed settings.
- **Chromium-only:** Chrome, Edge, Brave, Chromium, and custom Chromium executables. Upgrades preserve the old configuration and archive Firefox registrations without deleting browser data.
- Improved compact layouts, keyboard menus, progress feedback, dark theme, and discreet-profile checks.

## Install

Download `Chromatic.Setup.0.2.0.exe` and optionally verify it against `SHA256SUMS.txt`. Repository access is required. Install over 0.1.0 to upgrade; profile references and browser data remain in place.

Fork with the source browser closed. Browser encryption and website session rules can require signing in again after a successful copy. Slimming preserves persistent data but does not guarantee indefinite sessions. Browser proxies are not a system VPN.

The build is unsigned. Automatic updates and userscripts are not included. The PIN controls access through Chromatic, not direct filesystem access. See `VERIFICATION.md` for validation details.
