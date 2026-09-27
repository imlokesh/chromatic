# v0.2.0 verification

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
