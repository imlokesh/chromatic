# Chromatic 0.2.1

- Quick launcher dismisses immediately while browser checks and startup continue in the background.
- Launch failures open the manager with recovery actions. Repeated launch requests are deduplicated, and launches sharing a browser data folder are serialized.
- Removed the blocking 900 ms post-spawn wait while retaining background detection of early browser failures.
- Reduced copy/storage progress refreshes and avoided unnecessary label grouping in the launcher. Improved grouping performance in large libraries.
- Preserved cleanup/fork safety checks and cancellation of queued discreet-profile launches when locking.
- Added regression coverage for responsiveness, launch recovery, proxy cleanup, and large profile collections.

## Install

Download `Chromatic.Setup.0.2.1.exe` and optionally verify it against `SHA256SUMS.txt`. Install over the existing version; settings, profile references, and browser data remain in place.

The build is unsigned and has no automatic updater. Keep Chromatic running while using its proxy forwarding. See `VERIFICATION.md` for test results and limitations.
