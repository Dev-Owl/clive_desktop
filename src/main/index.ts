import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MenuAction, OpenedFile, ThemeSetting, UnsavedChoice } from '../shared/api'
import { FILE_HOST, FILE_SCHEME } from '../shared/fileUrl'

const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'txt']
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
}
const MAX_RECENT = 10

let mainWindow: BrowserWindow | null = null
let allowClose = false
let rendererReady = false
let pendingPaths: string[] = []

// Fixed name so settings (recent.json) always live in the same userData
// folder, however Electron is launched.
app.setName('CliveEdit Desktop')

protocol.registerSchemesAsPrivileged([
  { scheme: FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

/* ------------------------------------------------------------------ */
/*  Window                                                            */
/* ------------------------------------------------------------------ */

function loadRenderer(win: BrowserWindow, hash?: string): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    return win.loadURL(process.env.ELECTRON_RENDERER_URL + (hash ? `#${hash}` : ''))
  }
  return win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

function hardenNavigation(win: BrowserWindow): void {
  // Links inside a document must never navigate the app away. Web links
  // open in the system browser, everything else is ignored.
  const openExternally = (url: string) => {
    if (/^https?:\/\//i.test(url) || url.startsWith('mailto:')) shell.openExternal(url)
  }
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault()
      openExternally(url)
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: 'deny' }
  })
}

function createMainWindow(): void {
  allowClose = false
  rendererReady = false

  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 640,
    minHeight: 400,
    show: false,
    title: 'CliveEdit Desktop',
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow = win

  hardenNavigation(win)
  win.once('ready-to-show', () => win.show())

  // Ask the renderer whether there are unsaved changes before closing.
  win.on('close', (event) => {
    if (allowClose || !rendererReady) return
    event.preventDefault()
    win.webContents.send('app:close-requested')
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  loadRenderer(win)
}

function sendMenu(action: MenuAction): void {
  mainWindow?.webContents.send('menu', action)
}

const isMarkdownPath = (p: string) => MARKDOWN_EXTENSIONS.includes(extname(p).slice(1).toLowerCase())

function openPaths(paths: string[]): void {
  const files = paths.filter(isMarkdownPath)
  if (!files.length) return
  if (mainWindow && rendererReady) {
    mainWindow.webContents.send('app:open-paths', files)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  } else {
    pendingPaths.push(...files)
    if (!mainWindow && app.isReady()) createMainWindow()
  }
}

/* ------------------------------------------------------------------ */
/*  Recent documents                                                  */
/* ------------------------------------------------------------------ */

const recentFile = () => join(app.getPath('userData'), 'recent.json')
let recent: string[] = []

async function loadRecent(): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(recentFile(), 'utf8'))
    recent = Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : []
  } catch {
    recent = []
  }
}

async function setRecent(paths: string[]): Promise<void> {
  recent = paths.slice(0, MAX_RECENT)
  try {
    await writeFile(recentFile(), JSON.stringify(recent, null, 2))
  } catch {
    // Not fatal — the list just won't survive a restart.
  }
  buildMenu()
  mainWindow?.webContents.send('recent:changed', recent)
}

function addRecent(path: string): Promise<void> {
  app.addRecentDocument(path)
  return setRecent([path, ...recent.filter((p) => p !== path)])
}

/* ------------------------------------------------------------------ */
/*  Appearance                                                        */
/* ------------------------------------------------------------------ */

// The renderer styles itself with `prefers-color-scheme`, which follows
// nativeTheme.themeSource — so one setting drives the page, native
// dialogs and the menu bar alike.

const settingsFile = () => join(app.getPath('userData'), 'settings.json')
const THEMES: ThemeSetting[] = ['system', 'light', 'dark']

async function loadTheme(): Promise<void> {
  try {
    const { theme } = JSON.parse(await readFile(settingsFile(), 'utf8'))
    if (THEMES.includes(theme)) nativeTheme.themeSource = theme
  } catch {
    nativeTheme.themeSource = 'system'
  }
}

async function setTheme(theme: ThemeSetting): Promise<void> {
  if (!THEMES.includes(theme)) return
  nativeTheme.themeSource = theme
  try {
    await writeFile(settingsFile(), JSON.stringify({ theme }, null, 2))
  } catch {
    // Not fatal — the choice just won't survive a restart.
  }
  buildMenu()
  mainWindow?.webContents.send('theme:changed', theme)
}

function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#ffffff'
}

/* ------------------------------------------------------------------ */
/*  Menu                                                              */
/* ------------------------------------------------------------------ */

function buildMenu(): void {
  const isMac = process.platform === 'darwin'

  const recentItems: MenuItemConstructorOptions[] = recent.length
    ? [
        ...recent.map((p) => ({ label: p, click: () => openPaths([p]) })),
        { type: 'separator' as const },
        { label: 'Clear Recent', click: () => setRecent([]) },
      ]
    : [{ label: 'No Recent Documents', enabled: false }]

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open') },
        { label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenu('save-as') },
        { label: 'Export as PDF…', accelerator: 'CmdOrCtrl+Shift+E', click: () => sendMenu('export-pdf') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => sendMenu('close-tab') },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => sendMenu('next-tab') },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => sendMenu('prev-tab') },
        { type: 'separator' },
        {
          label: 'Appearance',
          submenu: [
            { label: 'System', value: 'system' as const },
            { label: 'Light', value: 'light' as const },
            { label: 'Dark', value: 'dark' as const },
          ].map(({ label, value }) => ({
            label,
            type: 'radio' as const,
            checked: nativeTheme.themeSource === value,
            click: () => setTheme(value),
          })),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
      ],
    },
    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ------------------------------------------------------------------ */
/*  Local image protocol                                              */
/* ------------------------------------------------------------------ */

function registerFileProtocol(): void {
  // Serves *images only* from the local disk, so documents can reference
  // pictures next to them. Anything else (or a missing file) is a 404,
  // which the browser shows as a broken image — the document still loads.
  protocol.handle(FILE_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      if (url.host !== FILE_HOST) return new Response(null, { status: 404 })

      let filePath = decodeURIComponent(url.pathname)
      if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1) // Windows drive

      const mime = IMAGE_MIME[extname(filePath).toLowerCase()]
      if (!mime) return new Response(null, { status: 404 })

      const info = await stat(filePath)
      if (!info.isFile()) return new Response(null, { status: 404 })

      const res = await net.fetch(pathToFileURL(filePath).toString())
      return new Response(res.body, { status: 200, headers: { 'content-type': mime } })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}

/* ------------------------------------------------------------------ */
/*  PDF export                                                        */
/* ------------------------------------------------------------------ */

async function renderPdf(markdown: string, baseHref: string | null): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  hardenNavigation(win)

  try {
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out rendering the document')), 30_000)
      const onReady = (event: Electron.IpcMainEvent) => {
        if (event.sender !== win.webContents) return
        clearTimeout(timer)
        ipcMain.removeListener('print:ready', onReady)
        resolve()
      }
      ipcMain.on('print:ready', onReady)
    })

    await loadRenderer(win, 'print')
    win.webContents.send('print:load', { markdown, baseHref })
    await ready

    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
    })
  } finally {
    win.destroy()
  }
}

/* ------------------------------------------------------------------ */
/*  IPC                                                               */
/* ------------------------------------------------------------------ */

async function readMarkdown(path: string): Promise<OpenedFile> {
  return { path, content: await readFile(path, 'utf8') }
}

const markdownFilters = [
  { name: 'Markdown', extensions: MARKDOWN_EXTENSIONS },
  { name: 'All Files', extensions: ['*'] },
]

function registerIpc(): void {
  ipcMain.handle('dialog:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: markdownFilters,
    })
    if (result.canceled) return []
    const files: OpenedFile[] = []
    for (const p of result.filePaths) {
      try {
        files.push(await readMarkdown(p))
        await addRecent(p)
      } catch (err) {
        dialog.showErrorBox('Could not open file', `${p}\n\n${(err as Error).message}`)
      }
    }
    return files
  })

  ipcMain.handle('file:read', async (_e, path: string) => {
    try {
      const file = await readMarkdown(path)
      await addRecent(path)
      return file
    } catch (err) {
      // Drop entries that no longer exist from the recent list.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await setRecent(recent.filter((p) => p !== path))
      }
      return { error: (err as Error).message }
    }
  })

  ipcMain.handle('file:save', async (_e, path: string, content: string) => {
    try {
      await writeFile(path, content, 'utf8')
      await addRecent(path)
      return { ok: true }
    } catch (err) {
      return { error: (err as Error).message }
    }
  })

  ipcMain.handle('dialog:save-as', async (_e, suggestedName: string, content: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: suggestedName,
      filters: markdownFilters,
    })
    if (result.canceled || !result.filePath) return null
    try {
      await writeFile(result.filePath, content, 'utf8')
      await addRecent(result.filePath)
      return result.filePath
    } catch (err) {
      dialog.showErrorBox('Could not save file', (err as Error).message)
      return null
    }
  })

  ipcMain.handle(
    'pdf:export',
    async (_e, markdown: string, docPath: string | null, title: string, baseHref: string | null) => {
      const defaultName = (docPath ? basename(docPath, extname(docPath)) : title) + '.pdf'
      const defaultPath = docPath ? join(dirname(docPath), defaultName) : defaultName
      const result = await dialog.showSaveDialog(mainWindow!, {
        defaultPath,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (result.canceled || !result.filePath) return null
      try {
        const pdf = await renderPdf(markdown, baseHref)
        await writeFile(result.filePath, pdf)
        return result.filePath
      } catch (err) {
        dialog.showErrorBox('PDF export failed', (err as Error).message)
        return null
      }
    },
  )

  ipcMain.handle('theme:get', () => nativeTheme.themeSource)
  ipcMain.handle('theme:set', (_e, theme: ThemeSetting) => setTheme(theme))

  ipcMain.handle('recent:get', () => recent)
  ipcMain.handle('recent:clear', () => setRecent([]))

  ipcMain.handle('dialog:unsaved', async (_e, names: string[]): Promise<UnsavedChoice> => {
    const single = names.length === 1
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: [single ? 'Save' : 'Save All', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: single
        ? `Do you want to save the changes to "${names[0]}"?`
        : `You have unsaved changes in ${names.length} documents.`,
      detail: single ? 'Your changes will be lost if you don’t save them.' : names.join('\n'),
    })
    return (['save', 'discard', 'cancel'] as const)[response]
  })

  ipcMain.on('window:state', (_e, title: string, dirty: boolean) => {
    if (!mainWindow) return
    mainWindow.setTitle(title)
    if (process.platform === 'darwin') mainWindow.setDocumentEdited(dirty)
  })

  ipcMain.on('app:confirm-close', () => {
    allowClose = true
    mainWindow?.close()
  })

  ipcMain.on('app:renderer-ready', (event) => {
    if (event.sender !== mainWindow?.webContents) return
    rendererReady = true
    if (pendingPaths.length) {
      mainWindow.webContents.send('app:open-paths', pendingPaths)
      pendingPaths = []
    }
  })
}

/* ------------------------------------------------------------------ */
/*  App lifecycle                                                     */
/* ------------------------------------------------------------------ */

// Files passed on the command line (Windows / Linux file association).
const argvFiles = (argv: string[]) => argv.slice(1).filter((a) => !a.startsWith('-') && isMarkdownPath(a))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    openPaths(argvFiles(argv))
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // macOS: files dropped on the dock icon / opened via Finder.
  app.on('open-file', (event, path) => {
    event.preventDefault()
    openPaths([path])
  })

  app.whenReady().then(async () => {
    await loadRecent()
    await loadTheme()
    nativeTheme.on('updated', () => mainWindow?.setBackgroundColor(windowBackground()))
    registerFileProtocol()
    registerIpc()
    buildMenu()
    pendingPaths.push(...argvFiles(process.argv))
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
