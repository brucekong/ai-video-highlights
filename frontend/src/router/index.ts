import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import VideoView from '../views/VideoView.vue';
const StorybookView = () => import('../views/StorybookView.vue');
const StorybookPrintView = () => import('../views/StorybookPrintView.vue');
const VideoTrimView = () => import('../views/VideoTrimView.vue');
const DashboardView = () => import('../views/admin/DashboardView.vue');
const AssetsView = () => import('../views/admin/AssetsView.vue');
const PublishView = () => import('../views/admin/PublishView.vue');

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
    {
      path: '/trim',
      name: 'video-trim',
      component: VideoTrimView
    },
    {
      path: '/admin',
      name: 'admin-dashboard',
      component: DashboardView
    },
    {
      path: '/admin/assets',
      name: 'admin-assets',
      component: AssetsView
    },
    {
      path: '/admin/publish',
      name: 'admin-publish',
      component: PublishView
    },
    // Catch-all route to redirect back to home if path doesn't exist
    {
      path: '/:pathMatch(.*)*',
      redirect: '/'
    }
  ]
});

export default router;
