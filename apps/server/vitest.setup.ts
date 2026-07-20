import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
// Stacks write real files to disk (docker-compose.yml), so give them an isolated
// scratch directory; the SQLite database itself runs fully in-memory (see db.ts).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'challoupe-test-'));
