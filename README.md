# CliveEdit Desktop

A small cross-platform (macOS / Windows / Linux) markdown editor built with
Electron + Vue on top of [`@dev_owl/cliveedit`](https://github.com/Dev-Owl/clive_editor).

## Features

- Open / edit / save `.md` files, multiple documents in tabs
- Unsaved-changes indicator per tab and a Save / Don't Save / Cancel prompt
  when closing a tab or the window
- Recent documents (welcome screen + *File → Open Recent*)
- Export to PDF (`printToPDF`, rendered with CliveEdit's `MarkdownViewer`)
- Local images relative to the document (`./img/a.png`) or absolute paths are
  shown in the editor and the PDF; missing files fail gracefully as broken images
- Open via drag & drop, command line, or OS file association
- Light / dark theme following the OS by default; override with the toolbar
  button or *View → Appearance* (also applies to native dialogs; PDFs are
  always light)

## Development

```bash
npm install
npm run dev
```

## Packaging

```bash
npm run dist        # current platform
npm run dist:mac
npm run dist:win
npm run dist:linux
```

Output goes to `dist/`. Builds are unsigned; configure signing in
`electron-builder.yml` before distributing.

## Releases

Installers are built by GitHub Actions (`.github/workflows/release.yml`):

1. Bump `version` in `package.json` and commit.
2. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`
   (the tag must match the `package.json` version).
3. The workflow builds on macOS, Windows and Linux and attaches the
   installers to a **draft** release — review it and click *Publish*.

You can also run the workflow manually from the *Actions* tab to just build
the installers (downloadable as workflow artifacts).

| Platform | Files |
| --- | --- |
| macOS (Apple Silicon / Intel) | `.dmg`, `.zip` (`arm64` / `x64`) |
| Windows (x64) | `.exe` installer |
| Linux (x64) | `.AppImage`, `.deb` |

Because the builds are not code-signed, first launch needs one extra step:

- **macOS:** right-click the app → *Open*, or run
  `xattr -cr "/Applications/CliveEdit Desktop.app"` if macOS says it is damaged.
- **Windows:** SmartScreen → *More info* → *Run anyway*.

## How local images work

The markdown is never rewritten. The renderer sets
`<base href="clive-file://local/<document folder>/">` for the active tab, and
the main process serves image files (only) for the `clive-file://` scheme. Web
URLs load as usual. See `src/shared/fileUrl.ts`.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| New / Open | Cmd/Ctrl+N, Cmd/Ctrl+O |
| Save / Save As | Cmd/Ctrl+S, Cmd/Ctrl+Shift+S |
| Export PDF | Cmd/Ctrl+Shift+E |
| Close tab | Cmd/Ctrl+W |
| Next / previous tab | Ctrl+Tab, Ctrl+Shift+Tab |

## License

[MIT](LICENSE)
