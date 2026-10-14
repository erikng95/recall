// Cloudflare Workers entry point. Everything lives in worker.ts; tests build the same Worker with a
// local vault instead (test/).

import { createWorker, githubVaultStorage } from './worker.ts';

export default createWorker({ storage: (env) => githubVaultStorage(env) });
