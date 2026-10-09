<template>
  <div v-if="markdown !== null" class="print">
    <MarkdownViewer :model-value="markdown" :bordered="false" :code-copy-button="false" />
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { MarkdownViewer } from '@dev_owl/cliveedit'
import { setDocumentBase } from './baseHref'

/*
 * Rendered in a hidden window by the main process, which then calls
 * webContents.printToPDF(). We signal readiness once every image has
 * either loaded or failed, so missing local images never block export.
 */

const IMAGE_TIMEOUT_MS = 10_000
const markdown = ref<string | null>(null)

function waitForImages(): Promise<void> {
  const pending = Array.from(document.images).filter((img) => !img.complete)
  const all = Promise.all(
    pending.map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true })
          img.addEventListener('error', () => resolve(), { once: true })
        }),
    ),
  )
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, IMAGE_TIMEOUT_MS))
  return Promise.race([all.then(() => undefined), timeout])
}

window.api.onPrintLoad(async (payload) => {
  setDocumentBase(payload.baseHref)
  markdown.value = payload.markdown
  await nextTick()
  await waitForImages()
  await document.fonts.ready
  window.api.printReady()
})
</script>
