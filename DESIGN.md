---
name: Chromatic
description: A compact Windows utility for persistent browser identities.
colors:
  canvas: "light-dark(#f8f7f4,#1e1e25)"
  surface: "light-dark(#ffffff,#282830)"
  rail: "light-dark(#f0efeb,#222229)"
  ink: "light-dark(#292933,#efedf5)"
  muted: "light-dark(#72717b,#aaa7b8)"
  line: "light-dark(#e4e2df,#3b3945)"
  accent: "light-dark(#6853aa,#c4b3ff)"
  accent-hover: "light-dark(#58458f,#d2c6ff)"
  accent-soft: "light-dark(#e8e2f3,#393147)"
  on-accent: "light-dark(#ffffff,#241b3b)"
  hover: "light-dark(#eae8e4,#36333f)"
  row-hover: "light-dark(#f2f0ed,#25252e)"
  tag: "light-dark(#eeece8,#323039)"
  gold: "light-dark(#a07929,#ddbc76)"
  green: "light-dark(#48715b,#a2c9af)"
  green-bg: "light-dark(#edf3ed,#29392f)"
  orange: "light-dark(#b56732,#db9b60)"
  error: "light-dark(#a33e42,#efa4a6)"
  error-bg: "light-dark(#f9eaea,#422d32)"
typography:
  headline:
    fontFamily: "Segoe UI, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.035em"
  title:
    fontFamily: "Segoe UI, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-.02em"
  section:
    fontFamily: "Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  tag: "4px"
  compact-control: "6px"
  field: "7px"
  search: "8px"
  avatar: "11px"
  dialog: "14px"
spacing:
  compact: "8px"
  control: "10px"
  group: "16px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.field}"
    padding: "10px 15px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 15px"
  button-text:
    textColor: "{colors.accent}"
    padding: "7px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
  navigation-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.field}"
    padding: "11px 14px"
  tag:
    backgroundColor: "{colors.tag}"
    textColor: "{colors.muted}"
    rounded: "{rounded.tag}"
    padding: "3px 8px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    width: "430px"
---

# Design System: Chromatic

## Overview

**Creative North Star: "A compact Windows utility"**

Chromatic is a Windows Electron application with a React-rendered interface. Its established direction is quiet and practical: warm neutral surfaces, ink typography, restrained violet selection, and Segoe UI. Density supports finding and launching a browser identity quickly. The manager and hotkey popup share identity cues and controls.

The library uses aligned rows, an unobtrusive navigation rail, and a focused editor at the right edge. Tonal separation carries ordinary hierarchy; shadows identify temporary layers. Preserve this native-feeling utility direction when extending the application.

**Key Characteristics:**
- Search-first navigation and visible keyboard focus.
- Warm light neutrals and coordinated dark surfaces.
- Aligned profile rows with initials, browser labels, and tags.
- Restrained accent, compact controls, and a full-height side editor.

The original identity asset is `assets/icon.svg`: a rounded dark square, open violet C, pale horizontal strokes, and a small green dot. Use this asset for the application identity; Lucide supplies interface icons. Reference captures of the built interface are `artifacts/manager-light.png`, `artifacts/manager-dark.png`, `artifacts/manager-compact.png`, `artifacts/editor-light.png`, `artifacts/launcher.png`, and `artifacts/slimming.png`.

## Colors

The frontmatter preserves the paired CSS colors from `src/theme.css`; each `light-dark()` value lists light first and dark second. Settings supports Follow Windows, Light, and Dark through the document color scheme.

### Primary
- **Restrained Violet** (`accent`): primary buttons, focus, selected navigation, and actionable text. `accent-hover` marks primary hover; `on-accent` keeps button labels coordinated with each theme.
- **Soft Violet** (`accent-soft`): active navigation, active launcher result, unlocked-manager notice, and supporting icon backgrounds.

### Neutral
- **Warm Canvas** (`canvas`), **Raised Surface** (`surface`), and **Quiet Rail** (`rail`) separate the workspace, controls, and navigation.
- **Ink** (`ink`) and **Muted Ink** (`muted`) establish primary and supporting text.
- **Soft Divider** (`line`), **Control Hover** (`hover`), **Row Hover** (`row-hover`), and **Quiet Tag** (`tag`) provide subtle structure and interaction feedback.

### Semantic colors
- `gold` identifies favorites; `orange` distinguishes the Firefox browser mark.
- `green` and `green-bg` support local status and preservation/success messages. `error` and `error-bg` support failures and removal confirmation.
- Profile colors are user-selectable identity cues from the six values in `src/main.tsx`; they tint initial avatars and are separate from global status colors.

**The Paired Theme Rule.** Change light and dark roles together; use semantic variables rather than placing light-only colors on application surfaces.

## Typography

**Display Font:** Segoe UI, sans-serif.
**Body Font:** Segoe UI, sans-serif.
**Label/Mono Font:** Keyboard hints inherit the same family; no separate mono family is introduced.

The hierarchy is compact and familiar. The frontmatter records the recurring page headline, dialog title, section title, body, and label roles. Page headlines use restrained negative tracking. Supporting copy usually sits at 11-13px; keyboard hints use 11px. The launcher search is larger (21px) to establish immediate input focus. Paragraphs cap at 70ch where no narrower component limit applies.

## Layout

The manager fills the window with a fixed rail and a scrolling main region. The rail is 221px wide, the topbar 66px high, and the page has 38px horizontal padding with a 1500px maximum content width. Profile rows have a 91px minimum height and align selection, avatar, identity, tags, favorite, launch, and actions. They are divided by fine rules.

At the existing 1020px breakpoint, the rail becomes 196px, page padding becomes 30px vertically and 25px horizontally, row gaps tighten, and tags and the topbar's trailing message disappear. This is the implemented compact desktop treatment; no mobile navigation is defined.

The editor is a 580px right-side panel occupying full window height. Its body scrolls while its header and footer remain in the panel layout. Browser/type fields and paired checkboxes use a two-column grid with a 16px gap. The dimmed manager remains spatial context.

The launcher is a separate popup surface: an 81px search band, result label, scrolling list, and keyboard-help footer. Results use full-width rounded selection rows. Centered dialogs are 430px wide, or 650px for discovery and slimming, with viewport-constrained height.

## Elevation & Depth

The manager is mostly flat: surface tones and one-pixel dividers define structure. Temporary dialogs use a soft large shadow (`0 20px 70px rgba(15,15,25,.22)`); context menus use a tighter shadow (`0 9px 35px rgba(0,0,0,.2)`). The overlay dim is `rgba(17,17,25,.4)`. The side editor inherits dialog elevation but has square outer corners.

Dialogs arrive over 180ms with `cubic-bezier(.16,1,.3,1)`, moving upward from an 8px offset while opacity rises from .7. Reduced-motion preference disables animation and smooth scrolling. Other controls use immediate state changes in the current implementation.

## Shapes

Small, gently rounded controls carry the system: tags and keycaps use 4px corners; icon/launch controls use 6px; primary/secondary buttons and fields use 7px; search and launcher rows use 8px. Centered dialogs use 14px corners. Identity avatars are 42 by 44px with 11px corners, colored initials, and a 16% profile-color tint mixed into the surface.

## Components

### Buttons

Primary actions use violet with paired on-accent text and compact semibold labels; hover uses the stronger accent token. Secondary actions have a surface fill and thin divider border; hover uses the control-hover tone. Text actions use accent ink. Icon buttons have explicit accessible labels and a hover surface. Disabled controls reduce opacity to .5 and use the not-allowed cursor.

### Chips

Tags are quiet, noninteractive metadata with muted ink and no border. The browser's system-default badge uses the accent-soft treatment. Tags never replace profile names or browser labels.

### Cards / Containers

The profile library is a divided list. Settings sections and browser entries use separators. Temporary task containers are dialogs, the side editor, and the context menu; retain their documented shape and elevation roles.

### Inputs / Fields

Fields use surface fill, divider stroke, compact padding, and persistent labels. Standard keyboard focus uses a 2px accent outline offset by 3px. Search changes its container border on focus instead of outlining the inner input. Errors appear inline with alert semantics; operation notices use status semantics. Do not rely on color alone to convey a failure or selection.

### Navigation

The left rail provides All profiles, Favorites, Recently used, Browsers, and Settings. Active navigation uses accent-soft fill, accent ink, semibold text, and `aria-current="page"`. The rail footer keeps discreet-profile access and the configured global launcher shortcut nearby.

### Profile editor

Create and edit open the same modal side panel. Identity preview and color choice precede name, browser/type, tags, startup URLs, and favorite/hidden controls. Browser and type are fixed for existing registrations. Advanced browser/storage options are disclosed on demand. Cancel and Save/Create stay in the footer; removal has a separate confirmation explaining that browser data is kept.

### Hotkey launcher and keyboard access

On launcher focus, search resets and receives focus. The search is a combobox controlling a listbox; the active result is exposed with `aria-activedescendant` and `aria-selected`. Up/Down moves the active result and scrolls it into view; Enter launches it. Escape dismisses the launcher after any open context menu is closed. Manage profiles opens the manager.

Ctrl+K focuses search only when no editor, PIN, slimming, or discovery modal is open. Dialogs expose modal semantics, contain Tab/Shift+Tab focus, and restore prior focus when closed. Escape closes the current temporary layer. Keep visible focus on every actionable control and retain reduced-motion behavior.

### PIN reveal

The rail's Show hidden profiles action opens a four-digit masked PIN dialog, or PIN setup if needed. Successful reveal is confined to the manager and has a violet notice with Lock now. Hidden profiles remain excluded from the hotkey launcher. PIN copy explains relocking on manager close, Windows lock, or five idle minutes, and makes clear that this does not encrypt browser data. Setup requires matching confirmation; changing a PIN includes the current PIN. Inline errors stay within the dialog.

### Manual slimming

Selected rows or a profile's context menu open a preview with total disposable cache, per-profile details, skipped reasons, and a green preservation note. The explicit Clear cache action shows its amount and becomes busy during work. Completion replaces the preview with reclaimed bytes and removed/skipped counts. Copy preserves cookies, logins, bookmarks, history, extensions, and website storage while acknowledging website session expiry. The preview states that only closed browsers can be cleaned, unsafe/changed/locked files are skipped, and the preview expires after five minutes. This is a manual flow.

## Do's and Don'ts

### Do:
- **Do** use semantic paired theme variables for all application surfaces and text.
- **Do** preserve the aligned library rows, right-side editor, and search-first launcher.
- **Do** keep keyboard focus, active-result semantics, and reduced-motion support visible in future work.
- **Do** use the original application icon and Lucide interface glyphs consistently.
- **Do** state concrete outcomes, preserved browser data, and actionable empty states.

### Don't:
- **Don't** turn the compact utility into a marketing page or replace the library with dashboard cards.
- **Don't** expose hidden profiles in the launcher after manager PIN reveal.
- **Don't** style PIN access as browser-data encryption or promise indefinite website sessions.
- **Don't** imply scheduled cleanup or obscure the manual cache preview and confirmation.
