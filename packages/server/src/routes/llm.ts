import { Router, Request, Response } from 'express';
import { LLMGateway, type LLMProvider, createLogger, LOG_CATEGORY } from '@openwork/agent';

const log = createLogger(LOG_CATEGORY.GATEWAY);

export function createLLMRouter(gateway: LLMGateway) {
  const router = Router();

  router.get('/providers', (_req: Request, res: Response) => {
    try {
      const providers = gateway.listProviders();
      const activeProvider = gateway.getActiveProvider();
      res.json({ providers, activeProviderId: activeProvider?.id || '' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/providers', (req: Request, res: Response) => {
    try {
      const { name, apiUrl, apiKey, model, enabled } = req.body;
      if (!apiUrl) {
        res.status(400).json({ error: 'apiUrl is required' });
        return;
      }
      const provider: Omit<LLMProvider, 'id'> = {
        name: name || 'Unnamed',
        apiUrl,
        apiKey: apiKey || '',
        model: model || '',
        enabled: enabled !== false,
      };
      const entry = gateway.addProvider(provider);
      res.status(201).json(entry);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.put('/providers/:id', (req: Request, res: Response) => {
    try {
      const updated = gateway.updateProvider(req.params.id, req.body);
      if (!updated) {
        res.status(404).json({ error: 'Provider not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete('/providers/:id', (req: Request, res: Response) => {
    try {
      const ok = gateway.deleteProvider(req.params.id);
      if (!ok) {
        res.status(404).json({ error: 'Provider not found' });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/providers/:id/set-active', (req: Request, res: Response) => {
    try {
      const ok = gateway.setActiveProvider(req.params.id);
      if (!ok) {
        res.status(404).json({ error: 'Provider not found' });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/providers/:id/test', async (req: Request, res: Response) => {
    try {
      const provider = gateway.getProvider(req.params.id);
      if (!provider) {
        res.status(404).json({ error: 'Provider not found' });
        return;
      }

      const apiUrl = req.body.apiUrl || provider.apiUrl;
      const apiKey = req.body.apiUrl ? req.body.apiKey : provider.apiKey;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const startMs = Date.now();

      try {
        const modelsResp = await fetch(`${apiUrl}/models`, { headers });
        if (modelsResp.ok) {
          const data = await modelsResp.json() as any;
          const models = (data.data && Array.isArray(data.data))
            ? data.data.map((m: any) => m.id || m.name).filter(Boolean)
            : [];
          log.info(`Provider test OK (OpenAI): id=${req.params.id}, url=${apiUrl}, ${models.length} models, ${Date.now() - startMs}ms`);
          res.json({ success: true, models });
          return;
        }
      } catch { /* ignore */ }

      try {
        const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
        const ollamaResp = await fetch(`${baseUrl}/api/tags`, { headers });
        if (ollamaResp.ok) {
          const data = await ollamaResp.json() as any;
          const models = (data.models && Array.isArray(data.models))
            ? data.models.map((m: any) => m.name || m.id).filter(Boolean)
            : [];
          log.info(`Provider test OK (Ollama): id=${req.params.id}, url=${baseUrl}, ${models.length} models, ${Date.now() - startMs}ms`);
          res.json({ success: true, models });
          return;
        }
      } catch { /* ignore */ }

      log.warn(`Provider test failed: id=${req.params.id}, url=${apiUrl}`);
      res.json({ success: false, error: 'Unable to connect or fetch models' });
    } catch (err) {
      log.error(`Provider test error: id=${req.params.id}, ${String(err)}`);
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
