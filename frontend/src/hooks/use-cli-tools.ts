import { useCallback, useEffect, useState } from 'react';
import type { CliTool } from '../types';

const STORAGE_KEY = 'selected-cli-tool-id';

export function useCliTools() {
  const [tools, setTools] = useState<CliTool[]>([]);
  const [selectedToolId, setSelectedToolId] = useState(() => localStorage.getItem(STORAGE_KEY) || '');

  const refreshTools = useCallback(async () => {
    try {
      const res = await fetch('/api/cli-tools?enabledOnly=1');
      if (!res.ok) return;
      const nextTools = await res.json() as CliTool[];
      setTools(nextTools);
    } catch {
      // Ignore transient fetch errors.
    }
  }, []);

  useEffect(() => {
    refreshTools();
  }, [refreshTools]);

  useEffect(() => {
    if (!tools.length) return;
    const selectedStillExists = tools.some((tool) => tool.id === selectedToolId);
    if (!selectedStillExists) {
      setSelectedToolId(tools[0]?.id || '');
    }
  }, [tools, selectedToolId]);

  useEffect(() => {
    if (selectedToolId) {
      localStorage.setItem(STORAGE_KEY, selectedToolId);
    }
  }, [selectedToolId]);

  return {
    tools,
    selectedToolId,
    selectedTool: tools.find((tool) => tool.id === selectedToolId) || null,
    setSelectedToolId,
    refreshTools,
  };
}
