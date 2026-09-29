import type { RepoMetadata } from "../github";

export interface BatchCategorizeRepo {
  nameWithOwner: string;
  owner: string;
  repo: string;
  metadata: RepoMetadata;
}

export interface CategoryStyle {
  enableEmojis: boolean;
  enableCategoryPrefix: boolean;
  autoFormat: boolean;
}

export const DEFAULT_CATEGORY_STYLE: CategoryStyle = {
  enableEmojis: false,
  enableCategoryPrefix: false,
  autoFormat: true,
};

export interface CategorizeRequest {
  metadata: RepoMetadata;
  owner: string;
  repo: string;
  existingLists: string[];
  style: CategoryStyle;
  previousCategories?: string[];
}

export interface CategorizeBatchRequest {
  repos: BatchCategorizeRepo[];
  existingLists: string[];
  style: CategoryStyle;
  previousCategories?: string[];
  signal?: AbortSignal;
}

export interface AiProviderClient {
  readonly name: string;
  categorize(request: CategorizeRequest): Promise<string>;
  categorizeBatch(
    request: CategorizeBatchRequest,
  ): Promise<Map<string, string>>;
  listModels?(): Promise<string[]>;
}

export function categoryStyle(settings: {
  enableEmojis: boolean;
  enableCategoryPrefix: boolean;
  autoFormat: boolean;
}): CategoryStyle {
  return {
    enableEmojis: settings.enableEmojis,
    enableCategoryPrefix: settings.enableCategoryPrefix,
    autoFormat: settings.autoFormat,
  };
}

function resolvedStyle(
  existingLists: string[],
  style: CategoryStyle,
): { useEmojis: boolean; useCategories: boolean } {
  const detectedEmojis = existingLists.some((list) =>
    /\p{Emoji_Presentation}/u.test(list),
  );
  const detectedCategories = existingLists.some((list) => list.includes(":"));
  return {
    useEmojis: style.enableEmojis || (style.autoFormat && detectedEmojis),
    useCategories:
      style.enableCategoryPrefix || (style.autoFormat && detectedCategories),
  };
}

const SINGLE_EMOJI =
  'Prefix the list name with a relevant emoji (e.g. "🔧 Dev: Build Tool", "🤖 AI: LLM Agent", "🔒 Security: Secrets").';
const BATCH_EMOJI =
  "Prefix each list name with a relevant emoji (e.g. 🔧 Dev, 🤖 AI, 🔒 Security).";

const SINGLE_CATEGORY =
  'Use the format "Category: Name" (e.g. "Dev: JS Framework", "Dev: CSS Library", "Dev: Build Tool", "Dev: Testing", "AI: Dev Tools", "AI: LLM Agent", "AI: Chatbot UI", "Infra: Docker", "Infra: Monitoring", "Infra: CI/CD", "Data: Visualization", "Data: Database", "Security: Secrets", "Bitcoin: Node", "Bitcoin: Wallet", "Self-hosted: Media", "Self-hosted: Dashboard").';
const BATCH_CATEGORY =
  'Use the format "Category: Name" (e.g. "Dev: JS Framework", "AI: LLM Agent", "Infra: Docker").';

type PromptCopy = {
  emoji: string;
  category: string;
  /** Batch says "a repo"; the single prompt says "this repo". */
  repo: "this repo" | "a repo";
  /** Single-repo rejections also say to pick something different. */
  pickDifferent: boolean;
};

const SINGLE_COPY: PromptCopy = {
  emoji: SINGLE_EMOJI,
  category: SINGLE_CATEGORY,
  repo: "this repo",
  pickDifferent: true,
};

const BATCH_COPY: PromptCopy = {
  emoji: BATCH_EMOJI,
  category: BATCH_CATEGORY,
  repo: "a repo",
  pickDifferent: false,
};

function listNames(existingLists: string[]): string {
  return existingLists.join(", ");
}

/**
 * Conditional instructions shared by both prompts. Closers ("3 words",
 * plain nouns, JSON-only) stay with the caller — they are not the same text.
 */
function conditionalLines(
  existingLists: string[],
  style: CategoryStyle,
  previousCategories: string[],
  copy: PromptCopy,
): {
  emoji: string;
  style: string;
  lists: string;
  previous: string;
  category: string;
} {
  const { useEmojis, useCategories } = resolvedStyle(existingLists, style);
  const names = listNames(existingLists);
  const rejected = previousCategories.join(", ");

  return {
    emoji: useEmojis ? copy.emoji : "",
    style:
      existingLists.length > 0
        ? `Match the formatting style (emoji, prefix pattern, casing) of existing lists: ${names}, but still prefer broad names.`
        : "",
    lists:
      existingLists.length > 0
        ? `Existing star lists: ${names}. If ${copy.repo} fits an existing list, return that exact name. Otherwise, pick a new one.`
        : "",
    previous:
      previousCategories.length > 0
        ? `Previously suggested (and rejected) names: ${rejected}. Do NOT repeat any of these names.${copy.pickDifferent ? " Pick something different." : ""}`
        : "",
    category: useCategories ? copy.category : "",
  };
}

function joinParagraphs(lines: string[]): string {
  return lines.filter((line) => line.length > 0).join("\n\n");
}

export function buildPrompt(
  metadata: RepoMetadata,
  owner: string,
  repo: string,
  existingLists: string[],
  style: CategoryStyle = DEFAULT_CATEGORY_STYLE,
  previousCategories: string[] = [],
): string {
  const lines = conditionalLines(
    existingLists,
    style,
    previousCategories,
    SINGLE_COPY,
  );
  const category = lines.category ? `${lines.category} ` : "";

  return unwrap(
    trimNewlines(`
Assign a single list name to this GitHub repository for organizing GitHub stars.
Repository: ${owner}/${repo}
Description: ${metadata.description || "N/A"}
Language: ${metadata.language || "N/A"}
Topics: ${metadata.topics.join(", ") || "N/A"}

${joinParagraphs([lines.emoji, lines.style, lines.lists, lines.previous])}

Use at most 3 words total, not counting the emoji. ${category}Otherwise use plain nouns (e.g. "CLI Tool", "Browser Extension"). Prefer broad categories that could group 5+ similar repos. Name the type of tool, not the specific technique it uses — "AI: Dev Tools" is better than "AI: Context Compression".
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

export function buildBatchPrompt(
  repos: BatchCategorizeRepo[],
  existingLists: string[],
  style: CategoryStyle = DEFAULT_CATEGORY_STYLE,
  previousCategories: string[] = [],
): string {
  const lines = conditionalLines(
    existingLists,
    style,
    previousCategories,
    BATCH_COPY,
  );
  const repoList = repos
    .map(
      (r) =>
        `${r.nameWithOwner}
  Description: ${r.metadata.description || "N/A"}
  Language: ${r.metadata.language || "N/A"}
  Topics: ${r.metadata.topics.join(", ") || "N/A"}`,
    )
    .join("\n\n---\n\n");

  return unwrap(
    trimNewlines(`
Assign a single list name to each GitHub repository for organizing GitHub stars.

${joinParagraphs([lines.lists, lines.style, lines.emoji, lines.category, lines.previous])}

Repositories:

${repoList}

Use at most 3 words per name. Prefer broad categories that could group 5+ similar repos. Name the type of tool, not the specific technique it uses.
Return ONLY a JSON object mapping repository full names (exactly as provided) to category names. Like:
{"owner/repo": "Category Name", "owner/repo2": "Another Category"}

Output ONLY the JSON. No explanation, no markdown fences. Just the JSON object.
`),
  );
}

export function parseBatchResponse(raw: string): Map<string, string> {
  let json = raw.trim();

  const codeBlockMatch = json.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    json = codeBlockMatch[1].trim();
  }

  const startIdx = json.indexOf("{");
  const endIdx = json.lastIndexOf("}");
  if (startIdx !== -1 && endIdx > startIdx) {
    json = json.slice(startIdx, endIdx + 1);
  }

  const parsed = JSON.parse(json);

  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      map.set(key, cleanCategory(value));
    }
  }

  if (map.size === 0) {
    throw new Error("No valid categories in batch response");
  }

  return map;
}
