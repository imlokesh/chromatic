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
Hotkey launcher; profile manager; Chromium and Firefox adapters; local .chromatic references; four-digit PIN gate for hidden profiles; manual cache-only slimming. Browser data must never be deleted by slimming. No legacy import, cloud sync, scheduled cleanup, or cross-platform packaging in v1.
## Product Principles
Keyboard first. Persistent browser identity. Discretion across every app entry point. Fail closed for destructive filesystem operations. Never promise indefinite website sessions.
