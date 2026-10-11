/* Types shared between the main process, preload script and renderer. */

export interface OpenedFile {
  path: string
  content: string
}

/** An image the user wants to insert (picked, dropped or pasted). */
export interface ImageRequest {
  /** Path of the document being edited, null while unsaved */
  docPath: string | null
  /** Image file on disk, null for clipboard images (screenshots) */
  filePath: string | null
  name: string
  mime: string
  /** Image data when there is no file on disk */
  bytes: Uint8Array | null
}

export interface ResolvedImage {
  src: string
  alt: string
}

export type ThemeSetting = 'system' | 'light' | 'dark'

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

export type MenuAction =
  | 'new'
  | 'open'
  | 'save'
  | 'save-as'
  | 'export-pdf'
  | 'close-tab'
  | 'next-tab'
  | 'prev-tab'

export interface DesktopApi {
  platform: NodeJS.Platform

  /* files */
  openDialog(): Promise<OpenedFile[]>
  readFile(path: string): Promise<OpenedFile | { error: string }>
  saveFile(path: string, content: string): Promise<{ ok: true } | { error: string }>
  saveAsDialog(suggestedName: string, content: string): Promise<string | null>
  exportPdf(markdown: string, docPath: string | null, title: string): Promise<string | null>

  /* images */
  pickImage(): Promise<string | null>
  /** Ask whether to embed or link the image; null when cancelled. */
  resolveImage(request: ImageRequest): Promise<ResolvedImage | null>

  /* recent documents */
  getRecent(): Promise<string[]>
  clearRecent(): Promise<void>
  onRecentChanged(cb: (paths: string[]) => void): void

  /* appearance */
  getTheme(): Promise<ThemeSetting>
  setTheme(theme: ThemeSetting): Promise<void>
  onThemeChanged(cb: (theme: ThemeSetting) => void): void

  /* window / lifecycle */
  confirmUnsaved(names: string[]): Promise<UnsavedChoice>
  setWindowState(title: string, dirty: boolean): void
  confirmClose(): void
  onCloseRequested(cb: () => void): void
  onOpenPaths(cb: (paths: string[]) => void): void
  onMenu(cb: (action: MenuAction) => void): void
  rendererReady(): void

  /* hidden print window */
  onPrintLoad(cb: (payload: { markdown: string; baseHref: string | null }) => void): void
  printReady(): void

  /** Absolute path of a file dropped onto the window. */
  pathForFile(file: File): string

  /** URL of the folder containing `filePath`, usable as <base href>. */
  baseHrefForFile(filePath: string): string
}
