import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const viteBin = join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');

const commands = [
  ['api', process.execPath, ['--experimental-sqlite', 'server/index.mjs']],
  ['web', process.execPath, [viteBin, '--host', '127.0.0.1']]
];

const children = commands.map(([name, command, args]) => {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with ${code}`);
      process.exitCode = code;
      for (const other of children) {
        if (other !== child && !other.killed) other.kill('SIGTERM');
      }
    }
  });

  return child;
});

const shutdown = () => {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
