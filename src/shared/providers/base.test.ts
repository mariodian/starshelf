import { describe, it, expect } from "vitest";
import {
  buildBatchPrompt,
  buildPrompt,
  cleanCategory,
} from "@/shared/providers/base";
import type { RepoMetadata } from "@/shared/github";

describe("buildPrompt", () => {
  it("includes the repository owner and name", () => {
    const metadata: RepoMetadata = { topics: [] };
    const prompt = buildPrompt(metadata, "facebook", "react", []);

    expect(prompt).toContain("Repository: facebook/react");
  });

  it("includes description, language, and topics when provided", () => {
    const metadata: RepoMetadata = {
      description: "A JS framework",
      language: "TypeScript",
      topics: ["web", "framework"],
    };
    const prompt = buildPrompt(metadata, "vuejs", "core", []);

    expect(prompt).toContain("Description: A JS framework");
    expect(prompt).toContain("Language: TypeScript");
    expect(prompt).toContain("Topics: web, framework");
  });

  it("uses N/A for missing description and language", () => {
    const metadata: RepoMetadata = { topics: [] };
    const prompt = buildPrompt(metadata, "a", "b", []);

    expect(prompt).toContain("Description: N/A");
    expect(prompt).toContain("Language: N/A");
    expect(prompt).toContain("Topics: N/A");
  });

  it("includes existingLists as style hint when lists exist", () => {
    const metadata: RepoMetadata = { topics: ["cli"] };
    const prompt = buildPrompt(metadata, "user", "tool", [
      "DevOps",
      "CLI Tools",
    ]);

    expect(prompt).toContain(
      "Match the formatting style (emoji, prefix pattern, casing) of existing lists:",
    );
    expect(prompt).toContain("Existing star lists: DevOps, CLI Tools");
  });

  it("omits style hint and list section when no existing lists", () => {
    const metadata: RepoMetadata = { topics: [] };
    const prompt = buildPrompt(metadata, "u", "r", []);

    expect(prompt).not.toContain("Existing star lists:");
    expect(prompt).not.toContain("Match the formatting style");
  });

  it("contains the output-only instruction", () => {
    const metadata: RepoMetadata = { topics: [] };
    const prompt = buildPrompt(metadata, "u", "r", []);

    expect(prompt).toContain("Output ONLY the list name");
  });

  it("includes emoji hint when enableEmojis is true", () => {
    const metadata: RepoMetadata = { topics: ["cli"] };
    const prompt = buildPrompt(metadata, "user", "tool", [], {
      enableEmojis: true,
      enableCategoryPrefix: false,
      autoFormat: true,
    });

    expect(prompt).toContain("Prefix the list name with a relevant emoji");
  });

  it("omits emoji hint when enableEmojis is false", () => {
    const metadata: RepoMetadata = { topics: ["cli"] };
    const prompt = buildPrompt(metadata, "user", "tool", [], {
      enableEmojis: false,
      enableCategoryPrefix: false,
      autoFormat: true,
    });

    expect(prompt).not.toContain("relevant emoji");
  });

  it("auto-detects emojis when existing lists use them", () => {
    const metadata: RepoMetadata = { topics: ["cli"] };
    const prompt = buildPrompt(
      metadata,
      "user",
      "tool",
      ["🔧 Dev Tools", "🤖 AI"],
      {
        enableEmojis: false,
        enableCategoryPrefix: false,
        autoFormat: true,
      },
    );

    expect(prompt).toContain("Prefix the list name with a relevant emoji");
  });

  it("ignores detected emojis when autoFormat is off", () => {
    const metadata: RepoMetadata = { topics: ["cli"] };
    const prompt = buildPrompt(
      metadata,
      "user",
      "tool",
      ["🔧 Dev Tools", "🤖 AI"],
      {
        enableEmojis: false,
        enableCategoryPrefix: false,
        autoFormat: false,
      },
    );

    expect(prompt).not.toContain("relevant emoji");
  });

  it("includes category prefix format when enableCategoryPrefix is true", () => {
    const metadata: RepoMetadata = { topics: ["web"] };
    const prompt = buildPrompt(metadata, "user", "tool", [], {
      enableEmojis: false,
      enableCategoryPrefix: true,
      autoFormat: true,
    });

    expect(prompt).toContain("Category: Name");
  });

  it("omits category prefix format when enableCategoryPrefix is false", () => {
    const metadata: RepoMetadata = { topics: ["web"] };
    const prompt = buildPrompt(metadata, "user", "tool", [], {
      enableEmojis: false,
      enableCategoryPrefix: false,
      autoFormat: true,
    });

    expect(prompt).not.toContain("Category: Name");
  });

  it("auto-detects categories when existing lists use colon format", () => {
    const metadata: RepoMetadata = { topics: ["web"] };
    const prompt = buildPrompt(
      metadata,
      "user",
      "tool",
      ["Dev: Framework", "AI: Tool"],
      {
        enableEmojis: false,
        enableCategoryPrefix: false,
        autoFormat: true,
      },
    );

    expect(prompt).toContain("Category: Name");
  });

  it("does not auto-detect categories when existing lists lack colons", () => {
    const metadata: RepoMetadata = { topics: ["web"] };
    const prompt = buildPrompt(
      metadata,
      "user",
      "tool",
      ["DevOps", "CLI Tools"],
      {
        enableEmojis: false,
        enableCategoryPrefix: false,
        autoFormat: true,
      },
    );

    expect(prompt).not.toContain("Category: Name");
  });

  it("ignores detected categories when autoFormat is off", () => {
    const metadata: RepoMetadata = { topics: ["web"] };
    const prompt = buildPrompt(
      metadata,
      "user",
      "tool",
      ["Dev: Framework", "AI: Tool"],
      {
        enableEmojis: false,
        enableCategoryPrefix: false,
        autoFormat: false,
      },
    );

    expect(prompt).not.toContain("Category: Name");
  });
});

describe("prompt snapshots", () => {
  const metadata: RepoMetadata = {
    description: "A JS framework",
    language: "TypeScript",
    topics: ["web"],
  };
  const style = {
    enableEmojis: true,
    enableCategoryPrefix: true,
    autoFormat: false,
  };
  const lists = ["🔧 Dev: Tools", "AI: Agent"];
  const repos = [
    {
      nameWithOwner: "facebook/react",
      owner: "facebook",
      repo: "react",
      metadata,
    },
  ];

  it("locks the single-repo prompt, including the long category examples", () => {
    expect(
      buildPrompt(metadata, "facebook", "react", lists, style, ["Old Name"]),
    )
      .toBe(`Assign a single list name to this GitHub repository for organizing GitHub stars. Repository: facebook/react Description: A JS framework Language: TypeScript Topics: web

Prefix the list name with a relevant emoji (e.g. "🔧 Dev: Build Tool", "🤖 AI: LLM Agent", "🔒 Security: Secrets").

Match the formatting style (emoji, prefix pattern, casing) of existing lists: 🔧 Dev: Tools, AI: Agent, but still prefer broad names.

Existing star lists: 🔧 Dev: Tools, AI: Agent. If this repo fits an existing list, return that exact name. Otherwise, pick a new one.

Previously suggested (and rejected) names: Old Name. Do NOT repeat any of these names. Pick something different.

Use at most 3 words total, not counting the emoji. Use the format "Category: Name" (e.g. "Dev: JS Framework", "Dev: CSS Library", "Dev: Build Tool", "Dev: Testing", "AI: Dev Tools", "AI: LLM Agent", "AI: Chatbot UI", "Infra: Docker", "Infra: Monitoring", "Infra: CI/CD", "Data: Visualization", "Data: Database", "Security: Secrets", "Bitcoin: Node", "Bitcoin: Wallet", "Self-hosted: Media", "Self-hosted: Dashboard"). Otherwise use plain nouns (e.g. "CLI Tool", "Browser Extension"). Prefer broad categories that could group 5+ similar repos. Name the type of tool, not the specific technique it uses — "AI: Dev Tools" is better than "AI: Context Compression". Output ONLY the list name. No explanation, no punctuation at the end.`);
  });

  it("locks the batch prompt, including per-name wording and the short category hint", () => {
    const prompt = buildBatchPrompt(repos, lists, style, ["Old Name"]);

    expect(prompt)
      .toBe(`Assign a single list name to each GitHub repository for organizing GitHub stars.

Existing star lists: 🔧 Dev: Tools, AI: Agent. If a repo fits an existing list, return that exact name. Otherwise, pick a new one.

Match the formatting style (emoji, prefix pattern, casing) of existing lists: 🔧 Dev: Tools, AI: Agent, but still prefer broad names.

Prefix each list name with a relevant emoji (e.g. 🔧 Dev, 🤖 AI, 🔒 Security).

Use the format "Category: Name" (e.g. "Dev: JS Framework", "AI: LLM Agent", "Infra: Docker").

Previously suggested (and rejected) names: Old Name. Do NOT repeat any of these names.

Repositories:

facebook/react   Description: A JS framework   Language: TypeScript   Topics: web

Use at most 3 words per name. Prefer broad categories that could group 5+ similar repos. Name the type of tool, not the specific technique it uses. Return ONLY a JSON object mapping repository full names (exactly as provided) to category names. Like: {"owner/repo": "Category Name", "owner/repo2": "Another Category"}

Output ONLY the JSON. No explanation, no markdown fences. Just the JSON object.`);
    expect(prompt).not.toContain("3 words total");
    expect(prompt).not.toContain("Otherwise use plain nouns");
    expect(prompt).not.toContain("Prefix the list name");
  });
});

describe("cleanCategory", () => {
  it("trims and cleans a simple category", () => {
    expect(cleanCategory("CLI Tool")).toBe("CLI Tool");
  });

  it("removes leading articles", () => {
    expect(cleanCategory("a CLI Tool")).toBe("CLI Tool");
    expect(cleanCategory("an Editor")).toBe("Editor");
    expect(cleanCategory("the Framework")).toBe("Framework");
  });

  it("removes leading 'is', 'this', 'that', 'it'", () => {
    expect(cleanCategory("is CLI Tool")).toBe("CLI Tool");
    expect(cleanCategory("this is a tool")).toBe("is a tool");
  });

  it("strips special characters", () => {
    expect(cleanCategory("Front-end!")).toBe("Frontend");
    expect(cleanCategory('"DevOps"')).toBe("DevOps");
    expect(cleanCategory("ML / AI")).toBe("ML AI");
  });

  it("normalizes extra whitespace", () => {
    expect(cleanCategory("  CLI    Tool  ")).toBe("CLI Tool");
  });

  it("takes only the first non-empty line", () => {
    expect(cleanCategory("CLI Tool\nsome explanation\nmore text")).toBe(
      "CLI Tool",
    );
  });

  it("skips leading blank lines", () => {
    expect(cleanCategory("\n\n  \nCLI Tool\nother")).toBe("CLI Tool");
  });

  it("returns an empty string for empty input", () => {
    expect(cleanCategory("")).toBe("");
  });
});
