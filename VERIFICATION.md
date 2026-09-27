# v0.1.0 verification

Validated on Windows 10 x64 with Node.js 22.17.1 and Electron 41.10.7.

## Automated checks

- 25 Vitest tests passed: browser argument generation and reserved argument rejection; Firefox metadata/proxies; reference-file validation; hidden filtering; search over 1,000 synthetic profiles; cache-only deletion with persistent-file byte comparisons; separate Firefox cache root; running-state refusal; changed-file skipping; junction rejection; expired previews; PIN format, persistent throttling, expiry, and change requirements; corrupt settings preservation.
- Electron smoke tests passed against both the development app and installed executable: profile creation and search, PIN setup and unlock, hidden launch blocking, editor and cache preview, neutral hidden export filenames, exported-file Edit unlocking, quick-launcher exclusion while unlocked, modal Ctrl+K focus containment, and keyboard navigation through an overflowing result list.
- Actual installed Chrome, Edge, and Firefox launched disposable isolated profiles with the adapters' generated arguments and loaded a local test page. Existing user profiles were not launched, changed, or cleaned.
- NSIS per-user installation succeeded. Registry Open/Edit commands were verified. Uninstall succeeded and removed the custom file association and verbs.
- TypeScript and production build passed. npm audit reported zero known vulnerabilities at verification time.

## Visual review

The bounded Impeccable finish review passed for light, dark, compact manager, side editor, quick launcher, and cache preview screenshots. The initial focus/selection issues were fixed; active results now scroll into view and expose selection semantics. The reviewer performed static source and image inspection, not an independent screen-reader session.

## Limits

The release is unsigned. No automatic updater, cloud sync, legacy migration, or other operating-system packages are included. Installed-browser checks used disposable profiles and headless browser launches; every third-party browser variant and extension ecosystem has not been tested. Cleanup deliberately requires all processes with the relevant browser executable name to be closed. The four-digit PIN gates app access and does not encrypt browser data or prevent direct filesystem access. No manual test used real cookies or private browsing data.

Reproduce with `npm test`, `npm run test:smoke`, and `node scripts/browser-smoke.cjs` after building. The last command skips browser executables not found at its documented standard Windows locations. Smoke screenshots and disposable profile folders are local test artifacts, not bundled example data.
