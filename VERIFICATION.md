# v0.2.0 verification

## 0.2.3 sign-in startup and security update — 2026-11-05

- Electron upgraded from 41.10.7 (end of life) to 45.2.3, and non-breaking `npm audit fix` updates applied. `npm audit --omit=dev` still reports zod 3 (memory use while validating oversized collections). Every zod 3 version is affected, and the fix needs the zod 4 API. Zod only validates data from Chromatic's own windows, its settings file and registered profile IDs.
- All 71 unit tests and the production build pass. New tests cover parallel PIN attempts (this test fails on 0.2.2) and requiring the proxy password again after the address changes.
- Every Electron smoke suite passes on Electron 45 against the development build: manager, feature, performance, launch-browser, browser (Chrome and Edge) and fork-browser (Chrome and Edge). The manager, feature and launch-browser suites also pass against the packaged executable.
- Before the repository was made public, its full git history was checked for credentials and personal data. The only key-like content is the documented self-signed localhost test fixture.
- Development builds and smoke runs add no Windows startup entry. Only the installed app registers it.

## 0.2.2 performance update — 2026-10-26

Measured on the same Windows 10 machine, before and after, with disposable data:

| Area | 0.2.1 | 0.2.2 |
| --- | --- | --- |
| Launch: in-use check before spawning | 2.1–2.7 s process query | 7–17 ms end to end (lockfile) |
| Cold start to first window | 2.9 s | 0.57–0.64 s |
| 1,000 rows visible after start | 3.7 s | 0.87 s |
| Fork, 2,400 files, with live browser checks | 43.3 s | 2.1 s |
| Storage scan, 4,200 files | 2.7 s | 0.39 s |
| Cache preview / cleanup, 1,800 files | 2.8 s / 14.6 s | 0.40 s / 0.56 s |
| Manager checkbox, menu, keystroke (1,000 profiles) | 83–217 ms | next frame (33 ms floor, 2 frames) |
| First quick launcher open | 446 ms | 55–124 ms |
| Snapshot transfer (1,000 profiles) | 15 ms structured copy | ~4 ms JSON text including parsing |
| Manager DOM nodes / renderer memory | 25,000 / 303 MB | 2,800 / 127 MB |

- All 70 unit tests and the production build pass. New tests cover junctions anywhere on a path, the background closure monitor and its final check, cleanup stopping when a browser starts, exact parallel copies and size totals, cached save validation, structural sharing, bounded concurrency, tasklist and registry parsing (including localized output), and the lockfile probe.
- The manager, feature, and performance Electron suites pass against the development build. Manager, feature, and launch-browser suites pass against the packaged executable.
- The new `scripts/launch-browser-smoke.cjs` starts a real headless Chrome through Chromatic with a disposable profile. It confirmed first launch (13 ms), relaunch of a running folder (9 ms), refusal of changed settings while running (3 ms), the process-query fallback shortly after a launch (1.8 s), and a lockfile-only launch afterwards (7 ms). Edge and Brave were separately confirmed to hold the lock while running and release it on exit; Brave took ~550 ms to create it, which the fallback covers.
- `scripts/fork-browser-smoke.cjs` passed for real Chrome and Edge with the parallel copy.
- The 0.2.2 NSIS installer was built and installed silently over the existing 0.2.1 per-user installation on this machine. Settings were byte-identical before and after.

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
