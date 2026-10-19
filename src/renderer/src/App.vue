<template>
  <div class="app" @dragover.prevent @drop="onDrop">
    <header class="topbar">
      <nav class="tabs" role="tablist">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="tab"
          :class="{ 'tab--active': tab.id === activeId }"
          role="tab"
          :aria-selected="tab.id === activeId"
          :title="tab.path ?? tab.title"
          @click="activeId = tab.id"
          @mousedown.middle.prevent="closeTab(tab.id)"
        >
          <span class="tab__title">{{ tab.title }}</span>
          <span v-if="tab.external" class="tab__changed" title="Changed on disk" aria-label="Changed on disk">!</span>
          <button
            class="tab__close"
            :class="{ 'tab__close--dirty': isDirty(tab) }"
            :aria-label="`Close ${tab.title}`"
            @click.stop="closeTab(tab.id)"
          >
            <span class="tab__dot" aria-hidden="true">●</span>
            <span class="tab__x" aria-hidden="true">×</span>
          </button>
        </div>
        <button class="tab-new" title="New document" aria-label="New document" @click="newTab()">+</button>
      </nav>

      <div class="actions">
        <button @click="openFiles">Open</button>
        <button :disabled="!activeTab" @click="saveActive()">Save</button>
        <button :disabled="!activeTab || exporting" @click="exportPdf">
          {{ exporting ? 'Exporting…' : 'Export PDF' }}
        </button>
        <button
          class="icon-btn"
          :title="`Appearance: ${themeLabel[theme]} (click to change)`"
          :aria-label="`Appearance: ${themeLabel[theme]}`"
          @click="cycleTheme"
        >
          <svg v-if="theme === 'light'" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
          <svg v-else-if="theme === 'dark'" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8M12 16v4" />
          </svg>
        </button>
      </div>
    </header>

    <main class="workspace">
      <div v-for="tab in tabs" v-show="tab.id === activeId" :key="tab.id" class="doc">
        <div v-if="tab.external" class="disk-banner" role="alert">
          <span class="disk-banner__text">
            <template v-if="tab.external.content === null">
              <strong>{{ tab.title }}</strong> was deleted or moved by another program.
            </template>
            <template v-else>
              <strong>{{ tab.title }}</strong> was changed by another program.
              <template v-if="isDirty(tab)">Reloading discards your unsaved changes.</template>
            </template>
          </span>
          <template v-if="tab.external.content === null">
            <button class="primary" @click="keepMine(tab)">Keep in Editor</button>
          </template>
          <template v-else>
            <button class="primary" @click="reloadFromDisk(tab)">Reload</button>
            <button @click="keepMine(tab)">Keep My Version</button>
          </template>
        </div>
        <CliveEdit
          v-model="tab.content"
          :toolbar-items="toolbarItems"
          :on-image-upload="(file: File) => uploadImage(tab, file)"
          :max-image-size="MAX_IMAGE_BYTES"
          placeholder="Start writing…"
        />
      </div>

      <section v-if="!tabs.length" class="welcome">
        <h1>CliveEdit Desktop</h1>
        <p class="welcome__lead">Open a markdown file or start a new one.</p>
        <div class="welcome__buttons">
          <button class="primary" @click="newTab()">New document</button>
          <button @click="openFiles">Open…</button>
        </div>

        <div v-if="recent.length" class="recent">
          <div class="recent__head">
            <h2>Recent</h2>
            <button class="link" @click="clearRecent">Clear</button>
          </div>
          <ul>
            <li v-for="p in recent" :key="p">
              <button class="recent__item" :title="p" @click="openPath(p)">
                <span class="recent__name">{{ fileName(p) }}</span>
                <span class="recent__dir">{{ p }}</span>
              </button>
            </li>
          </ul>
        </div>
      </section>
    </main>

    <LinkDialog
      v-if="linkRequest"
      :initial-text="linkRequest.text"
      @confirm="linkRequest.done($event)"
      @cancel="linkRequest.done(null)"
    />

    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CliveEdit, defaultToolbarItems } from '@dev_owl/cliveedit'
import type { EditorContext, ToolbarItem } from '@dev_owl/cliveedit'
import type { DiskChange, MenuAction, ThemeSetting } from '../../shared/api'
import { setDocumentBase } from './baseHref'
import LinkDialog from './LinkDialog.vue'

interface Tab {
  id: number
  path: string | null
  title: string
  content: string
  /** Content as last loaded from / written to disk */
  saved: string
  /** Line ending of the file on disk, restored when saving */
  eol: '\n' | '\r\n'
  /** Unanswered change made by another program (content null: deleted) */
  external: { content: string | null } | null
}

const api = window.api

/* ---- Toolbar ----
 * - Print is dropped: it prints a hidden iframe, which comes out blank in
 *   Electron. PDF output goes through "Export PDF" instead.
 * - Image and link use window.prompt(), which Electron does not implement,
 *   so they are replaced by a file picker and an in-app link dialog. */
const toolbarItems: ToolbarItem[] = defaultToolbarItems
  .filter((item) => item.action !== 'print')
  .map((item): ToolbarItem => {
    const { action: _action, ...base } = item
    if (item.action === 'image') return { ...base, label: 'Insert Image…', onClick: insertImageFromDisk }
    if (item.action === 'link') return { ...base, onClick: insertLink }
    return item
  })

/** Lets CliveEdit accept large images; the embed dialog warns about size. */
const MAX_IMAGE_BYTES = 100 * 1024 * 1024

const tabs = ref<Tab[]>([])
const activeId = ref<number | null>(null)
const recent = ref<string[]>([])
const exporting = ref(false)
const toast = ref('')
const theme = ref<ThemeSetting>('system')

let nextId = 1
let untitledCount = 0
let toastTimer: ReturnType<typeof setTimeout> | undefined

const activeTab = computed(() => tabs.value.find((t) => t.id === activeId.value) ?? null)
// The editor re-serializes markdown (LF line endings, no trailing newline),
// so compare a normalized form to avoid flagging untouched files as changed.
const normalize = (md: string) => md.replace(/\r\n/g, '\n').replace(/\s+$/, '')
const isDirty = (tab: Tab) => normalize(tab.content) !== normalize(tab.saved)

/** Text written to disk: original line endings and a final newline. */
function toDiskText(tab: Tab): string {
  const text = normalize(tab.content)
  return text ? (text + '\n').replace(/\n/g, tab.eol) : ''
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function showToast(message: string): void {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3500)
}

/** CliveEdit emits model updates with a short debounce — let it settle. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150))
}

/* ---- Relative images resolve against the active document's folder ---- */

watch(
  () => activeTab.value?.path ?? null,
  (path) => setDocumentBase(path ? api.baseHrefForFile(path) : null),
  { immediate: true },
)

/* ---- Window title & dirty indicator ---- */

watch(
  () => [activeTab.value?.title, activeTab.value && isDirty(activeTab.value), tabs.value.some(isDirty)],
  () => {
    const tab = activeTab.value
    const title = tab ? `${isDirty(tab) ? '● ' : ''}${tab.title} — CliveEdit` : 'CliveEdit Desktop'
    api.setWindowState(title, tabs.value.some(isDirty))
  },
  { immediate: true },
)

/* ---- Tabs ---- */

function newTab(file?: { path: string; content: string }): Tab {
  const tab: Tab = file
    ? {
        id: nextId++,
        path: file.path,
        title: fileName(file.path),
        content: file.content,
        saved: file.content,
        eol: file.content.includes('\r\n') ? '\r\n' : '\n',
        external: null,
      }
    : {
        id: nextId++,
        path: null,
        title: untitledCount++ ? `Untitled ${untitledCount}` : 'Untitled',
        content: '',
        saved: '',
        eol: api.platform === 'win32' ? '\r\n' : '\n',
        external: null,
      }
  tabs.value.push(tab)
  activeId.value = tab.id
  return tab
}

function addOpenedFile(file: { path: string; content: string }): void {
  const existing = tabs.value.find((t) => t.path === file.path)
  if (existing) {
    activeId.value = existing.id
    return
  }
  // Replace a single, untouched "Untitled" tab instead of piling up tabs.
  const only = tabs.value.length === 1 ? tabs.value[0] : null
  if (only && !only.path && !only.content) tabs.value = []
  newTab(file)
}

async function openFiles(): Promise<void> {
  const files = await api.openDialog()
  files.forEach(addOpenedFile)
}

async function openPath(path: string): Promise<void> {
  const existing = tabs.value.find((t) => t.path === path)
  if (existing) {
    activeId.value = existing.id
    return
  }
  const result = await api.readFile(path)
  if ('error' in result) {
    showToast(`Could not open ${fileName(path)}: ${result.error}`)
    return
  }
  addOpenedFile(result)
}

function onDrop(event: DragEvent): void {
  const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
    /\.(md|markdown|mdown|mkd|txt)$/i.test(f.name),
  )
  if (!files.length) return // let the editor handle image drops
  event.preventDefault()
  event.stopPropagation()
  files.forEach((f) => openPath(api.pathForFile(f)))
}

function removeTab(id: number): void {
  const index = tabs.value.findIndex((t) => t.id === id)
  if (index === -1) return
  tabs.value.splice(index, 1)
  if (activeId.value === id) {
    activeId.value = tabs.value[Math.min(index, tabs.value.length - 1)]?.id ?? null
  }
}

async function closeTab(id: number): Promise<void> {
  await settle()
  const tab = tabs.value.find((t) => t.id === id)
  if (!tab) return
  if (isDirty(tab)) {
    activeId.value = tab.id
    const choice = await api.confirmUnsaved([tab.title])
    if (choice === 'cancel') return
    if (choice === 'save' && !(await saveTab(tab))) return
  }
  removeTab(id)
}

function cycleTab(step: number): void {
  if (tabs.value.length < 2) return
  const index = tabs.value.findIndex((t) => t.id === activeId.value)
  activeId.value = tabs.value[(index + step + tabs.value.length) % tabs.value.length].id
}

/* ---- Saving ---- */

async function saveTab(tab: Tab, forceDialog = false): Promise<boolean> {
  const content = toDiskText(tab)
  if (tab.path && !forceDialog) {
    const result = await api.saveFile(tab.path, content)
    if ('error' in result) {
      showToast(`Save failed: ${result.error}`)
      return false
    }
  } else {
    const suggested = tab.path ?? `${tab.title}.md`
    const path = await api.saveAsDialog(suggested, content)
    if (!path) return false
    tab.path = path
    tab.title = fileName(path)
  }
  tab.saved = content
  tab.external = null
  return true
}

async function saveActive(forceDialog = false): Promise<void> {
  await settle()
  const tab = activeTab.value
  if (tab && (await saveTab(tab, forceDialog))) showToast(`Saved ${tab.title}`)
}

/* ---- Changes made by other programs ---- */

watch(
  () => tabs.value.map((t) => t.path).filter((p): p is string => !!p),
  (paths) => api.watchFiles(paths),
  { immediate: true },
)

function onFileChanged({ path, content }: DiskChange): void {
  const tab = tabs.value.find((t) => t.path === path)
  if (!tab) return
  // Back to what the editor already knows (e.g. a change was undone).
  if (content !== null && normalize(content) === normalize(tab.saved)) {
    tab.external = null
    return
  }
  tab.external = { content }
}

function reloadFromDisk(tab: Tab): void {
  const content = tab.external?.content
  if (content == null) return
  tab.content = content
  tab.saved = content
  tab.eol = content.includes('\r\n') ? '\r\n' : '\n'
  tab.external = null
}

/** Keep the editor's text; it now differs from disk, so the tab is unsaved. */
function keepMine(tab: Tab): void {
  if (!tab.external) return
  tab.saved = tab.external.content ?? ''
  tab.external = null
}

/* ---- PDF ---- */

async function exportPdf(): Promise<void> {
  const tab = activeTab.value
  if (!tab || exporting.value) return
  await settle()
  exporting.value = true
  try {
    const out = await api.exportPdf(tab.content, tab.path, tab.title.replace(/\.[^.]+$/, ''))
    if (out) showToast(`Exported ${fileName(out)}`)
  } finally {
    exporting.value = false
  }
}

/* ---- Appearance ---- */

const themeLabel: Record<ThemeSetting, string> = { system: 'System', light: 'Light', dark: 'Dark' }
const themeOrder: ThemeSetting[] = ['system', 'light', 'dark']

function cycleTheme(): void {
  const next = themeOrder[(themeOrder.indexOf(theme.value) + 1) % themeOrder.length]
  theme.value = next
  api.setTheme(next)
}

/* ---- Images ---- */

function markdownImage(alt: string, src: string): string {
  return `![${alt.replace(/[[\]\\]/g, '')}](${src})`
}

/** Toolbar button: pick a file, then embed or link it. */
async function insertImageFromDisk(ctx: EditorContext): Promise<void> {
  const tab = activeTab.value
  if (!tab) return
  const filePath = await api.pickImage()
  if (!filePath) return
  const image = await api.resolveImage({ docPath: tab.path, filePath, name: '', mime: '', bytes: null })
  if (image) ctx.insertMarkdown(markdownImage(image.alt, image.src))
}

/**
 * Paste and drag & drop: CliveEdit calls this for image files and inserts
 * the returned URL. Throwing (on cancel) makes it insert nothing.
 */
async function uploadImage(tab: Tab, file: File): Promise<string> {
  const filePath = api.pathForFile(file) || null
  const bytes = filePath ? null : new Uint8Array(await file.arrayBuffer())
  const image = await api.resolveImage({ docPath: tab.path, filePath, name: file.name, mime: file.type, bytes })
  if (!image) throw new Error('Image insert cancelled')
  return image.src
}

/* ---- Links ---- */

const linkRequest = ref<{ text: string; done: (link: { url: string; text: string } | null) => void } | null>(null)

function askForLink(text: string): Promise<{ url: string; text: string } | null> {
  return new Promise((resolve) => {
    linkRequest.value = {
      text,
      done: (link) => {
        linkRequest.value = null
        resolve(link)
      },
    }
  })
}

async function insertLink(ctx: EditorContext): Promise<void> {
  // Markdown mode wraps the selection in [text](url) without prompting.
  if (ctx.mode === 'markdown') {
    ctx.link()
    return
  }
  const link = await askForLink(window.getSelection()?.toString() ?? '')
  if (!link) return
  const url = link.url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
  const text = (link.text || link.url).replace(/[[\]\\]/g, '\\$&')
  ctx.insertMarkdown(`[${text}](${url})`)
}

/* ---- Shortcuts CliveEdit would route to prompt() / iframe printing ---- */

function onShortcut(event: KeyboardEvent): void {
  const mod = event.metaKey || event.ctrlKey
  if (!mod || event.altKey) return
  const key = event.key.toLowerCase()

  if (key === 'p') {
    event.preventDefault()
    event.stopPropagation()
    exportPdf()
  } else if (key === 'k' && !event.shiftKey) {
    const editor = (event.target as HTMLElement | null)?.closest?.('.cliveedit')
    if (!editor?.querySelector('.ce-wysiwyg')?.contains(event.target as Node)) return
    event.preventDefault()
    event.stopPropagation()
    // Go through the toolbar button so the handler gets the editor context.
    editor.querySelector<HTMLButtonElement>('.ce-toolbar button[aria-label="Link"]')?.click()
  }
}

/* ---- Recent ---- */

async function clearRecent(): Promise<void> {
  await api.clearRecent()
}

/* ---- Closing the window ---- */

async function onCloseRequested(): Promise<void> {
  await settle()
  const dirty = tabs.value.filter(isDirty)
  if (dirty.length) {
    const choice = await api.confirmUnsaved(dirty.map((t) => t.title))
    if (choice === 'cancel') return
    if (choice === 'save') {
      for (const tab of dirty) {
        activeId.value = tab.id
        if (!(await saveTab(tab))) return
      }
    }
  }
  api.confirmClose()
}

/* ---- Wiring ---- */

const menuHandlers: Record<MenuAction, () => void> = {
  new: () => newTab(),
  open: openFiles,
  save: () => saveActive(),
  'save-as': () => saveActive(true),
  'export-pdf': exportPdf,
  'close-tab': () => activeId.value !== null && closeTab(activeId.value),
  'next-tab': () => cycleTab(1),
  'prev-tab': () => cycleTab(-1),
}

onMounted(async () => {
  window.addEventListener('keydown', onShortcut, true)
  api.onMenu((action) => menuHandlers[action]?.())
  api.onOpenPaths((paths) => paths.forEach(openPath))
  api.onFileChanged(onFileChanged)
  api.onRecentChanged((paths) => (recent.value = paths))
  api.onThemeChanged((t) => (theme.value = t))
  theme.value = await api.getTheme()
  api.onCloseRequested(onCloseRequested)
  recent.value = await api.getRecent()
  api.rendererReady()
})

onBeforeUnmount(() => window.removeEventListener('keydown', onShortcut, true))
</script>
