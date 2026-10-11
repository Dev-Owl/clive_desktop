import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { dirname } from 'node:path'
import type { DesktopApi } from '../shared/api'
import { dirToBaseHref } from '../shared/fileUrl'

const api: DesktopApi = {
  platform: process.platform,

  openDialog: () => ipcRenderer.invoke('dialog:open'),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  saveFile: (path, content) => ipcRenderer.invoke('file:save', path, content),
  saveAsDialog: (name, content) => ipcRenderer.invoke('dialog:save-as', name, content),
  exportPdf: (markdown, docPath, title) =>
    ipcRenderer.invoke('pdf:export', markdown, docPath, title, docPath ? dirToBaseHref(dirname(docPath)) : null),

  pickImage: () => ipcRenderer.invoke('image:pick'),
  resolveImage: (request) => ipcRenderer.invoke('image:resolve', request),

  getRecent: () => ipcRenderer.invoke('recent:get'),
  clearRecent: () => ipcRenderer.invoke('recent:clear'),
  onRecentChanged: (cb) => ipcRenderer.on('recent:changed', (_e, paths) => cb(paths)),

  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  onThemeChanged: (cb) => ipcRenderer.on('theme:changed', (_e, theme) => cb(theme)),

  confirmUnsaved: (names) => ipcRenderer.invoke('dialog:unsaved', names),
  setWindowState: (title, dirty) => ipcRenderer.send('window:state', title, dirty),
  confirmClose: () => ipcRenderer.send('app:confirm-close'),
  onCloseRequested: (cb) => ipcRenderer.on('app:close-requested', () => cb()),
  onOpenPaths: (cb) => ipcRenderer.on('app:open-paths', (_e, paths) => cb(paths)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
  rendererReady: () => ipcRenderer.send('app:renderer-ready'),

  onPrintLoad: (cb) => ipcRenderer.on('print:load', (_e, payload) => cb(payload)),
  printReady: () => ipcRenderer.send('print:ready'),

  pathForFile: (file) => webUtils.getPathForFile(file),
  baseHrefForFile: (filePath) => dirToBaseHref(dirname(filePath)),
}

contextBridge.exposeInMainWorld('api', api)
