import { spawn } from 'node:child_process';

const processes = [
  spawn(process.execPath, ['--env-file-if-exists=.env', '--watch', 'server/index.js'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: '4174' },
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], {
    stdio: 'inherit',
  }),
];

let exiting = false;
function stop(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const child of processes) child.kill();
  process.exitCode = code;
}

for (const child of processes) {
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code) => stop(code ?? 0));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
