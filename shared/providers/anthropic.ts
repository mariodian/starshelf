import type { AiProviderClient } from './base';
import type { RepoMetadata } from '../github';
import { buildPrompt } from './base';

export class AnthropicClient implements AiProviderClient {
  readonly name = 'Anthropic';

  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async categorize(metadata: RepoMetadata, owner: string, repo: string, existingLists: string[]): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 30,
        messages: [{ role: 'user', content: buildPrompt(metadata, owner, repo, existingLists) }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    if (!data.content?.[0]?.text) {
      throw new Error('Anthropic returned empty response');
    }
    return data.content[0].text.trim();
  }
}
