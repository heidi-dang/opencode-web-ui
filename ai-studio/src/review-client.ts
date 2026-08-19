import { MOCK_PROJECT_LIST, MOCK_SESSIONS, MOCK_PROVIDERS } from "./review-fixtures";

export class MockOpencodeClient {
  public defaultHeaders: Record<string, string> = {};
  
  constructor() {}
  
  get directories() {
    return {
      list: async () => ({ directories: MOCK_PROJECT_LIST })
    };
  }

  get sessions() {
    return {
      list: async () => ({ sessions: MOCK_SESSIONS, pagination: { total: MOCK_SESSIONS.length, hasMore: false } }),
      get: async ({ sessionID }: { sessionID: string }) => ({ session: MOCK_SESSIONS.find(s => s.id === sessionID) || MOCK_SESSIONS[0] })
    };
  }

  get models() {
    return {
      list: async () => ({ providers: MOCK_PROVIDERS, models: [] })
    };
  }
}
