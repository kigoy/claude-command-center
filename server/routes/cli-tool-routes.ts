import type { Application } from 'express';
import {
  createCliTool,
  duplicateCliTool,
  getCliTool,
  listCliTools,
  reorderCliTools,
  setCliToolEnabled,
  updateCliTool,
} from '../cli-tools.js';

export function registerCliToolRoutes(app: Application): void {
  app.get('/api/cli-tools', (req, res) => {
    const enabledOnly = req.query.enabledOnly === '1';
    res.json(listCliTools({ enabledOnly }));
  });

  app.get('/api/cli-tools/:id', (req, res) => {
    const tool = getCliTool(req.params.id);
    if (!tool) {
      res.status(404).json({ error: 'CLI tool not found' });
      return;
    }
    res.json(tool);
  });

  app.post('/api/cli-tools', (req, res) => {
    try {
      const tool = createCliTool(req.body);
      res.status(201).json(tool);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/cli-tools/reorder', (req, res) => {
    const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : null;
    if (!orderedIds) {
      res.status(400).json({ error: 'orderedIds is required' });
      return;
    }
    try {
      res.json(reorderCliTools(orderedIds));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/cli-tools/:id/duplicate', (req, res) => {
    try {
      res.status(201).json(duplicateCliTool(req.params.id));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  app.patch('/api/cli-tools/:id/enabled', (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    try {
      res.json(setCliToolEnabled(req.params.id, req.body.enabled));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  app.patch('/api/cli-tools/:id', (req, res) => {
    try {
      res.json(updateCliTool(req.params.id, req.body));
    } catch (err: any) {
      const status = /not found/i.test(err.message) ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  });
}
