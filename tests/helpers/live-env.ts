import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/*
 * Imported for its side effect, BEFORE lib/live/store: the store reads its
 * data directory at module load, and tests must never write into .data/.
 */
process.env.SNAILRACE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'snailrace-live-'));
