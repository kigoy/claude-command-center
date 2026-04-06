import { readFileSync } from 'fs';
import yaml from 'js-yaml';

export interface ProjectConfig {
  id: string;
  path: string;
  stack: string;
  has_deploy: boolean;
  deploy_url?: string;
  default_qa_routing: string;
  worktree_root?: string;
}

interface GstackConfig {
  version: number;
  projects: Record<string, {
    path: string;
    stack: string;
    has_deploy: boolean;
    deploy_url?: string;
    default_qa_routing: string;
    worktree_root?: string;
  }>;
  notifications?: {
    enabled: boolean;
    provider: string;
    topic: string;
    events: string[];
  };
}

const CONFIG_PATH = process.env.GSTACK_CONFIG || '/Volumes/Extreme Pro/.gstack/config.yaml';

let cachedProjects: ProjectConfig[] = [];
let cachedConfig: GstackConfig | null = null;

function loadConfig(): GstackConfig | null {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = yaml.load(raw) as GstackConfig;
    if (!parsed?.projects) {
      console.warn('[sprint-config] config.yaml has no projects section');
      return null;
    }
    return parsed;
  } catch (err: any) {
    console.warn(`[sprint-config] Failed to read ${CONFIG_PATH}: ${err.message}`);
    return null;
  }
}

function parseProjects(config: GstackConfig): ProjectConfig[] {
  return Object.entries(config.projects).map(([id, proj]) => ({
    id,
    path: proj.path,
    stack: proj.stack,
    has_deploy: proj.has_deploy,
    deploy_url: proj.deploy_url,
    default_qa_routing: proj.default_qa_routing,
    worktree_root: proj.worktree_root,
  }));
}

/** Load projects from config.yaml. Caches result until reload(). */
export function getProjects(): ProjectConfig[] {
  if (cachedProjects.length === 0) {
    reload();
  }
  return cachedProjects;
}

/** Get the raw config (for notifications section, etc.) */
export function getConfig(): GstackConfig | null {
  if (!cachedConfig) {
    reload();
  }
  return cachedConfig;
}

/** Re-read config.yaml from disk. Call on SIGHUP. */
export function reload(): void {
  cachedConfig = loadConfig();
  cachedProjects = cachedConfig ? parseProjects(cachedConfig) : [];
  console.log(`[sprint-config] Loaded ${cachedProjects.length} projects from ${CONFIG_PATH}`);
}

// Initial load
reload();

// Re-read on SIGHUP
process.on('SIGHUP', () => {
  console.log('[sprint-config] SIGHUP received, reloading config');
  reload();
});
