import { ref, Ref } from 'vue';

let instance: {
  rateLimitActive: Ref<boolean>;
  retryAt: Ref<string | null>;
  countdownSeconds: Ref<number>;
  setRateLimit: (retryAfter: number) => void;
  clearRateLimit: () => void;
  restoreFromStorage: () => void;
} | null = null;

function createRateLimitStore() {
  const rateLimitActive = ref(false);
  const retryAt = ref<string | null>(null);
  const countdownSeconds = ref(0);
  let countdownTimer: ReturnType<typeof setTimeout> | null = null;

  function clearCountdown() {
    if (countdownTimer) {
      clearTimeout(countdownTimer);
      countdownTimer = null;
    }
  }

  function setRateLimit(retryAfter: number) {
    clearCountdown();
    rateLimitActive.value = true;
    retryAt.value = new Date(Date.now() + retryAfter * 1000).toISOString();
    countdownSeconds.value = retryAfter;
    localStorage.setItem('rateLimitActive', 'true');
    localStorage.setItem('rateLimitRetryAt', retryAt.value!);
    startCountdown();
  }

  function clearRateLimit() {
    clearCountdown();
    rateLimitActive.value = false;
    retryAt.value = null;
    countdownSeconds.value = 0;
    localStorage.removeItem('rateLimitActive');
    localStorage.removeItem('rateLimitRetryAt');
  }

  function startCountdown() {
    const update = () => {
      if (!retryAt.value) {
        clearRateLimit();
        return;
      }
      const remaining = Math.ceil(
        (new Date(retryAt.value).getTime() - Date.now()) / 1000
      );
      if (remaining <= 0) {
        clearRateLimit();
        return;
      }
      countdownSeconds.value = remaining;
      countdownTimer = setTimeout(update, 1000);
    };
    update();
  }

  function restoreFromStorage() {
    const active = localStorage.getItem('rateLimitActive');
    const retryAtStored = localStorage.getItem('rateLimitRetryAt');
    if (active === 'true' && retryAtStored) {
      retryAt.value = retryAtStored;
      rateLimitActive.value = true;
      const remaining = Math.ceil(
        (new Date(retryAtStored).getTime() - Date.now()) / 1000
      );
      if (remaining > 0) {
        countdownSeconds.value = remaining;
        startCountdown();
      } else {
        clearRateLimit();
      }
    }
  }

  restoreFromStorage();

  return {
    rateLimitActive,
    retryAt,
    countdownSeconds,
    setRateLimit,
    clearRateLimit,
    restoreFromStorage
  };
}

export function useRateLimitStore() {
  if (!instance) {
    instance = createRateLimitStore();
  }
  return instance;
}
