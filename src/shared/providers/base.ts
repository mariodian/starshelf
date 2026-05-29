import type { RepoMetadata } from "../github";

export interface AiProviderClient {
  readonly name: string;
  categorize(
    metadata: RepoMetadata,
    owner: string,
    repo: string,
    existingLists: string[],
    enableEmojis?: boolean,
    enableCategoryPrefix?: boolean,
    autoFormat?: boolean,
  ): Promise<string>;
  listModels?(): Promise<string[]>;
}

export function buildPrompt(
  metadata: RepoMetadata,
  owner: string,
  repo: string,
  existingLists: string[],
  enableEmojis = false,
  enableCategoryPrefix = false,
  autoFormat = true,
): string {
  const detectedEmojis =
    existingLists.length > 0 &&
    existingLists.some((l) => /\p{Emoji_Presentation}/u.test(l));

  const detectedCategories =
    existingLists.length > 0 && existingLists.some((l) => /:/.test(l));

  const useEmojis = enableEmojis || (autoFormat && detectedEmojis);
  const useCategories =
    enableCategoryPrefix || (autoFormat && detectedCategories);

  const emojiHint = useEmojis
    ? `
Prefix the list name with a relevant emoji (e.g. "🔧 Dev: Build Tool",
"🤖 AI: LLM Agent", "🔒 Security: Secrets").
`
    : "";

  const styleHint =
    existingLists.length > 0
      ? `
Match the formatting style (emoji, prefix pattern, casing) of existing lists:
${existingLists.join(", ")}, but still prefer broad names
`
      : "";

  const listsSection =
    existingLists.length > 0
      ? `
Existing star lists: ${existingLists.join(", ")}
If this repo fits an existing list, return that exact name. Otherwise, pick a new one.
`
      : "";

  const categoryPrompt = useCategories
    ? `
Use the format "Category: Name" (e.g. "Dev: JS Framework", "Dev: CSS Library",
"Dev: Build Tool", "Dev: Testing", "AI: Dev Tools", "AI: LLM Agent", "AI: Chatbot UI",
"Infra: Docker", "Infra: Monitoring", "Infra: CI/CD", "Data: Visualization",
"Data: Database", "Security: Secrets", "Bitcoin: Node", "Bitcoin: Wallet",
"Self-hosted: Media", "Self-hosted: Dashboard").
`
    : "";

  return unwrap(
    trimNewlines(`
Assign a single list name to this GitHub repository for organizing GitHub stars.
Repository: ${owner}/${repo}
Description: ${metadata.description || "N/A"}
Language: ${metadata.language || "N/A"}
Topics: ${metadata.topics.join(", ") || "N/A"}
${trimNewlines(emojiHint)}
${trimNewlines(styleHint)}
${trimNewlines(listsSection)}
Use at most 3 words total, not counting the emoji. ${trimNewlines(categoryPrompt)}
Otherwise use plain nouns (e.g. "CLI Tool", "Browser Extension").
Prefer broad categories that could group 5+ similar repos. Name the type of tool,
not the specific technique it uses — "AI: Dev Tools" is better than "AI: Context Compression".
Output ONLY the list name. No explanation, no punctuation at the end.
`),
  );
}

function trimNewlines(s: string): string {
  return s.replace(/^\n+|\n+$/g, "");
}

/**
 * Collapse single newlines (editor-enforced line wrapping) into spaces,
 * while preserving intentional paragraph breaks (double newlines).
 */
function unwrap(text: string): string {
  return text
    .replace(/([^\n])\n([^\n])/g, "$1 $2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanCategory(raw: string): string {
  const firstLine =
    raw
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";

  return firstLine
    .replace(/^(?:a|an|the|is|this|that|it)\s+/i, "")
    .replace(/[^\p{L}\p{N}\p{Emoji_Presentation}\s:]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
