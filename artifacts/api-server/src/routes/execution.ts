import { Router, type IRouter } from "express";
import type { Request } from "express";
import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  activityTable,
  applicationsTable,
  batchRunsTable,
  batchSettingsTable,
  db,
  documentGenerationsTable,
  executionEventsTable,
  jobsTable,
  profilesTable,
} from "@workspace/db";
import {
  GetApplicationExecutionParams,
  GetApplicationExecutionResponse,
  PrepareApplicationExecutionBody,
  PrepareApplicationExecutionParams,
  PrepareApplicationExecutionResponse,
  SubmitApplicationExecutionBody,
  SubmitApplicationExecutionParams,
  SubmitApplicationExecutionResponse,
} from "@workspace/api-zod";
import type { AuthenticatedRequest } from "../middlewares/requireAuth";
import {
  executeApplication,
  portalFromUrl,
  submitPreparedApplication,
  type ExecutionResult,
} from "../lib/application-executor";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const ownerOf = (req: Request) => (req as AuthenticatedRequest).userId;

type ActiveSession = {
  tokenHash: string;
  result: ExecutionResult;
  expiresAt: number;
};

const activeSessions = new Map<number, ActiveSession>();
const SESSION_TTL_MS = 15 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function getApplicationContext(applicationId: number, ownerId: string) {
  const [row] = await db
    .select({
      application: applicationsTable,
      job: jobsTable,
    })
    .from(applicationsTable)
    .innerJoin(
      jobsTable,
      and(eq(applicationsTable.jobId, jobsTable.id), eq(jobsTable.ownerId, ownerId)),
    )
    .where(and(eq(applicationsTable.id, applicationId), eq(applicationsTable.ownerId, ownerId)));
  if (!row) return undefined;

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.ownerId, ownerId))
    .limit(1);
  const [generation] = await db
    .select()
    .from(documentGenerationsTable)
    .where(
      and(
        eq(documentGenerationsTable.jobId, row.job.id),
        eq(documentGenerationsTable.ownerId, ownerId),
        eq(documentGenerationsTable.status, "approved"),
      ),
    )
    .orderBy(desc(documentGenerationsTable.version))
    .limit(1);
  return { ...row, profile, generation };
}

async function appendEvent(
  ownerId: string,
  applicationId: number,
  type: string,
  message: string,
  metadata: Record<string, unknown> = {},
) {
  return db
    .insert(executionEventsTable)
    .values({ ownerId, applicationId, type, message, metadata })
    .returning();
}

async function loadExecutionStatus(applicationId: number, ownerId: string, approvalToken: string | null = null) {
  const context = await getApplicationContext(applicationId, ownerId);
  if (!context) return undefined;
  const events = await db
    .select()
    .from(executionEventsTable)
    .where(
      and(
        eq(executionEventsTable.applicationId, applicationId),
        eq(executionEventsTable.ownerId, ownerId),
      ),
    )
    .orderBy(desc(executionEventsTable.createdAt))
    .limit(30);
  const latestMetadata = (events[0]?.metadata ?? {}) as {
    filledFields?: number;
    totalFields?: number;
    unresolvedFields?: string[];
  };
  const totalFields = Number(latestMetadata.totalFields ?? 0);
  const filledFields = Number(latestMetadata.filledFields ?? 0);
  return {
    applicationId,
    portalType: context.application.portalType,
    executionState: context.application.executionState,
    currentStep: context.application.currentStep,
    filledFields,
    totalFields,
    unresolvedFields: latestMetadata.unresolvedFields ?? (context.application.blocker ? [context.application.blocker] : []),
    requiresUserAction: context.application.requiresUserAction,
    approvalToken,
    events: events.reverse().map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

async function saveExecutionResult(
  ownerId: string,
  applicationId: number,
  result: ExecutionResult,
  approvalToken: string | null,
) {
  const state = result.executionState;
  const status =
    state === "submitted" ? "applied" :
    state === "ready_for_submit" ? "review" :
    state === "blocked" || state === "failed" ? "blocked" :
    "preparing";
  await db
    .update(applicationsTable)
    .set({
      portalType: result.portalType,
      status,
      progress: state === "submitted" ? 100 : state === "ready_for_submit" ? 90 : Math.min(85, Math.max(10, result.filledFields * 10)),
      executionState: state,
      currentStep: result.currentStep,
      blocker: state === "blocked" || state === "failed" ? result.message : null,
      lastError: state === "failed" ? result.message : null,
      approvalTokenHash: approvalToken ? hashToken(approvalToken) : null,
      requiresUserAction: result.requiresUserAction,
      submittedAt: state === "submitted" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(applicationsTable.id, applicationId), eq(applicationsTable.ownerId, ownerId)));
  await appendEvent(ownerId, applicationId, state, result.message, {
    portalType: result.portalType,
    filledFields: result.filledFields,
    totalFields: result.totalFields,
    unresolvedFields: result.unresolvedFields,
  });
}

async function executeOwnedApplication(
  ownerId: string,
  applicationId: number,
  submitAutomatically: boolean,
) {
  const context = await getApplicationContext(applicationId, ownerId);
  if (!context) throw new Error("Application not found");
  await db
    .update(applicationsTable)
    .set({
      executionState: "preparing",
      currentStep: "opening_portal",
      blocker: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(applicationsTable.id, applicationId), eq(applicationsTable.ownerId, ownerId)));
  await appendEvent(ownerId, applicationId, "started", "Opening the supported application portal.");

  let result: ExecutionResult;
  try {
    result = await executeApplication({
      application: context.application,
      job: context.job,
      profile: context.profile!,
      generation: context.generation,
      submitAutomatically,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The application portal is not supported.";
    result = {
      portalType: "unknown",
      executionState: "blocked",
      currentStep: "blocked",
      filledFields: 0,
      totalFields: 0,
      unresolvedFields: [],
      requiresUserAction: true,
      approvalToken: null,
      message,
    };
  }

  if (result.approvalToken && result.page) {
    activeSessions.set(applicationId, {
      tokenHash: hashToken(result.approvalToken),
      result,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
  }
  await saveExecutionResult(ownerId, applicationId, result, result.approvalToken);
  if (result.executionState === "submitted") {
    await db.insert(activityTable).values({
      ownerId,
      type: "application",
      title: "Application submitted",
      description: `${context.job.company} · ${context.job.title}`,
    });
  }
  return result;
}

router.post("/applications/:id/execution/prepare", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const params = PrepareApplicationExecutionParams.safeParse(req.params);
  const body = PrepareApplicationExecutionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid application execution request" });
    return;
  }
  const context = await getApplicationContext(params.data.id, ownerId);
  if (!context) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  if (!context.profile) {
    res.status(422).json({ error: "Complete your profile before applying." });
    return;
  }
  const result = await executeOwnedApplication(ownerId, params.data.id, body.data.submitAutomatically);
  const status = await loadExecutionStatus(params.data.id, ownerId, result.approvalToken);
  res.json(PrepareApplicationExecutionResponse.parse(status));
});

router.get("/applications/:id/execution", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const params = GetApplicationExecutionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const status = await loadExecutionStatus(params.data.id, ownerId);
  if (!status) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  res.json(GetApplicationExecutionResponse.parse(status));
});

router.post("/applications/:id/execution/submit", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const params = SubmitApplicationExecutionParams.safeParse(req.params);
  const body = SubmitApplicationExecutionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid application submission request" });
    return;
  }
  const context = await getApplicationContext(params.data.id, ownerId);
  const session = activeSessions.get(params.data.id);
  if (!context) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  if (
    !session ||
    session.expiresAt < Date.now() ||
    session.tokenHash !== hashToken(body.data.approvalToken) ||
    context.application.approvalTokenHash !== hashToken(body.data.approvalToken)
  ) {
    res.status(409).json({ error: "The review session expired. Prepare the application again." });
    return;
  }
  try {
    await submitPreparedApplication(session.result.page!);
    const result: ExecutionResult = {
      ...session.result,
      executionState: "submitted",
      currentStep: "submitted",
      requiresUserAction: false,
      approvalToken: null,
      message: "Application submitted through the supported portal.",
    };
    await session.result.browser?.close().catch(() => undefined);
    activeSessions.delete(params.data.id);
    await saveExecutionResult(ownerId, params.data.id, result, null);
    await db.insert(activityTable).values({
      ownerId,
      type: "application",
      title: "Application submitted",
      description: `${context.job.company} · ${context.job.title}`,
    });
    const status = await loadExecutionStatus(params.data.id, ownerId);
    res.json(SubmitApplicationExecutionResponse.parse(status));
  } catch (error) {
    logger.warn({ err: error, applicationId: params.data.id }, "Application submission stopped");
    const message = error instanceof Error ? error.message : "The portal stopped the submission.";
    await appendEvent(ownerId, params.data.id, "blocked", message);
    res.status(422).json({ error: message });
  }
});

export async function processBatchRun(ownerId: string, runId: number, applicationIds: number[], delayMinutes: number) {
  let stopped = false;
  try {
    for (let index = 0; index < applicationIds.length; index += 1) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, delayMinutes * 60_000));
      const result = await executeOwnedApplication(ownerId, applicationIds[index], true);
      if (
        result.message.toLowerCase().includes("captcha") ||
        result.message.toLowerCase().includes("mfa") ||
        result.message.toLowerCase().includes("verification code")
      ) {
        stopped = true;
        break;
      }
    }
    await db
      .update(batchRunsTable)
      .set({ status: stopped ? "stopped" : "completed" })
      .where(and(eq(batchRunsTable.id, runId), eq(batchRunsTable.ownerId, ownerId)));
  } catch (error) {
    logger.error({ err: error, runId }, "Batch execution failed");
    await db
      .update(batchRunsTable)
      .set({ status: "failed" })
      .where(and(eq(batchRunsTable.id, runId), eq(batchRunsTable.ownerId, ownerId)));
  }
}

export default router;