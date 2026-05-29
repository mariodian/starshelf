import { describe, it, expect } from "vitest";
import { buildPrompt, cleanCategory } from "@/shared/providers/base";
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
    const prompt = buildPrompt(metadata, "user", "tool", [], true, false);

    expect(prompt).toContain("Prefix the list name with a relevant emoji");
  });

  it("omits emoji hint when enableEmojis is false", () => {
    const metadata: RepoMetadata = { topics: ["cli"] };
    const prompt = buildPrompt(metadata, "user", "tool", [], false, false);

    expect(prompt).not.toContain("relevant emoji");
  });

  it("auto-detects emojis when existing lists use them", () => {
    const metadata: RepoMetadata = { topics: ["cli"] };
    const prompt = buildPrompt(
      metadata,
      "user",
      "tool",
      ["🔧 Dev Tools", "🤖 AI"],
      false,
      false,
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
      false,
      false,
      false,
    );

    expect(prompt).not.toContain("relevant emoji");
  });

  it("includes category prefix format when enableCategoryPrefix is true", () => {
    const metadata: RepoMetadata = { topics: ["web"] };
    const prompt = buildPrompt(metadata, "user", "tool", [], false, true);

    expect(prompt).toContain("Category: Name");
  });

  it("omits category prefix format when enableCategoryPrefix is false", () => {
    const metadata: RepoMetadata = { topics: ["web"] };
    const prompt = buildPrompt(metadata, "user", "tool", [], false, false);

    expect(prompt).not.toContain("Category: Name");
  });

  it("auto-detects categories when existing lists use colon format", () => {
    const metadata: RepoMetadata = { topics: ["web"] };
    const prompt = buildPrompt(
      metadata,
      "user",
      "tool",
      ["Dev: Framework", "AI: Tool"],
      false,
      false,
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
      false,
      false,
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
      false,
      false,
      false,
    );

    expect(prompt).not.toContain("Category: Name");
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
