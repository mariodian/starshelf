import type { AiProviderClient } from "./providers/base";
import type { RepoMetadata } from "./github";

export async function categorizeRepository(
  client: AiProviderClient,
  metadata: RepoMetadata,
  owner: string,
  repo: string,
  existingLists: string[],
  enableEmojis = false,
  enableCategoryPrefix = false,
  autoFormat = true,
  previousCategories: string[] = [],
): Promise<string> {
  return client.categorize(
    metadata,
    owner,
    repo,
    existingLists,
    enableEmojis,
    enableCategoryPrefix,
    autoFormat,
    previousCategories,
  );
}
