import type { RepoMetadata } from '../github';

export interface AiProviderClient {
  readonly name: string;
  categorize(metadata: RepoMetadata, owner: string, repo: string, existingLists: string[]): Promise<string>;
  listModels?(): Promise<string[]>;
}

export function buildPrompt(metadata: RepoMetadata, owner: string, repo: string, existingLists: string[]): string {
  const listsSection = existingLists.length > 0
    ? `Existing star lists: ${existingLists.join(', ')}\nIf this repository clearly belongs in one of these existing lists, return that exact list name. Otherwise, suggest a new concise single-word or two-word category.`
    : 'Suggest a concise single-word or two-word category.';

  return `Categorize this GitHub repository into a single concise category.

${listsSection}

Repository: ${owner}/${repo}
Description: ${metadata.description || 'N/A'}
Language: ${metadata.language || 'N/A'}
Topics: ${metadata.topics.join(', ') || 'N/A'}

Respond with ONLY the category name, no explanation or punctuation.`;
}
