#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { createServer } from '../src/server.js';
import { getAllSessions } from '../src/services/session-store.js';
import { DATA_DIR, DEFAULT_PORT } from '../src/config.js';

const STATUS_ICONS: Record<string, string> = {
  active: '🟢',
  waiting_input: '🟡',
  waiting_permission: '🟠',
  ended: '⚪',
  disconnected: '🔴',
};

const PID_FILE = path.join(DATA_DIR, 'server.pid');
const CLAUDE_SETTINGS = path.join(process.env.HOME || '~', '.claude', 'settings.json');
const HOOK_SRC = path.join(import.meta.dirname, '..', 'hooks', 'dashboard-hook.sh');
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
  .description('Start the dashboard server')
  .option('-p, --port <port>', 'Port number', String(DEFAULT_PORT))
  .action(async (opts) => {
    const port = Number(opts.port);
    const app = await createServer(port);
    await app.listen({ port, host: '0.0.0.0' });

    // Write PID file
    fs.mkdirSync(DATA_DIR, { recursive: true });
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
  .command('open')
  .description('Start server and open dashboard in browser')
  .option('-p, --port <port>', 'Port number', String(DEFAULT_PORT))
  .action(async (opts) => {
    const port = Number(opts.port);
    const app = await createServer(port);
    await app.listen({ port, host: '0.0.0.0' });

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid));

    const open = (await import('open')).default;
    await open(`http://localhost:${port}`);
    console.log(`Dashboard opened at http://localhost:${port}`);
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
