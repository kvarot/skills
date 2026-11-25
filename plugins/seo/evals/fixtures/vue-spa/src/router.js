import { createRouter, createWebHistory } from 'vue-router'
import Accueil from './views/Accueil.vue'
import Soins from './views/Soins.vue'
import Contact from './views/Contact.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Accueil },
    { path: '/soins', component: Soins },
    { path: '/contact', component: Contact },
  ],
})
