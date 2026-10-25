import { readFileSync } from 'node:fs';
export function loadKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const path = process.env.ROBOT_KEY_SOURCE;
  if (!path) throw new Error('Set OPENAI_API_KEY or ROBOT_KEY_SOURCE (path to an existing env file)');
  const line = readFileSync(path, 'utf8').split(/\r?\n/).find(l => /^OPENAI_API_KEY\s*=/.test(l));
  if (!line) throw new Error('No configured key');
  return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}
