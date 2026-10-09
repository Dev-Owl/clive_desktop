import { createApp } from 'vue'
import '@dev_owl/cliveedit/style.css'
import './style.css'
import App from './App.vue'
import PrintView from './PrintView.vue'

// The hidden PDF window loads the same bundle with #print.
const isPrint = window.location.hash === '#print'
// PDFs are always light, whatever the app theme is.
if (isPrint) document.documentElement.classList.add('is-print')
createApp(isPrint ? PrintView : App).mount('#app')
