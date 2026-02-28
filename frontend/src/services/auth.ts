import { reactive, watch } from 'vue';

export const authState = reactive({
  currentUser: null as any,
  showLoginModal: false,
  isInitialized: false,
});

export const API_BASE = import.meta.env.VITE_API_URL;

export const useAuth = () => {
  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('auth_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  };

  const checkLogin = () => {
    // If not initialized but has token, we don't know yet, but we shouldn't show the modal.
    // However, if we want to be safe, we should probably only call checkLogin AFTER initialization.
    if (!authState.isInitialized && localStorage.getItem('auth_token')) {
      return true;
    }

    if (!authState.currentUser) {
      authState.showLoginModal = true;
      return false;
    }
    return true;
  };

  const waitForAuth = () => {
    if (authState.isInitialized) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const unwatch = watch(() => authState.isInitialized, (val) => {
        if (val) {
          unwatch();
          resolve();
        }
      });
    });
  };

  return {
    authState,
    checkLogin,
    waitForAuth,
    getAuthHeaders,
  };
};
