<script setup lang="ts">
import { X } from 'lucide-vue-next';

// This URL needs to match the backend port
const API_BASE = import.meta.env.VITE_API_URL

const emit = defineEmits(['close']);

const loginWithGoogle = () => {
  const currentPath = window.location.pathname + window.location.search;
  window.location.href = `${API_BASE}/api/auth/google?redirect=${encodeURIComponent(currentPath)}`;
};

// const loginWithWeChat = () => {
//   window.location.href = `${API_BASE}/api/auth/wechat`;
// };
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-content glass-panel">
      <button class="close-btn" @click="emit('close')">
        <X :size="20" />
      </button>

      <h2 class="modal-title">登录</h2>
      <p class="modal-subtitle">登录以保存您的 AI Video Highlights 历史记录。</p>

      <div class="auth-buttons">
        <!-- <button class="auth-btn wechat-btn" @click="loginWithWeChat">
          <img src="https://upload.wikimedia.org/wikipedia/commons/1/14/WeChat_logo.svg" alt="WeChat" class="btn-icon" />
          <span>使用微信登录</span>
        </button> -->

        <button class="auth-btn google-btn" @click="loginWithGoogle">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" class="btn-icon" />
          <span>使用 Google 登录</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease-out;
}

.modal-content {
  position: relative;
  width: 90%;
  max-width: 400px;
  padding: 40px;
  background: rgba(15, 15, 18, 0.95);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  animation: slideUp 0.3s ease-out;
}

.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.modal-title {
  font-size: 1.5rem;
  font-weight: 600;
  text-align: center;
  margin-bottom: 8px;
  color: var(--text-primary);
}

.modal-subtitle {
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin-bottom: 32px;
}

.auth-buttons {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.auth-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  border-radius: 100px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.btn-icon {
  width: 24px;
  height: 24px;
}

.google-btn {
  background: #ffffff;
  color: #3c4043;
}

.google-btn:hover {
  background: #f8f9fa;
  box-shadow: 0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15);
}

.wechat-btn {
  background: #07C160;
  color: white;
}

.wechat-btn:hover {
  background: #06AD56;
  box-shadow: 0 4px 12px rgba(7, 193, 96, 0.3);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
</style>
