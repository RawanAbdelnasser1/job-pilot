import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const profilesTable = pgTable(
  "profiles",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    location: text("location").notNull().default(""),
    headline: text("headline").notNull().default(""),
    targetRoles: jsonb("target_roles").$type<string[]>().notNull().default([]),
    preferredLocations: jsonb("preferred_locations").$type<string[]>().notNull().default([]),
    workModes: jsonb("work_modes").$type<string[]>().notNull().default([]),
    minimumSalary: integer("minimum_salary").notNull().default(0),
    skills: jsonb("skills").$type<string[]>().notNull().default([]),
    // Evidence is kept as a JSON document so its stable IDs can be snapshotted
    // alongside every generated document.
    evidence: jsonb("evidence").$type<ProfileEvidence[]>().notNull().default([]),
    completion: integer("completion").notNull().default(0),
  },
  (table) => [uniqueIndex("profiles_owner_unique").on(table.ownerId)],
);

export type ProfileEvidence = {
  id: string;
  category: "experience" | "achievement" | "education" | "certification" | "project";
  title: string;
  organization: string;
  startDate?: string;
  endDate?: string;
  detail: string;
  source: string;
};

export type GenerationClaim = {
  section: string;
  text: string;
  evidenceIds: string[];
};

export const jobsTable = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    company: text("company").notNull(),
    title: text("title").notNull(),
    location: text("location").notNull(),
    workMode: text("work_mode").notNull(),
    salary: text("salary").notNull(),
    fitScore: integer("fit_score").notNull().default(70),
    status: text("status").notNull().default("new"),
    source: text("source").notNull(),
    sourceUrl: text("source_url").notNull().default(""),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    matchedSkills: jsonb("matched_skills").$type<string[]>().notNull().default([]),
    missingSkills: jsonb("missing_skills").$type<string[]>().notNull().default([]),
    description: text("description").notNull(),
  },
  (table) => [index("jobs_owner_idx").on(table.ownerId)],
);

export const applicationsTable = pgTable(
  "applications",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    jobId: integer("job_id").notNull().references(() => jobsTable.id),
    mode: text("mode").notNull(),
    portalType: text("portal_type").notNull().default("unknown"),
    status: text("status").notNull().default("preparing"),
    progress: integer("progress").notNull().default(20),
    executionState: text("execution_state").notNull().default("not_started"),
    currentStep: text("current_step").notNull().default("queued"),
    portalUrl: text("portal_url").notNull().default(""),
    blocker: text("blocker"),
    lastError: text("last_error"),
    approvalTokenHash: text("approval_token_hash"),
    requiresUserAction: boolean("requires_user_action").notNull().default(false),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
     lastReplyAt: timestamp("last_reply_at", { withTimezone: true }),
     lastReplyType: text("last_reply_type"),
     lastReplySubject: text("last_reply_subject"),
     lastReplySnippet: text("last_reply_snippet"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("applications_owner_job_idx").on(table.ownerId, table.jobId)],
);

export const batchSettingsTable = pgTable(
  "batch_settings",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    dailyLimit: integer("daily_limit").notNull().default(15),
    delayMinutes: integer("delay_minutes").notNull().default(8),
    minimumFitScore: integer("minimum_fit_score").notNull().default(78),
    requireReviewForSensitive: boolean("require_review_for_sensitive").notNull().default(true),
    stopOnCaptcha: boolean("stop_on_captcha").notNull().default(true),
    stopOnMfa: boolean("stop_on_mfa").notNull().default(true),
  },
  (table) => [uniqueIndex("batch_settings_owner_unique").on(table.ownerId)],
);

export const batchRunsTable = pgTable(
  "batch_runs",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    status: text("status").notNull().default("queued"),
    queuedCount: integer("queued_count").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("batch_runs_owner_idx").on(table.ownerId)],
);

export const activityTable = pgTable(
  "activity",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("activity_owner_timestamp_idx").on(table.ownerId, table.timestamp)],
);

/**
 * A generation is an immutable revision. Updates in the API create another
 * row with an incremented version instead of modifying this row.
 */
export const documentGenerationsTable = pgTable(
  "document_generations",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    jobId: integer("job_id").notNull().references(() => jobsTable.id),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    model: text("model").notNull(),
    jobSnapshot: jsonb("job_snapshot").$type<Record<string, unknown>>().notNull(),
    profileSnapshot: jsonb("profile_snapshot").$type<Record<string, unknown>>().notNull(),
    content: jsonb("content").$type<{
      cvMarkdown: string;
      coverLetterMarkdown: string;
    }>().notNull(),
    cvMarkdown: text("cv_markdown").notNull(),
    coverLetterMarkdown: text("cover_letter_markdown").notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    claims: jsonb("claims").$type<GenerationClaim[]>().notNull().default([]),
    rejectedClaims: jsonb("rejected_claims").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("document_generations_owner_idx").on(table.ownerId),
    uniqueIndex("document_generations_job_version_idx").on(table.jobId, table.version),
  ],
);

export const executionEventsTable = pgTable(
  "execution_events",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    applicationId: integer("application_id").notNull().references(() => applicationsTable.id),
    type: text("type").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("execution_events_application_idx").on(table.applicationId, table.createdAt)],
);

export const recruiterMessagesTable = pgTable(
  "recruiter_messages",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    applicationId: integer("application_id").notNull().references(() => applicationsTable.id),
    messageId: text("message_id").notNull(),
    threadId: text("thread_id").notNull(),
    sender: text("sender").notNull(),
    subject: text("subject").notNull(),
    snippet: text("snippet").notNull(),
    signalType: text("signal_type").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("recruiter_messages_owner_message_unique").on(table.ownerId, table.messageId),
    index("recruiter_messages_application_received_idx").on(table.applicationId, table.receivedAt),
  ],
);

export const aiRequestEventsTable = pgTable(
  "ai_request_events",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    requestType: text("request_type").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ai_request_events_owner_time_idx").on(table.ownerId, table.requestedAt)],
);