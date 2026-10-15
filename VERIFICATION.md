# v0.2.0 verification

## 0.2.1 launcher responsiveness update — 2026-10-15

- All 50 unit tests and the production build pass. The manager and feature Electron smoke suites pass with the new launch recovery UI.
- `npm run test:performance` uses 1,000 disposable profiles, delayed process queries, and simulated browser outcomes. It checks immediate dismissal, repeated Enter, reopening during launch, keyboard/search/Escape, background failure recovery, proxy bridge disposal, missing storage, cleanup/fork exclusion, queued private-launch cancellation across lock/unlock, and distinct persistence failures.
- Launcher dismissal measured 5.7–7.9 ms with a simulated 1,500 ms process check. Search and keyboard selection were visible in approximately 52–67 ms, including automation overhead. These measure UI response, not browser window readiness.
- Before the change, the real unfiltered process query took 1.71–1.76 seconds; the handler additionally waited up to 900 ms after spawning. Filtered queries still take roughly 1.5–1.6 seconds on this machine, but no longer delay launcher dismissal. Completed process results are not cached.
- A 200-file fork generated 10 manager notifications and one launcher notification, instead of broadcasting after every file. Grouping 1,000 profiles across 110 labels measured 11.2 ms before and 0.9 ms after, with identical results; launcher mode skips grouping entirely.
- A real disposable Node process confirmed spawn acceptance in 7 ms and asynchronous reporting of an early nonzero exit. Browser safety checks and existing proxy configuration rules remain in place. The 0.2.1 NSIS installer was built, and both existing Electron smoke suites passed against the packaged executable using disposable profiles.

Validated on Windows 10 x64 with Node.js 22.17.1 and Electron 41.10.7.

## Automated checks

- 38 Vitest tests passed, covering migration and its exact backup, label normalization, protected proxy handling, duplicate/fork independence, persistent-data preservation, cache exclusion, cancellation, changing source files, junction rejection, running-browser and disk-space refusal, storage accounting, and existing cleanup/PIN/reference-file safeguards.
- Proxy fixtures verified HTTP and trusted HTTPS authentication, rejection of untrusted TLS certificates, SOCKS5 username/password with remote hostname resolution, incorrect credentials without direct fallback, and cancellation of stalled connections.
- Both Electron smoke suites passed against development builds and the packaged Windows executable. They exercised profile CRUD/search, hidden-access enforcement, reference-file launching, keyboard navigation, labels/grouping/bulk edits, Duplicate/Fork, storage, protected proxy fields, launch recovery, and light/dark/compact layouts.
- Actual installed Chrome and Edge used disposable profiles to verify cookies and localStorage survived a fork and changes in the fork did not alter the source.
- A live HTTPS public-IP test through an authenticated local proxy fixture passed; incorrect credentials failed without direct fallback.
- TypeScript, production build, and NSIS installer packaging passed. npm audit reported zero known vulnerabilities at verification time.

## Visual review

The bounded Impeccable finish review resolved all five areas: primary launch/search hierarchy, Duplicate/Fork clarity, non-obstructing progress and feedback, practical labels/storage, and light/dark/compact layouts. Success feedback appears in the existing header, and compact rows retain the matching label. Review used source and screenshots; it was not an independent screen-reader session.

## Installation and limits

The v0.2.0 packaged executable passed both smoke suites. The new installer was built but was not installed over the user's existing v0.1.0 installation. The earlier v0.1.0 installation/uninstallation checks do not constitute a v0.2.0 installer test.

The release is unsigned. No automatic updater, cloud sync, Firefox, userscripts, or bundled browser is included. Browser checks used disposable isolated profiles; no real user browser data was changed. Forking preserves persistent files on the same Windows account but cannot guarantee that every website will retain a login. Storage totals exclude shared subdirectories outside the selected profile. Cleanup conservatively requires processes with the relevant browser executable name to be closed. The app PIN gates access and does not encrypt browser folders. Proxy forwarding requires Chromatic to remain running.

## Reproduction

Run npm test and npm run build, then node scripts/smoke.cjs and node scripts/features-smoke.cjs. Browser and network checks are node scripts/fork-browser-smoke.cjs and node scripts/proxy-live-smoke.cjs. After npm run package, set CHROMATIC_SMOKE_EXE to release/win-unpacked/Chromatic.exe and rerun both smoke suites. Test screenshots and disposable data are ignored local artifacts.
