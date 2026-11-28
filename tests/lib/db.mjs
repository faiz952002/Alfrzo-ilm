// The ONLY way node tests reach the database: every call goes through tests/lib/db-guard.sh, which checks the
// environment, verifies the exact disposable test database (name + marker + local server address) and only then
// runs the SQL. Tests never pass host, port or database names; they choose an allowlisted key ('main' by default).
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'db-guard.sh');

const fmt = ({ csv = false, sep = '|', quiet = true } = {}) => [...(quiet ? ['-q'] : []), ...(csv ? ['--csv'] : ['-t', '-A', '-F', sep])];

// synchronous: returns stdout (trimmed); throws with psql's / the guard's message on any failure
export function sqlSync(script, { key = 'main', ...opts } = {}) {
  const r = spawnSync('bash', [GUARD, 'run', key, ...fmt(opts)], { input: script, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim() || `guard exit ${r.status}`);
  return r.stdout.trim();
}

// asynchronous variant (same rules)
export function sqlAsync(script, { key = 'main', ...opts } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('bash', [GUARD, 'run', key, ...fmt(opts)]);
    let out = '', err = '';
    p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d));
    p.on('close', code => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `guard exit ${code}`))));
    p.stdin.end(script);
  });
}

// other guard commands (verify / name / reset ...)
export function guard(cmd, key = 'main') {
  const r = spawnSync('bash', [GUARD, cmd, key], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim() || `guard exit ${r.status}`);
  return r.stdout.trim();
}
