import { reactive } from 'vue';

export const authState = reactive({
  currentUser: null as any,
  showLoginModal: false,
});

export const useAuth = () => {
  const checkLogin = () => {
    if (!authState.currentUser) {
      authState.showLoginModal = true;
      return false;
    }
    return true;
  };

  return {
    authState,
    checkLogin,
  };
};
