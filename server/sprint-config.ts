import { readFileSync, writeFileSync } from 'fs';
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

export interface GroupConfig {
  id: string;
  label: string;
  projects: string[];
}

interface GstackConfig {
  version: number;
  updated?: string;
  projects: Record<string, {
    path: string;
    stack: string;
    has_deploy: boolean;
    deploy_url?: string;
    default_qa_routing: string;
    worktree_root?: string;
  }>;
  groups?: Record<string, {
    label: string;
    projects: string[];
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
let cachedGroups: GroupConfig[] = [];
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

function parseGroups(config: GstackConfig): GroupConfig[] {
  if (!config.groups) return [];
  return Object.entries(config.groups).map(([id, group]) => ({
    id,
    label: group.label,
    projects: [...group.projects],
  }));
}

/** Load projects from config.yaml. Caches result until reload(). */
export function getProjects(): ProjectConfig[] {
  if (cachedProjects.length === 0) {
    reload();
  }
  return cachedProjects;
}

/** Get project groups from config.yaml. Caches result until reload(). */
export function getGroups(): GroupConfig[] {
  if (cachedGroups.length === 0 && !cachedConfig) {
    reload();
  }
  return cachedGroups;
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
  cachedGroups = cachedConfig ? parseGroups(cachedConfig) : [];
  console.log(`[sprint-config] Loaded ${cachedProjects.length} projects, ${cachedGroups.length} groups from ${CONFIG_PATH}`);
}

/** Add a project to config.yaml and reload. */
export function addProject(
  id: string,
  project: { path: string; stack: string; has_deploy: boolean; deploy_url?: string; default_qa_routing?: string },
  groupId?: string,
): void {
  const config = loadConfig();
  if (!config) throw new Error('Could not load config.yaml');

  config.projects[id] = {
    path: project.path,
    stack: project.stack,
    has_deploy: project.has_deploy,
    deploy_url: project.deploy_url,
    default_qa_routing: project.default_qa_routing || 'has',
  };

  if (groupId && config.groups?.[groupId]) {
    if (!config.groups[groupId].projects.includes(id)) {
      config.groups[groupId].projects = [...config.groups[groupId].projects, id];
    }
  }

  config.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(CONFIG_PATH, yaml.dump(config, { lineWidth: -1, noRefs: true }));
  reload();
}

// Initial load
reload();

// Re-read on SIGHUP
process.on('SIGHUP', () => {
  console.log('[sprint-config] SIGHUP received, reloading config');
  reload();
});
