#!/usr/bin/env node
import { Command } from 'commander';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createServer } from '../src/server.js';
import { getAllSessions, cleanEndedSessions } from '../src/services/session-store.js';
import { deleteLogs } from '../src/services/log-store.js';
import { startProcessScanner } from '../src/services/process-scanner.js';
import { DATA_DIR, DEFAULT_PORT } from '../src/config.js';

const STATUS_ICONS: Record<string, string> = {
  active: '🟢',
  waiting_input: '🟡',
  waiting_permission: '🟠',
  ended: '⚪',
  disconnected: '🔴',
};

const PID_FILE = path.join(DATA_DIR, 'server.pid');
const LOG_FILE = path.join(DATA_DIR, 'server.log');

function savePortToConfig(port: number) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const cfgPath = path.join(DATA_DIR, 'config.json');
  const cfg = fs.existsSync(cfgPath)
    ? JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
    : { logRetentionDays: 30, autoOpenBrowser: true, sessionTimeoutMinutes: 60 };
  cfg.port = port;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}
const CLAUDE_SETTINGS = path.join(process.env.HOME || '~', '.claude', 'settings.json');
// In dev: bin/ → ../hooks/  In dist: dist/bin/ → ../../hooks/
const HOOK_SRC_DEV = path.join(import.meta.dirname, '..', 'hooks', 'dashboard-hook.sh');
const HOOK_SRC_DIST = path.join(import.meta.dirname, '..', '..', 'hooks', 'dashboard-hook.sh');
const HOOK_SRC = fs.existsSync(HOOK_SRC_DEV) ? HOOK_SRC_DEV : HOOK_SRC_DIST;
const HOOK_DEST = path.join(process.env.HOME || '~', '.claude', 'hooks', 'dashboard-hook.sh');

const HOOK_EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'PostToolUse', 'Notification',
];

const program = new Command();

program
  .name('claude-dash')
  .description('Monitor multiple Claude Code sessions')
  .version('0.1.0');

program
  .command('init')
  .description('Register hooks and initialize data directory')
  .action(() => {
    // 1. Copy hook script
    const hookDir = path.dirname(HOOK_DEST);
    fs.mkdirSync(hookDir, { recursive: true });
    fs.copyFileSync(HOOK_SRC, HOOK_DEST);
    fs.chmodSync(HOOK_DEST, '755');
    console.log(`✓ hook 스크립트 복사: ${HOOK_DEST}`);

    // 2. Register hooks in settings.json
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(CLAUDE_SETTINGS)) {
      settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf-8'));
    }

    const hooks = (settings.hooks || {}) as Record<string, unknown[]>;
    const hookEntry = { type: 'command', command: HOOK_DEST };
    let added = 0;

    for (const event of HOOK_EVENTS) {
      if (!hooks[event]) hooks[event] = [];
      const entries = hooks[event] as Array<{ matcher: string; hooks: Array<{ command: string }> }>;

      const alreadyRegistered = entries.some(
        e => e.hooks?.some(h => h.command === HOOK_DEST)
      );

      if (!alreadyRegistered) {
        entries.push({ matcher: '', hooks: [hookEntry] });
        added++;
      }
    }

    settings.hooks = hooks;
    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
    console.log(`✓ settings.json에 hooks 등록 완료 (${added}개 추가)`);
    console.log(`  - ${HOOK_EVENTS.join(', ')}`);

    // 3. Create data directory
    fs.mkdirSync(path.join(DATA_DIR, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });

    const configPath = path.join(DATA_DIR, 'config.json');
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify({
        port: DEFAULT_PORT,
        logRetentionDays: 30,
        autoOpenBrowser: true,
        sessionTimeoutMinutes: 60,
      }, null, 2));
    }
    console.log(`✓ 데이터 디렉토리 생성: ${DATA_DIR}`);
    console.log(`\n대시보드 준비 완료! \`claude-dash start\` 로 시작하세요.`);
  });

program
  .command('start')
  .description('Start the dashboard server (background by default)')
  .option('-p, --port <port>', 'Port number', String(DEFAULT_PORT))
  .option('--foreground', 'Run in foreground (default: background)')
  .action(async (opts) => {
    const port = Number(opts.port);

    // Background mode: spawn detached child with --foreground flag
    if (!opts.foreground) {
      // Check if server is already running
      if (fs.existsSync(PID_FILE)) {
        const pid = Number(fs.readFileSync(PID_FILE, 'utf-8').trim());
        try {
          process.kill(pid, 0); // signal 0 = check if alive
          console.log(`서버가 이미 실행 중입니다 (PID: ${pid}). 먼저 \`claude-dash stop\` 으로 중지하세요.`);
          return;
        } catch {
          // Process dead, clean up stale PID file
          fs.unlinkSync(PID_FILE);
        }
      }

      savePortToConfig(port);

      const logFd = fs.openSync(LOG_FILE, 'a');
      const args = ['start', '-p', String(port), '--foreground'];

      // Use tsx in dev, node in production
      const scriptPath = import.meta.filename;
      const isTsx = scriptPath.endsWith('.ts');
      const cmd = isTsx ? 'tsx' : 'node';
      const spawnArgs = isTsx ? [scriptPath, ...args] : [scriptPath, ...args];

      const child = spawn(cmd, spawnArgs, {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env },
      });

      child.unref();
      console.log(`✓ 대시보드 서버 백그라운드 시작: http://localhost:${port} (PID: ${child.pid})`);
      console.log(`  로그: ${LOG_FILE}`);
      process.exit(0);
    }

    // Foreground mode: actual server startup
    const app = await createServer(port);
    startProcessScanner();

    // Clean ended sessions older than 24 hours
    const { deleted } = cleanEndedSessions();
    if (deleted > 0) console.log(`✓ 종료된 세션 ${deleted}개 정리`);

    // Auto-clean old logs based on logRetentionDays
    const configPath = path.join(DATA_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const retentionDays = config.logRetentionDays || 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - retentionDays);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      const logResult = deleteLogs(cutoffStr);
      if (logResult.deletedDays > 0) {
        console.log(`✓ ${retentionDays}일 이전 로그 정리: ${logResult.deletedDays}일분 (${logResult.deletedFiles}개 파일)`);
      }
    }

    savePortToConfig(port);

    await app.listen({ port, host: '0.0.0.0' });

    // Write PID file
    fs.writeFileSync(PID_FILE, String(process.pid));

    console.log(`Dashboard server running at http://localhost:${port} (PID: ${process.pid})`);
  });

program
  .command('stop')
  .description('Stop the dashboard server')
  .action(() => {
    if (!fs.existsSync(PID_FILE)) {
      console.log('서버가 실행 중이 아닙니다.');
      return;
    }

    const pid = Number(fs.readFileSync(PID_FILE, 'utf-8').trim());
    try {
      process.kill(pid, 'SIGTERM');
      fs.unlinkSync(PID_FILE);
      console.log(`✓ 서버 종료 (PID: ${pid})`);
    } catch {
      fs.unlinkSync(PID_FILE);
      console.log(`PID ${pid} 프로세스를 찾을 수 없습니다. PID 파일을 정리했습니다.`);
    }
  });

program
  .command('status')
  .description('Show current session statuses')
  .action(() => {
    const sessions = getAllSessions();
    if (sessions.length === 0) {
      console.log('No sessions found.');
      return;
    }
    for (const s of sessions) {
      const icon = STATUS_ICONS[s.status] || '❓';
      const idle = s.idleSince
        ? `⏱ idle ${formatDuration(Date.now() - new Date(s.idleSince).getTime())}`
        : '';
      const info = s.lastToolUsed
        ? `${s.lastToolUsed}`
        : s.lastPrompt
          ? `💬 "${truncate(s.lastPrompt, 40)}"`
          : s.status;
      console.log(`${icon} ${s.projectName.padEnd(20)} ${s.cwd.padEnd(35)} ${idle.padEnd(15)} ${info}`);
    }
  });

program
  .command('clean')
  .description('Clean old logs and ended sessions')
  .option('--before <date>', 'Delete logs before this date (YYYY-MM-DD)')
  .option('--days <days>', 'Delete logs older than N days', '30')
  .action((opts) => {
    let cutoffStr: string;
    if (opts.before) {
      cutoffStr = opts.before;
    } else {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - Number(opts.days));
      cutoffStr = cutoff.toISOString().split('T')[0];
    }

    const logResult = deleteLogs(cutoffStr);
    console.log(`✓ ${cutoffStr} 이전 로그 삭제: ${logResult.deletedDays}일분 (${logResult.deletedFiles}개 파일)`);

    const { deleted } = cleanEndedSessions();
    if (deleted > 0) console.log(`✓ 종료된 세션 ${deleted}개 정리`);

    if (logResult.deletedDays === 0 && deleted === 0) {
      console.log('정리할 항목이 없습니다.');
    }
  });

program
  .command('open')
  .description('Start server and open dashboard in browser')
  .option('-p, --port <port>', 'Port number', String(DEFAULT_PORT))
  .action(async (opts) => {
    const port = Number(opts.port);

    // Background start + open browser
    if (fs.existsSync(PID_FILE)) {
      const pid = Number(fs.readFileSync(PID_FILE, 'utf-8').trim());
      try {
        process.kill(pid, 0);
        // Server already running, just open browser
        const open = (await import('open')).default;
        await open(`http://localhost:${port}`);
        console.log(`Dashboard opened at http://localhost:${port} (기존 서버 사용)`);
        return;
      } catch {
        fs.unlinkSync(PID_FILE);
      }
    }

    savePortToConfig(port);

    const logFd = fs.openSync(LOG_FILE, 'a');
    const scriptPath = import.meta.filename;
    const isTsx = scriptPath.endsWith('.ts');
    const cmd = isTsx ? 'tsx' : 'node';
    const args = ['start', '-p', String(port), '--foreground'];

    const child = spawn(cmd, [scriptPath, ...args], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env },
    });

    child.unref();

    // Wait briefly for server to start, then open browser
    await new Promise(resolve => setTimeout(resolve, 1500));
    const open = (await import('open')).default;
    await open(`http://localhost:${port}`);
    console.log(`✓ 대시보드 서버 백그라운드 시작 + 브라우저 열기: http://localhost:${port} (PID: ${child.pid})`);
    process.exit(0);
  });

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}:${String(remainSecs).padStart(2, '0')}`;
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

program.parse();
