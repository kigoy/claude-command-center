import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
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

export interface ProjectScanCandidate {
  id: string;
  name: string;
  path: string;
  alreadyConfigured: boolean;
  configuredProjectId: string | null;
  hasGit: boolean;
  hasClaudeMd: boolean;
  hasSprints: boolean;
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

function saveConfig(config: GstackConfig): void {
  config.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(CONFIG_PATH, yaml.dump(config, { lineWidth: -1, noRefs: true }));
  reload();
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

  saveConfig(config);
}

/** Update a project's path in config.yaml and reload. */
export function updateProjectPath(id: string, newPath: string): void {
  const config = loadConfig();
  if (!config) throw new Error('Could not load config.yaml');
  if (!config.projects[id]) throw new Error(`Project '${id}' not found`);
  config.projects[id].path = newPath;
  saveConfig(config);
}

function setProjectGroups(config: GstackConfig, projectId: string, groupIds: string[]) {
  const normalized = [...new Set(groupIds)].filter((groupId) => !!config.groups?.[groupId]);
  config.groups ||= {};

  for (const group of Object.values(config.groups)) {
    group.projects = group.projects.filter((id) => id !== projectId);
  }

  for (const groupId of normalized) {
    const group = config.groups[groupId];
    if (!group.projects.includes(projectId)) {
      group.projects = [...group.projects, projectId];
    }
  }
}

export function updateProjectConfig(
  id: string,
  patch: Partial<Pick<ProjectConfig, 'path' | 'stack' | 'has_deploy' | 'deploy_url' | 'default_qa_routing'>> & { groupIds?: string[] },
): void {
  const config = loadConfig();
  if (!config) throw new Error('Could not load config.yaml');
  if (!config.projects[id]) throw new Error(`Project '${id}' not found`);

  const project = config.projects[id];
  if (patch.path !== undefined) project.path = patch.path;
  if (patch.stack !== undefined) project.stack = patch.stack;
  if (patch.has_deploy !== undefined) project.has_deploy = patch.has_deploy;
  if (patch.deploy_url !== undefined) project.deploy_url = patch.deploy_url || undefined;
  if (patch.default_qa_routing !== undefined) project.default_qa_routing = patch.default_qa_routing;
  if (patch.groupIds) setProjectGroups(config, id, patch.groupIds);

  saveConfig(config);
}

export function createGroup(id: string, label: string): void {
  const config = loadConfig();
  if (!config) throw new Error('Could not load config.yaml');
  config.groups ||= {};
  if (config.groups[id]) throw new Error(`Group '${id}' already exists`);

  config.groups[id] = { label, projects: [] };
  saveConfig(config);
}

export function updateGroup(id: string, patch: { label?: string; projects?: string[] }): void {
  const config = loadConfig();
  if (!config) throw new Error('Could not load config.yaml');
  if (!config.groups?.[id]) throw new Error(`Group '${id}' not found`);

  if (patch.label !== undefined) {
    config.groups[id].label = patch.label;
  }
  if (patch.projects !== undefined) {
    const uniqueProjects = [...new Set(patch.projects)].filter((projectId) => !!config.projects[projectId]);
    config.groups[id].projects = uniqueProjects;
  }

  saveConfig(config);
}

export function scanProjectCandidates(basePath = '/Volumes/Extreme Pro'): ProjectScanCandidate[] {
  const configured = getProjects();
  const configuredByPath = new Map(configured.map((project) => [project.path, project.id]));

  try {
    return readdirSync(basePath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => {
        const path = join(basePath, entry.name);
        const configuredProjectId = configuredByPath.get(path) || null;
        return {
          id: entry.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || entry.name.toLowerCase(),
          name: entry.name,
          path,
          alreadyConfigured: !!configuredProjectId,
          configuredProjectId,
          hasGit: existsSync(join(path, '.git')),
          hasClaudeMd: existsSync(join(path, 'CLAUDE.md')),
          hasSprints: existsSync(join(path, '.sprints')),
        };
      })
      .filter((candidate) => candidate.hasGit || candidate.hasClaudeMd || candidate.hasSprints)
      .sort((a, b) => Number(b.hasSprints) - Number(a.hasSprints) || Number(b.hasGit) - Number(a.hasGit) || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// Initial load
reload();

// Re-read on SIGHUP
process.on('SIGHUP', () => {
  console.log('[sprint-config] SIGHUP received, reloading config');
  reload();
});
