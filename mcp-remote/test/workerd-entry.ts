// Worker entry for workerd.test.ts: the production Worker, with GitHub endpoints pointed at the fake.

import { createWorker, githubVaultStorage, type Env } from '../src/worker.ts';

type TestEnv = Env & { FAKE_GITHUB: string };

let worker: ExportedHandler<Env> | undefined;

export default {
  fetch(request, env, ctx) {
    worker ??= createWorker({
      storage: (e) => githubVaultStorage(e, env.FAKE_GITHUB),
      github: {
        authorize: `${env.FAKE_GITHUB}/login/oauth/authorize`,
        token: `${env.FAKE_GITHUB}/login/oauth/access_token`,
        user: `${env.FAKE_GITHUB}/user`,
      },
    });
    return worker.fetch!(request, env, ctx);
  },
} satisfies ExportedHandler<TestEnv>;
