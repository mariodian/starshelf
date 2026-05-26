export interface RepoInfo {
  owner: string;
  repo: string;
  fullName: string;
}

export function parseRepoFromUrl(url: string): RepoInfo | null {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  const [, owner, repo] = match;
  return { owner, repo: repo.replace(/\/$/, ''), fullName: `${owner}/${repo.replace(/\/$/, '')}` };
}

export function isRepoPage(url: string): boolean {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/);
  return !!match;
}

export interface RepoMetadata {
  description?: string;
  language?: string;
  topics: string[];
  readmeExcerpt?: string;
}

export async function fetchRepoMetadata(
  owner: string,
  repo: string,
  token?: string,
): Promise<RepoMetadata> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (token) {
    headers.Authorization = `token ${token}`;
  }

  // Do not use Promise.all: the topics endpoint requires the mercy-preview header
  // which can cause 415 if sent to the main repo endpoint. Separate them.
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  const repoData = repoRes.ok ? await repoRes.json() : {};

  let topics: string[] = [];
  try {
    const topicsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/topics`, {
      headers: { ...headers, Accept: 'application/vnd.github.mercy-preview+json' },
    });
    if (topicsRes.ok) {
      const data = await topicsRes.json();
      topics = data.names || [];
    }
  } catch {
    // topics fetch is best-effort
  }

  return {
    description: repoData.description,
    language: repoData.language,
    topics,
    readmeExcerpt: undefined,
  };
}

export async function checkStarStatus(
  owner: string,
  repo: string,
  token: string,
): Promise<boolean> {
  const res = await fetch(`https://api.github.com/user/starred/${owner}/${repo}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  return res.status === 204;
}
