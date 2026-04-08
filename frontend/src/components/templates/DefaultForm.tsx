import { useState, useEffect } from 'react';
import { DirectoryBrowser } from '../DirectoryBrowser';

export interface TemplatePayload {
  cwd: string;
  bootstrapCommand?: string;
  worktreePath?: string;
  initialPrompt?: string;
  repo?: string;
}

interface Props {
  onPayloadChange: (payload: TemplatePayload) => void;
}

export function DefaultForm({ onPayloadChange }: Props) {
  const [cwd, setCwd] = useState('~');

  useEffect(() => {
    onPayloadChange({ cwd });
  }, [cwd, onPayloadChange]);

  return (
    <DirectoryBrowser value={cwd} onChange={setCwd} />
  );
}
