export async function chatCompletion(options: {
  url: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** OpenAI uses max_completion_tokens. OpenCode uses max_tokens. */
  maxTokensField: "max_tokens" | "max_completion_tokens";
  temperature?: number;
  signal?: AbortSignal;
  providerName: string;
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
    [options.maxTokensField]: 4096,
  };
  if (options.temperature !== undefined) {
    body.temperature = options.temperature;
  }

  const response = await fetch(options.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `${options.providerName} API error ${response.status}: ${text}`,
    );
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  const text = firstNonEmpty(message?.content, message?.reasoning_content);
  if (!text) {
    throw new Error(`${options.providerName} returned empty response`);
  }
  return text;
}

function firstNonEmpty(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}
