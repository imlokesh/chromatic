# Chromatic 0.1.0

First private Windows release, built from scratch.

- Search and launch browser profiles from a configurable global-hotkey popup.
- Create isolated profiles or discover existing Chrome, Edge, Brave, Chromium, and Firefox profiles.
- Organize with favorites, tags, startup URLs, and browser-specific settings.
- Export `.chromatic` local profile references with Explorer Open and Edit profile actions.
- Keep discreet profiles out of the launcher and require a four-digit PIN for app access.
- Preview and remove disposable cache files while preserving cookies, logins, sessions, and website data.
- Original Chromatic SVG/Windows icon; system, light, and dark themes.

## Download

Download **Chromatic Setup 0.1.0.exe** below and run the per-user installer. The `.blockmap` is release metadata; it isn't required for manual installation. `SHA256SUMS.txt` provides integrity checks.

This initial release is unsigned, so Windows may display an unknown-publisher prompt. Releases and binaries are private and require repository access. Automatic updates are not configured.

## Validation

25 automated core tests passed, along with development and installed-app smoke tests, isolated launch checks for Chrome/Edge/Firefox, and install/uninstall file-association checks. The dependency audit reported zero known vulnerabilities. See `VERIFICATION.md` for scope and limits.

The PIN is an app access gate, not encryption. Slimming never deletes persistent site data, but websites and browsers can still expire sessions independently.
