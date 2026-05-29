import { describe, it, expect, vi } from "vitest";
import { categorizeRepository } from "@/shared/categorizer";
import type { AiProviderClient } from "@/shared/providers/base";
import type { RepoMetadata } from "@/shared/github";

describe("categorizeRepository", () => {
  const metadata: RepoMetadata = {
    description: "A CLI tool",
    language: "Go",
    topics: ["cli"],
  };

  it("calls client.categorize with all arguments", async () => {
    const mockClient: AiProviderClient = {
      name: "test",
      categorize: vi.fn().mockResolvedValue("CLI Tool"),
    };

    const result = await categorizeRepository(
      mockClient,
      metadata,
      "owner",
      "repo",
      ["DevOps", "Frontend"],
    );

    expect(result).toBe("CLI Tool");
    expect(mockClient.categorize).toHaveBeenCalledWith(
      metadata,
      "owner",
      "repo",
      ["DevOps", "Frontend"],
    );
  });

  it("returns the category from the client", async () => {
    const mockClient: AiProviderClient = {
      name: "test",
      categorize: vi.fn().mockResolvedValue("AI Library"),
    };

    const result = await categorizeRepository(
      mockClient,
      metadata,
      "owner",
      "repo",
      [],
    );

    expect(result).toBe("AI Library");
  });

  it("passes empty existingLists correctly", async () => {
    const mockClient: AiProviderClient = {
      name: "test",
      categorize: vi.fn().mockResolvedValue("New Category"),
    };

    const result = await categorizeRepository(
      mockClient,
      metadata,
      "owner",
      "repo",
      [],
    );

    expect(result).toBe("New Category");
    expect(mockClient.categorize).toHaveBeenCalledWith(
      metadata,
      "owner",
      "repo",
      [],
    );
  });
});
