# Chromatic
<!-- impeccable:product-schema 1 -->
## Platform
web

Windows desktop application using Electron, with web-rendered UI.
## Stack
Delegated: Electron, TypeScript, React, Vite. Windows x64 per-user installer.
## Users
People switching between many isolated or existing browser profiles, including discreet profiles.
## Product Purpose
Find and launch the right browser identity quickly while retaining its persistent data.
## Capabilities and Constraints
Hotkey launcher; Chromium-only profile manager; settings-only Duplicate and persistent-data Fork; multiple labels and grouping; protected authenticated proxies with manual tests; storage overview and manual cache-only slimming; local .chromatic references; four-digit PIN gate for hidden profiles. Slimming preserves persistent browser data. Upgrade migration preserves version-1 settings and archives Firefox registrations without touching their data. No userscripts, dedicated browser distribution, workspaces, backup/restore, cloud sync, scheduled cleanup, or cross-platform packaging.
## Product Principles
Keyboard first. Persistent browser identity. Discretion across every app entry point. Fail closed for destructive filesystem operations. Never promise indefinite website sessions.
