import { ref, watch } from 'vue';
import { i18n } from '../locales';
import { configService } from '../services/configService';

export interface ProviderConfig {
  id: string;
  name: string;
  apiUrl: string;
  apiKey: string;
  model: string;
}

export interface ProviderPreset {
  id: string;
  name: string;
  apiUrl: string;
  defaultModel: string;
  models: string[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiUrl: 'https://api.deepseek.com/v1',
    defaultModel: '',
    models: [],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    apiUrl: 'https://api.openai.com/v1',
    defaultModel: '',
    models: [],
  },
  {
    id: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
    apiUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: '',
    models: [],
  },
];

const CFG_FILE = 'provider-settings.json';
const STORAGE_KEY = 'openwork-providers';
const ACTIVE_KEY = 'openwork-active-provider';

async function loadProviders(): Promise<ProviderConfig[]> {
  const data = await configService.loadJSON<{ providers?: ProviderConfig[]; activeProviderId?: string }>(CFG_FILE, STORAGE_KEY);
  if (data && Array.isArray(data.providers) && data.providers.length > 0) {
    return data.providers;
  }
  return [];
}

async function loadActiveId(): Promise<string> {
  const data = await configService.loadJSON<{ activeProviderId?: string }>(CFG_FILE, STORAGE_KEY);
  return data?.activeProviderId || '';
}

async function saveProviderData(providers: ProviderConfig[], activeId: string) {
  await configService.saveJSON(CFG_FILE, { providers, activeProviderId: activeId }, STORAGE_KEY);
  localStorage.setItem(ACTIVE_KEY, activeId);
}

function createProviderSettings() {
  const providers = ref<ProviderConfig[]>([]);
  const activeId = ref<string>('');
  const activeProvider = ref<ProviderConfig | null>(null);

  let initialized = false;

  async function init() {
    if (initialized) return;
    initialized = true;
    const [loadedProviders, loadedActiveId] = await Promise.all([loadProviders(), loadActiveId()]);
    providers.value = loadedProviders;
    activeId.value = loadedActiveId || loadedProviders[0]?.id || '';
    activeProvider.value = loadedProviders.find(p => p.id === activeId.value) || loadedProviders[0] || null;
  }

  init();

  watch(providers, (val) => {
    saveProviderData(val, activeId.value);
  }, { deep: true });

  watch(activeId, (val) => {
    localStorage.setItem(ACTIVE_KEY, val);
    activeProvider.value = providers.value.find(p => p.id === val) || null;
    saveProviderData(providers.value, val);
  });

  let idCounter = 0;

  function addProvider(config: Omit<ProviderConfig, 'id'>) {
    const id = `provider_${Date.now()}_${++idCounter}`;
    const provider: ProviderConfig = { id, ...config };
    providers.value.push(provider);
    return provider;
  }

  function updateProvider(id: string, updates: Partial<Omit<ProviderConfig, 'id'>>) {
    const idx = providers.value.findIndex(p => p.id === id);
    if (idx === -1) return;
    providers.value[idx] = { ...providers.value[idx], ...updates };
  }

  function removeProvider(id: string) {
    const idx = providers.value.findIndex(p => p.id === id);
    if (idx === -1) return;
    providers.value.splice(idx, 1);
    if (activeId.value === id) {
      activeId.value = providers.value[0]?.id || '';
    }
  }

  function setActive(id: string) {
    if (providers.value.find(p => p.id === id)) {
      activeId.value = id;
    }
  }

  return {
    providers,
    activeId,
    activeProvider,
    addProvider,
    updateProvider,
    removeProvider,
    setActive,
  };
}

let instance: ReturnType<typeof createProviderSettings> | null = null;

export function useProviderSettings() {
  if (!instance) {
    instance = createProviderSettings();
  }
  return instance;
}

export async function fetchAvailableModels(apiUrl: string, apiKey: string): Promise<string[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  try {
    const res = await fetch(`${apiUrl}/models`, { headers });
    if (res.ok) {
      const data = await res.json() as any;
      if (data.data && Array.isArray(data.data)) {
        return data.data.map((m: any) => m.id || m.name).filter(Boolean);
      }
    }
  } catch { /* 忽略网络错误，尝试 Ollama 格式 */ }

  try {
    const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
    const res = await fetch(`${baseUrl}/api/tags`, { headers });
    if (res.ok) {
      const data = await res.json() as any;
      if (data.models && Array.isArray(data.models)) {
        return data.models.map((m: any) => m.name || m.id).filter(Boolean);
      }
    }
  } catch { /* 忽略 */ }

  throw new Error(i18n.global.t('providerPreset.fetchFailed'));
}
