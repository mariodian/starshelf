import type { AiProviderClient } from './providers/base';
import type { RepoMetadata } from './github';

export async function categorizeRepository(
  client: AiProviderClient,
  metadata: RepoMetadata,
  owner: string,
  repo: string,
): Promise<string> {
  return client.categorize(metadata, owner, repo);
}
