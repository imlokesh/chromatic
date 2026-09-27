# Chromatic

A Windows browser-profile launcher built from scratch with Electron, TypeScript, and React.

![Chromatic icon](assets/icon.svg)

## Install

Download **Chromatic Setup 0.1.0.exe** from this repository's Releases page. The repository and its binaries are private; sign in with an account that has access. Run the per-user installer. It registers `.chromatic` profile files and their **Open** and **Edit profile** Explorer actions. On Windows 11, Edit profile may be under **Show more options**.

This initial build is unsigned. Windows may show its publisher as unknown. There are no automatic updates; install a later release over the existing version. Uninstalling keeps profile data and app settings.

## Everyday use

- Press **Ctrl+Alt+Space** to open the search launcher. Type a name, tag, or browser, use the arrow keys, and press Enter. Use the tray icon if the shortcut conflicts with another application.
- Create an isolated profile, or use **Find existing** to register profiles already in your browsers. Manual folders are available under the editor's browser/storage options. Chromium expects the **User Data root** and a profile subfolder, such as `Default` or `Profile 1`.
- Your system default browser is preselected for new profiles when supported. Existing profiles retain their original browser. Add nonstandard executable locations in **Browsers**.
- Right-click a profile to edit, favorite, hide, export, or slim it. Exported `.chromatic` files contain a local ID, not browser data. They keep working after edits and renames, but aren't portable backups.
- Set a four-digit PIN in **Settings** before hiding profiles. Hidden profiles never appear in the launcher. Reveal them explicitly in the manager; relocking clears the revealed state. Their exported files also require unlocking.
- **Slim profile** previews eligible cache files. Close the relevant browser, review the preview, then clear cache. Multi-select profiles for batch export or slimming.

## Data and privacy

Settings live at `%LOCALAPPDATA%\Chromatic\settings.json`. New managed browser profiles live under `%LOCALAPPDATA%\Chromatic\Profiles\<UUID>` unless another empty folder is chosen. Existing browser profiles remain in place.

Slimming removes only verified Chromium disk/code/GPU caches or Firefox HTTP/startup caches. Cookies, credentials, key material, sessions, bookmarks, history, extensions, preferences, local storage, IndexedDB, service workers, and offline site data are preserved. It does not compact databases or promise better browsing speed: caches rebuild and first loads may be slower. Websites and browsers can still expire their own sessions.

Cleanup is intentionally conservative: it skips uncertain running states, junctions/symlinks, changed files, locked files, and unknown layouts. All processes using the relevant browser executable must be closed for cleanup, including its background mode. No automatic cleanup or recursive profile deletion is implemented.

The PIN gates access **inside Chromatic**. Its salted verifier is protected by Windows DPAPI, with persistent retry delays. It does not encrypt profile names, paths, or browser data or stop someone using the same Windows account from accessing files or launching the browser directly. There is no PIN recovery. Back up browser data with the browser closed if you need disaster recovery.

Removing a profile registration never deletes its browser data. Changing browser family requires a separate profile; Chromium and Firefox data formats aren't interchangeable.

## Browser capabilities

| Capability | Chromium family | Firefox |
| --- | --- | --- |
| Discover existing profiles | Chrome, Edge, Brave, Chromium standard installations | Standard `profiles.ini` installations |
| Manual executable/profile folders | Yes | Yes |
| Isolated profiles and startup URLs | Yes | Yes |
| Proxy configuration | Browser launch argument | Managed profile `user.js`; existing profiles use browser settings |
| Unpacked extension launch flag | Generic detected Chromium only | No; use Firefox's add-on manager |
| Repeated launches | Browser handles routing | An already-running isolated profile must be closed first |

Browser versions and extension restrictions differ. Chrome-branded builds no longer support the unpacked extension launch flag; use their extension manager. Custom arguments are one argument per line; profile-routing, proxy, remote-debugging, and extension flags are reserved.

## Development

Requires Windows x64, Node.js 22+, npm, and Git.

```powershell
npm ci
npm run dev:app
npm test
npm run test:smoke
npm run package
```

`npm run dev` serves the renderer only; desktop features require Electron. `npm run dev:app` builds and launches Electron. The installer is written to `release/`. Smoke tests use disposable data under Windows Temp and leave screenshots in `artifacts/`; they never clean real browser profiles. The smoke test hotkey is Ctrl+Alt+F11.

Architecture: `electron/` owns Windows integration, validated IPC, persistence, browser adapters, PIN enforcement, and cache cleanup. `shared/` contains serializable types and search logic. `src/` contains the sandboxed React renderer. The app loads only packaged local content, with no renderer Node access or unrestricted shell IPC.

## Release process

Save changes in Git, run unit and Electron smoke tests, then package the Windows installer. Publish a private GitHub release containing the installer, its `.blockmap`, and `SHA256SUMS.txt`. The Windows workflow can also build and retain an installer artifact on demand. Code signing and automatic updates are intentionally not configured for this first release.

The SVG icon in `assets/icon.svg` was authored for this project. Its Windows ICO and tray PNG are derived assets, not downloaded branding.
