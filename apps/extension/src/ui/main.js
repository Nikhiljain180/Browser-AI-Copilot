/**
 * Popup Entry Point - Vue.js Sidebar UI
 */

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Popup from './Popup.vue';
import './popup.css';

const app = createApp(Popup);
app.use(createPinia());
app.mount('#app');
