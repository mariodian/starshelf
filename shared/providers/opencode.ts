import type { AiProviderClient } from './base';
import type { RepoMetadata } from '../github';
import { buildPrompt } from './base';

// OpenCode Zen and Go use an OpenAI-compatible chat completions API.
// Model IDs follow the pattern provider_id/model_id (e.g. opencode/gpt-5.1-codex).
// Endpoints:
//   Zen:  https://opencode.ai/zen/v1/chat/completions
//   Go:   https://opencode.ai/zen/go/v1/chat/completions
// Note: Some Go models (MiniMax, Qwen) use the Anthropic /messages endpoint.
// For those, configure the model manually and switch the endpoint in settings.

export class OpenCodeClient implements AiProviderClient {
  readonly name = 'OpenCode';

  constructor(
    private apiKey: string,
    private model: string,
    private endpoint: 'zen' | 'zen-go' = 'zen',
  ) {}

  get baseUrl(): string {
    return this.endpoint === 'zen-go'
      ? 'https://opencode.ai/zen/go/v1'
      : 'https://opencode.ai/zen/v1';
  }

  async categorize(metadata: RepoMetadata, owner: string, repo: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
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
      throw new Error(`OpenCode API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    if (!data.choices?.[0]?.message?.content) {
      throw new Error('OpenCode returned empty response');
    }
    return data.choices[0].message.content.trim();
  }
}
