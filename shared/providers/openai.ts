import type { AiProviderClient } from './base';
import type { RepoMetadata } from '../github';
import { buildPrompt } from './base';

export class OpenAIClient implements AiProviderClient {
  readonly name = 'OpenAI';

  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async categorize(metadata: RepoMetadata, owner: string, repo: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You categorize GitHub repositories. Respond with ONLY the category name, no explanation.',
          },
          { role: 'user', content: buildPrompt(metadata, owner, repo) },
        ],
        max_tokens: 20,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    if (!data.choices?.[0]?.message?.content) {
      throw new Error('OpenAI returned empty response');
    }
    return data.choices[0].message.content.trim();
  }

  async listModels(): Promise<string[]> {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data.data)) return [];

    return data.data
      .map((m: { id: string }) => m.id)
      .filter(
        (id: string) =>
          id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3'),
      )
      .sort();
  }
}
