import { passwordHash } from '../lib/core.mjs';
import { loadKey } from './key.mjs';
import { fileURLToPath } from 'node:url';
process.env.NODE_ENV = 'development'; process.env.PORT = process.env.PORT || '18093'; process.env.PUBLIC_ORIGIN = `http://127.0.0.1:${process.env.PORT}`;
process.env.ROBOT_PASSWORD_HASH = passwordHash('robot-local-test'); process.env.ROBOT_DB = fileURLToPath(new URL('../qa-output/dev.db',import.meta.url));
if (process.env.ROBOT_KEY_SOURCE) process.env.OPENAI_API_KEY = loadKey();
await import('../server.mjs');
