import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import VideoView from '../views/VideoView.vue';
const StorybookView = () => import('../views/StorybookView.vue');
const StorybookPrintView = () => import('../views/StorybookPrintView.vue');

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView
    },
    {
      path: '/video',
      name: 'video',
      component: VideoView
    },
    {
      path: '/storybook',
      name: 'storybook',
      component: StorybookView
    },
    {
      path: '/storybook/print',
      name: 'storybook-print',
      component: StorybookPrintView
    },
    // Catch-all route to redirect back to home if path doesn't exist
    {
      path: '/:pathMatch(.*)*',
      redirect: '/'
    }
  ]
});

export default router;
