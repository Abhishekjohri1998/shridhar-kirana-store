import path from 'node:path';
import { env } from '../env';
import { createFileRepo } from './file';
import { createMongoRepo } from './mongo';
import type { Repo } from './types';

let repo: Repo | null = null;

export async function initRepo(): Promise<Repo> {
  if (repo) return repo;
  repo = env.mongoUri
    ? await createMongoRepo(env.mongoUri)
    : await createFileRepo(env.dataDir || path.join(__dirname, '..', '..', '.data'));
  console.log('[store] using ' + (repo.kind === 'mongo' ? 'MongoDB' : 'the local JSON file'));
  return repo;
}

export function getRepo(): Repo {
  if (!repo) throw new Error('Storage is not ready yet');
  return repo;
}

export type { Repo };
