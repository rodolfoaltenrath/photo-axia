import {createApp} from 'vue'
import App from './App.vue'
import { installDesktopInteractionGuards } from './editor/interactionGuards'
import './style.css';

installDesktopInteractionGuards()
createApp(App).mount('#app')
