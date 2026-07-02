import { createI18n } from 'vue-i18n';
import en from './en';
import zh from './zh';

const STORAGE_KEY = 'openwork-language';

function getInitialLocale(): 'en' | 'zh' {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
  } catch {}
  return 'en';
}

export const i18n = createI18n({
  legacy: false,
  locale: getInitialLocale(),
  fallbackLocale: 'en',
  messages: { en, zh },
});
