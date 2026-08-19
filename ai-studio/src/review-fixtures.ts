export const createMockProjects = () => ({
  projects: {
    "review-local": [
      { worktree: "/mock/review/opencode-ui", expanded: true },
      { worktree: "/mock/review/backend-api", expanded: false },
    ]
  },
  lastProject: {
    "review-local": "/mock/review/opencode-ui"
  },
  recentlyClosed: {
    "review-local": ["/mock/review/old-service"]
  }
});

export const MOCK_PROJECT_LIST = [
  { path: "/mock/review/opencode-ui", isDirectory: true },
  { path: "/mock/review/backend-api", isDirectory: true }
];

export const MOCK_SESSIONS = [
  {
    id: "session-1234",
    title: "Implement Review Mock",
    updatedAt: new Date().toISOString(),
    directory: "/mock/review/opencode-ui",
    metrics: { tokens: 1500, messages: 4 }
  }
];

export const MOCK_PROVIDERS = [
  { id: "opencode-ai", name: "OpenCode AI", models: ["gpt-4", "gpt-3.5-turbo"] }
];
