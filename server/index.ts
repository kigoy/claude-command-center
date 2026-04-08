import 'dotenv/config';
import { createServer } from 'http';
import { createApp } from './app.js';
import { setupTerminalWs } from './terminal.js';
import { syncSessionsWithTmux } from './sessions.js';
import { startStatusPolling } from './status.js';
import { seedBuiltInCliTools } from './cli-tools.js';
import { startTmuxDetection } from './tmux-detect.js';
import { startSprintNotifications } from './sprint-notifications.js';
import { getProjects } from './sprint-config.js';
import { ensureProjectInstructionFiles } from './project-instructions.js';
import { markOrphanedLaunchingRows } from './batch-store.js';

const PORT = parseInt(process.env.PORT || '3100', 10);

for (const project of getProjects()) {
  try {
    ensureProjectInstructionFiles(project.path);
  } catch (err) {
    console.warn(`[instructions] Failed to sync instructions for ${project.id}: ${err}`);
  }
}

const app = createApp();
const server = createServer(app);
setupTerminalWs(server);

seedBuiltInCliTools();

const recoveredLaunchRows = markOrphanedLaunchingRows();
if (recoveredLaunchRows > 0) {
  console.warn(`[batch] Marked ${recoveredLaunchRows} orphaned launching row(s) as interrupted`);
}

syncSessionsWithTmux();
startStatusPolling();
startTmuxDetection();

server.listen(PORT, () => {
  console.log(`Sprint Command Center running on http://localhost:${PORT}`);
  startSprintNotifications();
});
