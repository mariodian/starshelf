import type { RepoMetadata } from '../github';

export interface AiProviderClient {
  readonly name: string;
  categorize(metadata: RepoMetadata, owner: string, repo: string, existingLists: string[]): Promise<string>;
  listModels?(): Promise<string[]>;
}

export function buildPrompt(metadata: RepoMetadata, owner: string, repo: string, existingLists: string[]): string {
  const styleHint = existingLists.length > 0
    ? `Match the formatting of existing categories: ${existingLists.join(', ')}.`
    : '';

  const listsSection = existingLists.length > 0
    ? `Existing star lists: ${existingLists.join(', ')}\nIf this repo fits an existing list, return that exact name. Otherwise, pick a new one.`
    : '';

  return `Assign a single category label to this GitHub repository:

Repository: ${owner}/${repo}
Description: ${metadata.description || 'N/A'}
Language: ${metadata.language || 'N/A'}
Topics: ${metadata.topics.join(', ') || 'N/A'}
${styleHint}
${listsSection}
Use at most 2 words, category nouns only (e.g. "CLI Tool", "Tax Automation"). No verbs, no articles, no prepositions.

Output ONLY the category label. Not the instructions, not examples — only the label.`;
}

export function cleanCategory(raw: string): string {
  const firstLine = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? '';

  return firstLine
    .replace(/^(?:a|an|the|is|this|that|it)\s+/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
