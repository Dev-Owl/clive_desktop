<template>
  <div class="modal-backdrop" @mousedown.self="emit('cancel')">
    <form
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-dialog-title"
      @submit.prevent="submit"
      @keydown.esc.prevent="emit('cancel')"
    >
      <h2 id="link-dialog-title">Insert link</h2>
      <label>
        <span>URL</span>
        <input ref="urlInput" v-model="url" type="text" placeholder="https://" spellcheck="false" />
      </label>
      <label>
        <span>Text</span>
        <input v-model="text" type="text" placeholder="Shown text (optional)" />
      </label>
      <div class="modal__buttons">
        <button type="button" @click="emit('cancel')">Cancel</button>
        <button type="submit" class="primary" :disabled="!url.trim()">Insert</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

// Electron does not implement window.prompt(), which CliveEdit's built-in
// link action relies on, so links are entered here instead.

const props = defineProps<{ initialText: string }>()
const emit = defineEmits<{
  confirm: [link: { url: string; text: string }]
  cancel: []
}>()

const url = ref('https://')
const text = ref(props.initialText)
const urlInput = ref<HTMLInputElement | null>(null)

onMounted(() => {
  urlInput.value?.focus()
  urlInput.value?.select()
})

function submit(): void {
  if (url.value.trim()) emit('confirm', { url: url.value.trim(), text: text.value.trim() })
}
</script>
