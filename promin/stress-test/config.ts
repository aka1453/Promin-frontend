/**
 * Stress Test Configuration
 *
 * All tests run locally with zero external cost:
 * - OpenAI calls → mock server on localhost
 * - Supabase calls → either local instance or mock
 * - No real users, no real data, no real money
 */

export const CONFIG = {
  /** Target user count for SaaS readiness */
  TARGET_USERS: 10_000,

  /** Simulated concurrent users for load tests */
  CONCURRENT_USERS: 500,

  /** Total requests per load test scenario */
  TOTAL_REQUESTS: 10_000,

  /** Mock OpenAI server port */
  MOCK_OPENAI_PORT: 9876,

  /** Next.js dev server (assumed running) */
  APP_BASE_URL: "http://localhost:3000",

  /** Rate limiter config (matches production defaults) */
  RATE_LIMIT: {
    PER_USER: 20,
    PER_IP: 60,
    WINDOW_MS: 60_000,
  },

  /** Supabase realtime config */
  REALTIME: {
    /** Max channels per user (estimated from page subscriptions) */
    CHANNELS_PER_USER: 5,
    /** Average projects per user */
    PROJECTS_PER_USER: 8,
    /** Average milestones per project */
    MILESTONES_PER_PROJECT: 6,
    /** Average tasks per milestone */
    TASKS_PER_MILESTONE: 10,
    /** Average deliverables per task */
    DELIVERABLES_PER_TASK: 4,
  },

  /** Timing thresholds (ms) */
  THRESHOLDS: {
    API_P50: 200,
    API_P95: 1000,
    API_P99: 3000,
    PAGE_LOAD: 2000,
  },
} as const;

/** Per-user data volume estimate */
export function estimateDataVolume() {
  const c = CONFIG.REALTIME;
  const users = CONFIG.TARGET_USERS;

  const totalProjects = users * c.PROJECTS_PER_USER;
  const totalMilestones = totalProjects * c.MILESTONES_PER_PROJECT;
  const totalTasks = totalMilestones * c.TASKS_PER_MILESTONE;
  const totalDeliverables = totalTasks * c.DELIVERABLES_PER_TASK;
  const totalRealtimeChannels = users * c.CHANNELS_PER_USER;

  // Chat: assume 30% of users use chat, avg 5 conversations, 20 messages each
  const chatUsers = Math.floor(users * 0.3);
  const totalConversations = chatUsers * 5;
  const totalMessages = totalConversations * 20;

  // Documents: assume 20% of projects have 10 docs avg
  const totalDocuments = Math.floor(totalProjects * 0.2) * 10;

  // Project members: avg 4 members per project
  const totalMembers = totalProjects * 4;

  return {
    users,
    totalProjects,
    totalMilestones,
    totalTasks,
    totalDeliverables,
    totalRealtimeChannels,
    totalConversations,
    totalMessages,
    totalDocuments,
    totalMembers,
  };
}
