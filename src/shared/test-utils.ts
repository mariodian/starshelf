import { vi, beforeEach, afterEach } from "vitest";

export function setupFetchMock() {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
}

export function mockJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 400,
    status,
    json: async () => data,
    text: async () => (typeof data === "string" ? data : JSON.stringify(data)),
  } as Response;
}

export function mockHttpError(status: number, body = ""): Response {
  return {
    ok: false,
    status,
    text: async () => body,
  } as Response;
}

export function mockGraphqlResponse<T>(data: T): Response {
  return mockJsonResponse({ data });
}

export function mockGraphqlError(
  errors: Array<{ type?: string; message: string }>,
): Response {
  return mockJsonResponse({ data: null, errors });
}
