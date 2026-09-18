import { Router, type IRouter } from "express";
import type { Request } from "express";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  activityTable,
  applicationsTable,
  batchRunsTable,
  batchSettingsTable,
  db,
  jobsTable,
  profilesTable,
  recruiterMessagesTable,
} from "@workspace/db";
import {
  CreateJobBody,
  CreateJobResponse,
  GetBatchSettingsResponse,
  GetDashboardResponse,
  GetJobParams,
  GetJobResponse,
  GetProfileResponse,
  ListActivityResponse,
  ListApplicationsResponse,
  ListJobsQueryParams,
  ListJobsResponse,
  PrepareApplicationBody,
  PrepareApplicationParams,
  PrepareApplicationResponse,
  StartBatchRunBody,
  StartBatchRunResponse,
  UpdateApplicationBody,
  UpdateApplicationParams,
  UpdateApplicationResponse,
  UpdateBatchSettingsBody,
  UpdateBatchSettingsResponse,
  UpdateJobBody,
  UpdateJobParams,
  UpdateJobResponse,
  UpdateProfileBody,
  UpdateProfileResponse,
} from "@workspace/api-zod";
import type { AuthenticatedRequest } from "../middlewares/requireAuth";
import { processBatchRun } from "./execution";
import {
  classifyRecruiterMessage,
  matchesApplication,
  searchRecentRecruiterMail,
} from "../lib/gmail-tracker";

const router: IRouter = Router();
const ownerOf = (req: Request) => (req as AuthenticatedRequest).userId;

const serializeJob = (job: typeof jobsTable.$inferSelect) => ({
  ...job,
  postedAt: job.postedAt.toISOString(),
});

const serializeApplication = (application: typeof applicationsTable.$inferSelect) => ({
  ...application,
  submittedAt: application.submittedAt?.toISOString() ?? null,
  lastReplyAt: application.lastReplyAt?.toISOString() ?? null,
  createdAt: application.createdAt.toISOString(),
  updatedAt: application.updatedAt.toISOString(),
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const [jobs, applicationRows, settings] = await Promise.all([
    db.select().from(jobsTable).where(eq(jobsTable.ownerId, ownerId)),
    db
      .select({ application: applicationsTable })
      .from(applicationsTable)
      .innerJoin(
        jobsTable,
        and(
          eq(applicationsTable.jobId, jobsTable.id),
          eq(applicationsTable.ownerId, ownerId),
          eq(jobsTable.ownerId, ownerId),
        ),
      ),
    db.select().from(batchSettingsTable).where(eq(batchSettingsTable.ownerId, ownerId)).limit(1),
  ]);
  const applications = applicationRows.map(({ application }) => application);

  const responded = applications.filter((item) =>
    ["assessment", "interview", "offer", "rejected"].includes(item.status),
  ).length;
  const pipelineMap = new Map<string, number>();
  applications.forEach((item) =>
    pipelineMap.set(item.status, (pipelineMap.get(item.status) ?? 0) + 1),
  );

  res.json(
    GetDashboardResponse.parse({
      jobsDiscovered: jobs.length,
      queued: jobs.filter((item) => ["new", "ready", "review"].includes(item.status)).length,
      applied: applications.filter((item) => !["preparing", "ready"].includes(item.status)).length,
      interviews: applications.filter((item) => item.status === "interview").length,
      responseRate: applications.length ? Math.round((responded / applications.length) * 100) : 0,
      dailyUsed: applications.filter(
        (item) => item.createdAt.toDateString() === new Date().toDateString(),
      ).length,
      dailyLimit: settings[0]?.dailyLimit ?? 15,
      pipeline: Array.from(pipelineMap, ([status, count]) => ({ status, count })),
    }),
  );
});

router.get("/profile", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.ownerId, ownerId)).limit(1);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(GetProfileResponse.parse(profile));
});

router.put("/profile", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const completion = Math.min(
    100,
    50 +
      parsed.data.skills.length * 4 +
      parsed.data.targetRoles.length * 5 +
      parsed.data.preferredLocations.length * 3,
  );
  const [existing] = await db.select().from(profilesTable).where(eq(profilesTable.ownerId, ownerId)).limit(1);
  const [profile] = existing
    ? await db
        .update(profilesTable)
        .set({ ...parsed.data, completion })
        .where(and(eq(profilesTable.id, existing.id), eq(profilesTable.ownerId, ownerId)))
        .returning()
    : await db.insert(profilesTable).values({ ...parsed.data, completion, ownerId }).returning();
  res.json(UpdateProfileResponse.parse(profile));
});

router.get("/jobs", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const parsed = ListJobsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const clauses = [eq(jobsTable.ownerId, ownerId)];
  if (parsed.data.status) clauses.push(eq(jobsTable.status, parsed.data.status));
  if (parsed.data.search) {
    clauses.push(
      or(
        ilike(jobsTable.title, `%${parsed.data.search}%`),
        ilike(jobsTable.company, `%${parsed.data.search}%`),
      )!,
    );
  }
  const jobs = await db
    .select()
    .from(jobsTable)
    .where(and(...clauses))
    .orderBy(desc(jobsTable.fitScore));
  res.json(ListJobsResponse.parse(jobs.map(serializeJob)));
});

router.post("/jobs", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.ownerId, ownerId)).limit(1);
  const haystack = `${parsed.data.title} ${parsed.data.description}`.toLowerCase();
  const matchedSkills = (profile?.skills ?? []).filter((skill) =>
    haystack.includes(skill.toLowerCase()),
  );
  const fitScore = Math.min(96, 68 + matchedSkills.length * 6);
  const [job] = await db
    .insert(jobsTable)
    .values({
      ...parsed.data,
      ownerId,
      fitScore,
      status: "new",
      matchedSkills,
      missingSkills: [],
    })
    .returning();
  await db.insert(activityTable).values({
    ownerId,
    type: "job",
    title: "New job added",
    description: `${job.company} · ${job.title} scored ${fitScore}% fit.`,
  });
  res.status(201).json(CreateJobResponse.parse(serializeJob(job)));
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.ownerId, ownerId)));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(GetJobResponse.parse(serializeJob(job)));
});

router.patch("/jobs/:id", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const params = UpdateJobParams.safeParse(req.params);
  const body = UpdateJobBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid job update" });
    return;
  }
  const [job] = await db
    .update(jobsTable)
    .set(body.data)
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.ownerId, ownerId)))
    .returning();
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(UpdateJobResponse.parse(serializeJob(job)));
});

router.post("/jobs/:id/prepare", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const params = PrepareApplicationParams.safeParse(req.params);
  const body = PrepareApplicationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid application request" });
    return;
  }
  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.ownerId, ownerId)));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const [application] = await db
    .insert(applicationsTable)
    .values({
      jobId: job.id,
      ownerId,
      mode: body.data.mode,
      status: body.data.mode === "batch" ? "queued" : "preparing",
      progress: body.data.mode === "batch" ? 10 : 25,
      portalUrl: job.sourceUrl,
    })
    .returning();
  await db.update(jobsTable).set({ status: "in_progress" }).where(and(eq(jobsTable.id, job.id), eq(jobsTable.ownerId, ownerId)));
  await db.insert(activityTable).values({
    ownerId,
    type: "application",
    title: body.data.mode === "batch" ? "Added to batch queue" : "Application prepared",
    description: `${job.company} · ${job.title}`,
  });
  res.status(201).json(
    PrepareApplicationResponse.parse({
      ...application,
      company: job.company,
      title: job.title,
      ...serializeApplication(application),
    }),
  );
});

router.get("/applications", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const rows = await db
    .select({ application: applicationsTable, company: jobsTable.company, title: jobsTable.title })
    .from(applicationsTable)
    .innerJoin(
      jobsTable,
      and(eq(applicationsTable.jobId, jobsTable.id), eq(jobsTable.ownerId, ownerId)),
    )
    .where(eq(applicationsTable.ownerId, ownerId))
    .orderBy(desc(applicationsTable.updatedAt));
  res.json(
    ListApplicationsResponse.parse(
      rows.map(({ application, company, title }) => ({
        ...application,
        company,
        title,
        ...serializeApplication(application),
      })),
    ),
  );
});

router.patch("/applications/:id", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const params = UpdateApplicationParams.safeParse(req.params);
  const body = UpdateApplicationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid application update" });
    return;
  }
  const [existing] = await db
    .select()
    .from(applicationsTable)
    .where(and(eq(applicationsTable.id, params.data.id), eq(applicationsTable.ownerId, ownerId)));
  if (!existing) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, existing.jobId), eq(jobsTable.ownerId, ownerId)));
  if (!job) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  const [application] = await db
    .update(applicationsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(applicationsTable.id, params.data.id), eq(applicationsTable.ownerId, ownerId)))
    .returning();
  if (!application) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  res.json(
    UpdateApplicationResponse.parse({
      ...application,
      company: job.company,
      title: job.title,
      ...serializeApplication(application),
    }),
  );
});

router.get("/batch-settings", async (req, res): Promise<void> => {
  const [settings] = await db.select().from(batchSettingsTable).where(eq(batchSettingsTable.ownerId, ownerOf(req))).limit(1);
  res.json(GetBatchSettingsResponse.parse(settings));
});

router.put("/batch-settings", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const body = UpdateBatchSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [existing] = await db.select().from(batchSettingsTable).where(eq(batchSettingsTable.ownerId, ownerId)).limit(1);
  const [settings] = existing
    ? await db
        .update(batchSettingsTable)
        .set(body.data)
        .where(and(eq(batchSettingsTable.id, existing.id), eq(batchSettingsTable.ownerId, ownerId)))
        .returning()
    : await db.insert(batchSettingsTable).values({ ...body.data, ownerId }).returning();
  res.json(UpdateBatchSettingsResponse.parse(settings));
});

router.post("/batch-runs", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const body = StartBatchRunBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [settings] = await db
    .select()
    .from(batchSettingsTable)
    .where(eq(batchSettingsTable.ownerId, ownerId))
    .limit(1);
  if (!settings?.enabled) {
    res.status(409).json({ error: "Enable controlled batch mode before starting a run." });
    return;
  }
  const ownedJobs = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.ownerId, ownerId), inArray(jobsTable.id, body.data.jobIds)));
  if (ownedJobs.length !== body.data.jobIds.length) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const selectedJobs = await db
    .select({ id: jobsTable.id, fitScore: jobsTable.fitScore, sourceUrl: jobsTable.sourceUrl })
    .from(jobsTable)
    .where(and(eq(jobsTable.ownerId, ownerId), inArray(jobsTable.id, body.data.jobIds)));
  if (selectedJobs.some((job) => job.fitScore < settings.minimumFitScore)) {
    res.status(422).json({
      error: `Every selected job must meet the ${settings.minimumFitScore}% minimum fit score.`,
    });
    return;
  }
  const [dailyCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.ownerId, ownerId),
        sql`${applicationsTable.createdAt} >= date_trunc('day', now())`,
      ),
    );
  if (Number(dailyCount?.count ?? 0) + body.data.jobIds.length > settings.dailyLimit) {
    res.status(422).json({ error: `This run would exceed your daily limit of ${settings.dailyLimit}.` });
    return;
  }
  const [run] = await db
    .insert(batchRunsTable)
    .values({ queuedCount: body.data.jobIds.length, status: "running", ownerId })
    .returning();
  const applicationIds: number[] = [];
  for (const jobId of body.data.jobIds) {
    const [existing] = await db
      .select()
      .from(applicationsTable)
      .where(and(eq(applicationsTable.jobId, jobId), eq(applicationsTable.ownerId, ownerId)));
    if (!existing) {
      const [application] = await db.insert(applicationsTable).values({
        jobId,
        ownerId,
        mode: "batch",
        status: "queued",
        progress: 5,
        portalUrl: selectedJobs.find((job) => job.id === jobId)?.sourceUrl ?? "",
      }).returning({ id: applicationsTable.id });
      if (application) applicationIds.push(application.id);
    }
  }
  await db.insert(activityTable).values({
    ownerId,
    type: "batch",
    title: "Batch run started",
    description: `${body.data.jobIds.length} applications entered the controlled queue.`,
  });
  res.status(201).json(
    StartBatchRunResponse.parse({
      ...run,
      startedAt: run.startedAt.toISOString(),
    }),
  );
  void processBatchRun(ownerId, run.id, applicationIds, settings.delayMinutes);
});

router.get("/activity", async (req, res): Promise<void> => {
  const activity = await db.select().from(activityTable).where(eq(activityTable.ownerId, ownerOf(req))).orderBy(desc(activityTable.timestamp)).limit(12);
  res.json(
    ListActivityResponse.parse(
      activity.map((item) => ({ ...item, timestamp: item.timestamp.toISOString() })),
    ),
  );
});

router.post("/tracking/sync", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  let mail: Awaited<ReturnType<typeof searchRecentRecruiterMail>>;
  try {
    mail = await searchRecentRecruiterMail();
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Gmail could not be read.",
    });
    return;
  }

  const applications = await db
    .select({
      application: applicationsTable,
      company: jobsTable.company,
      title: jobsTable.title,
    })
    .from(applicationsTable)
    .innerJoin(
      jobsTable,
      and(eq(applicationsTable.jobId, jobsTable.id), eq(jobsTable.ownerId, ownerId)),
    )
    .where(eq(applicationsTable.ownerId, ownerId));

  let matchedMessages = 0;
  let newMessages = 0;
  const updatedApplicationIds = new Set<number>();

  for (const message of mail.messages) {
    const match = applications.find(({ company, title }) =>
      matchesApplication(message, company, title),
    );
    if (!match) continue;
    matchedMessages += 1;

    const [existingMessage] = await db
      .select({ id: recruiterMessagesTable.id })
      .from(recruiterMessagesTable)
      .where(
        and(
          eq(recruiterMessagesTable.ownerId, ownerId),
          eq(recruiterMessagesTable.messageId, message.id),
        ),
      )
      .limit(1);
    if (existingMessage) continue;

    const signalType = classifyRecruiterMessage(message);
    const receivedAt = new Date(message.date);
    if (Number.isNaN(receivedAt.getTime())) continue;

    await db.insert(recruiterMessagesTable).values({
      ownerId,
      applicationId: match.application.id,
      messageId: message.id,
      threadId: message.threadId,
      sender: message.sender,
      subject: message.subject,
      snippet: message.snippet,
      signalType,
      receivedAt,
    });
    newMessages += 1;

    const currentStatus = match.application.status;
    const terminalStatus = new Set(["offer", "offered", "rejected"]);
    const nextStatus =
      signalType === "offer" ? "offer" :
      signalType === "interview" && !terminalStatus.has(currentStatus) ? "interview" :
      signalType === "assessment" && !terminalStatus.has(currentStatus) ? "assessment" :
      signalType === "rejection" ? "rejected" :
      signalType === "reply" && !terminalStatus.has(currentStatus) && currentStatus === "applied"
        ? "responded"
        : currentStatus;

    const isNewer =
      !match.application.lastReplyAt || receivedAt.getTime() > match.application.lastReplyAt.getTime();
    await db
      .update(applicationsTable)
      .set({
        ...(isNewer
          ? {
              lastReplyAt: receivedAt,
              lastReplyType: signalType,
              lastReplySubject: message.subject,
              lastReplySnippet: message.snippet,
            }
          : {}),
        ...(nextStatus !== currentStatus ? { status: nextStatus } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(applicationsTable.id, match.application.id), eq(applicationsTable.ownerId, ownerId)));
    updatedApplicationIds.add(match.application.id);

    const title =
      signalType === "interview" ? "Interview activity detected" :
      signalType === "offer" ? "Offer activity detected" :
      signalType === "rejection" ? "Application outcome detected" :
      signalType === "assessment" ? "Assessment request detected" :
      "Recruiter reply detected";
    await db.insert(activityTable).values({
      ownerId,
      type: "recruiter_reply",
      title,
      description: `${match.company} · ${match.title}: ${message.subject}`,
    });
  }

  res.json({
    scannedThreads: mail.scannedThreads,
    matchedMessages,
    newMessages,
    updatedApplications: updatedApplicationIds.size,
  });
});

export default router;