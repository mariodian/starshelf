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
      "Match the formatting of existing categories: DevOps, CLI Tools",
    );
    expect(prompt).toContain("Existing star lists: DevOps, CLI Tools");
  });

  it("omits style hint and list section when no existing lists", () => {
    const metadata: RepoMetadata = { topics: [] };
    const prompt = buildPrompt(metadata, "u", "r", []);

    expect(prompt).not.toContain("Existing star lists:");
    expect(prompt).not.toContain("Match the formatting of existing categories");
  });

  it("contains the output-only instruction", () => {
    const metadata: RepoMetadata = { topics: [] };
    const prompt = buildPrompt(metadata, "u", "r", []);

    expect(prompt).toContain("Output ONLY the category label");
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
