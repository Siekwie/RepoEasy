// Runs the API server and the Vite dev server together: `npm run dev`.
import { spawn } from 'node:child_process';

const procs = ['dev:server', 'dev:web'].map((script) =>
  spawn('npm', ['run', script], { stdio: 'inherit', shell: true }),
);

const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', stop));
