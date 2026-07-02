import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { i18n } from '../locales'
import { configService } from '../services/configService'

export type Language = 'zh' | 'en'
export type Theme = 'dark' | 'light' | 'blue'

const STORAGE_KEY_LANG = 'openwork-language'
const STORAGE_KEY_THEME = 'openwork-theme'
const CONFIG_FILENAME = 'settings.json'
const CONFIG_STORAGE_KEY = 'openwork-settings'

function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_THEME)
    if (stored === 'dark' || stored === 'light' || stored === 'blue') return stored
  } catch {}
  return 'dark'
}

function saveLanguage(lang: Language) {
  try { localStorage.setItem(STORAGE_KEY_LANG, lang) } catch {}
}

function saveTheme(theme: Theme) {
  try { localStorage.setItem(STORAGE_KEY_THEME, theme) } catch {}
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

async function persistToJson(lang: Language, theme: Theme) {
  await configService.saveJSON(CONFIG_FILENAME, { language: lang, theme }, CONFIG_STORAGE_KEY)
}

async function loadFromJson(): Promise<{ language: Language; theme: Theme } | null> {
  const data = await configService.loadJSON<{ language: Language; theme: Theme }>(CONFIG_FILENAME, CONFIG_STORAGE_KEY)
  if (data && data.language && data.theme) {
    if (data.language === 'zh' || data.language === 'en') {
      if (data.theme === 'dark' || data.theme === 'light' || data.theme === 'blue') {
        return data as { language: Language; theme: Theme }
      }
    }
  }
  return null
}

export const useSettingsStore = defineStore('settings', () => {
  const language = computed<Language>(() => i18n.global.locale.value as Language)

  const initialTheme = loadTheme()
  applyTheme(initialTheme)
  const theme = ref<Theme>(initialTheme)

  async function initFromJson() {
    const data = await loadFromJson()
    if (data) {
      if (data.language !== i18n.global.locale.value) {
        i18n.global.locale.value = data.language
        saveLanguage(data.language)
      }
      if (data.theme !== theme.value) {
        theme.value = data.theme
        applyTheme(data.theme)
        saveTheme(data.theme)
      }
    } else {
      await persistToJson(language.value, theme.value)
    }
  }

  function setLanguage(lang: Language) {
    i18n.global.locale.value = lang
    saveLanguage(lang)
    persistToJson(lang, theme.value)
  }

  function setTheme(t: Theme) {
    theme.value = t
    applyTheme(t)
    saveTheme(t)
    persistToJson(language.value, t)
  }

  return { language, theme, setLanguage, setTheme, initFromJson }
})
