import type { RepoMetadata } from '../github';

export interface AiProviderClient {
  readonly name: string;
  categorize(metadata: RepoMetadata, owner: string, repo: string): Promise<string>;
  listModels?(): Promise<string[]>;
}

export function buildPrompt(metadata: RepoMetadata, owner: string, repo: string): string {
  return `Categorize this GitHub repository into a single concise category. Choose from: "DevTools", "AI/ML", "Infrastructure", "Frontend", "Backend", "Libraries & Frameworks", "Data", "Security", "Mobile", "CLI", "Documentation", "Other".

Repository: ${owner}/${repo}
Description: ${metadata.description || 'N/A'}
Language: ${metadata.language || 'N/A'}
Topics: ${metadata.topics.join(', ') || 'N/A'}

Respond with ONLY the category name, no explanation or punctuation.`;
}
