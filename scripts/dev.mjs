import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const processes = [
  {
    name: 'server',
    child: spawn(npmCommand, ['--prefix', 'server', 'run', 'dev'], {
      stdio: 'inherit',
    }),
  },
  {
    name: 'frontend',
    child: spawn(npmCommand, ['--prefix', 'frontend', 'run', 'dev'], {
      stdio: 'inherit',
    }),
  },
];

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const { child } of processes) {
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(code), 250);
}

for (const { name, child } of processes) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
      shutdown(0);
      return;
    }

    console.error(`${name} exited with ${signal ?? `code ${code}`}`);
    shutdown(code ?? 1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
