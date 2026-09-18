import { strict as assert } from "node:assert";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
} from "node:http";
import { test } from "node:test";
import express, { type Express } from "express";
import { eq, inArray } from "drizzle-orm";

type DbModule = typeof import("@workspace/db");
type ApiResponse = { status: number; body: string; headers: Record<string, string> };

const databaseAvailable = Boolean(process.env.DATABASE_URL);
let database: DbModule | undefined;
let realApp: Express | undefined;
let jobpilotRouter!: (typeof import("../routes/jobpilot"))["default"];
let tailoringRouter!: (typeof import("../routes/tailoring"))["default"];
let owners: string[] = [];
let resources: {
  jobId: number;
  applicationId: number;
  generationId: number;
  mismatchedApplicationId: number;
} | undefined;

function listen(handler: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not determine test server address");
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function request(
  baseUrl: string,
  method: string,
  path: string,
  options: { owner?: string; origin?: string; body?: unknown } = {},
): Promise<ApiResponse> {
  const url = new URL(path, baseUrl);
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  const headers: Record<string, string> = {};
  if (options.owner) headers["x-test-owner"] = options.owner;
  if (options.origin) headers.origin = options.origin;
  if (payload !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(payload));
  }
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      { method, headers },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: Object.fromEntries(
              Object.entries(res.headers).flatMap(([key, value]) =>
                typeof value === "string" ? [[key, value]] : [],
              ),
            ),
          }),
        );
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function cleanOwners() {
  if (!database || owners.length === 0) return;
  const { db, documentGenerationsTable, aiRequestEventsTable, applicationsTable, jobsTable, profilesTable, batchSettingsTable, batchRunsTable, activityTable } =
    database;
  await db.transaction(async (tx) => {
    const jobs = await tx
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(inArray(jobsTable.ownerId, owners));
    const jobIds = jobs.map(({ id }) => id);
    if (jobIds.length) {
      await tx.delete(documentGenerationsTable).where(inArray(documentGenerationsTable.jobId, jobIds));
      await tx.delete(applicationsTable).where(inArray(applicationsTable.jobId, jobIds));
    }
    await tx.delete(documentGenerationsTable).where(inArray(documentGenerationsTable.ownerId, owners));
    await tx.delete(applicationsTable).where(inArray(applicationsTable.ownerId, owners));
    await tx.delete(batchRunsTable).where(inArray(batchRunsTable.ownerId, owners));
    await tx.delete(batchSettingsTable).where(inArray(batchSettingsTable.ownerId, owners));
    await tx.delete(activityTable).where(inArray(activityTable.ownerId, owners));
    await tx.delete(aiRequestEventsTable).where(inArray(aiRequestEventsTable.ownerId, owners));
    await tx.delete(jobsTable).where(inArray(jobsTable.ownerId, owners));
    await tx.delete(profilesTable).where(inArray(profilesTable.ownerId, owners));
  });
}

async function seedData() {
  if (!database) return;
  const { db, profilesTable, jobsTable, applicationsTable, documentGenerationsTable } = database;
  const ownerA = `access-a-${process.pid}-${Date.now()}`;
  const ownerB = `access-b-${process.pid}-${Date.now()}`;
  owners = [ownerA, ownerB];
  await db.transaction(async (tx) => {
    for (const ownerId of owners) {
      await tx.insert(profilesTable).values({
        ownerId,
        fullName: `User ${ownerId}`,
        email: `${ownerId}@example.test`,
         evidence: [{
           id: `evidence-${ownerId}`,
           category: "experience",
           title: "Security Engineer",
           organization: "Test Company",
           detail: "Built a secure test system.",
           source: "test",
         }],
      });
    }
    const [job] = await tx
      .insert(jobsTable)
      .values({
        ownerId: ownerA,
        company: "Owner A Co",
        title: "Security Engineer",
        location: "Remote",
        workMode: "remote",
        salary: "$100,000",
        source: "test",
        description: "An isolated access-control test job.",
      })
      .returning();
    const [otherOwnerJob] = await tx
      .insert(jobsTable)
      .values({
        ownerId: ownerB,
        company: "Owner B Co",
        title: "Platform Engineer",
        location: "Remote",
        workMode: "remote",
        salary: "$100,000",
        source: "test",
        description: "A parent row owned by B.",
      })
      .returning();
    const [application] = await tx
      .insert(applicationsTable)
      .values({
        ownerId: ownerA,
        jobId: job.id,
        mode: "manual",
      })
      .returning();
    const [mismatchedApplication] = await tx
      .insert(applicationsTable)
      .values({
        ownerId: ownerA,
        jobId: otherOwnerJob.id,
        mode: "manual",
      })
      .returning();
    const [generation] = await tx
      .insert(documentGenerationsTable)
      .values({
        ownerId: ownerA,
        jobId: job.id,
        version: 1,
        status: "draft",
        model: "test",
        jobSnapshot: { id: job.id },
        profileSnapshot: { ownerId: ownerA },
        content: { cvMarkdown: "# CV", coverLetterMarkdown: "# Letter" },
        cvMarkdown: "# CV",
        coverLetterMarkdown: "# Letter",
        evidenceIds: ["verified"],
      })
      .returning();
    resources = {
      jobId: job.id,
      applicationId: application.id,
      generationId: generation.id,
      mismatchedApplicationId: mismatchedApplication.id,
    };
  });
}

function createInjectedRouteApp(): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => {
    const owner = req.headers["x-test-owner"];
    if (typeof owner === "string") (req as typeof req & { userId: string }).userId = owner;
    next();
  });
  app.use(jobpilotRouter);
  app.use(tailoringRouter);
  return app;
}

test.before(async () => {
  if (!databaseAvailable) return;
  database = await import("@workspace/db");
  ({ default: realApp } = await import("../app"));
  ({ default: jobpilotRouter } = await import("../routes/jobpilot"));
  ({ default: tailoringRouter } = await import("../routes/tailoring"));
  await cleanOwners();
  await seedData();
});

test.after(async () => {
  if (!databaseAvailable) return;
  await cleanOwners();
  await database?.pool.end();
});

test("same-origin protection rejects cross-origin state changes and allows non-browser clients", { skip: !databaseAvailable }, async () => {
  const server = await listen(realApp!);
  try {
    const host = new URL(server.baseUrl).host;
    assert.equal((await request(server.baseUrl, "GET", "/api/healthz", { origin: "https://evil.example" })).status, 200);
    assert.equal((await request(server.baseUrl, "POST", "/api/jobs", { origin: "https://evil.example", body: {} })).status, 403);
    assert.equal((await request(server.baseUrl, "POST", "/api/jobs", { origin: `http://${host}`, body: {} })).status, 401);
    assert.equal((await request(server.baseUrl, "POST", "/api/jobs", { body: {} })).status, 401);
    const nonJson = await new Promise<ApiResponse>((resolve, reject) => {
      const req = httpRequest(
        new URL("/api/jobs", server.baseUrl),
        { method: "POST", headers: { "content-type": "text/plain", "content-length": "3" } },
        (res: IncomingMessage) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: {} }));
        },
      );
      req.on("error", reject);
      req.end("job");
    });
    assert.equal(nonJson.status, 415);
  } finally {
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
  }
});

test("the real app returns 401 for every protected API route without a session", { skip: !databaseAvailable }, async () => {
  const server = await listen(realApp!);
  const id = resources!;
  const routes: Array<[string, string, unknown?]> = [
    ["GET", "/api/dashboard"],
    ["GET", "/api/profile"],
    ["GET", "/api/jobs"],
    ["POST", "/api/jobs", {}],
    ["GET", `/api/jobs/${id.jobId}`],
    ["PATCH", `/api/jobs/${id.jobId}`, { status: "ready" }],
    ["POST", `/api/jobs/${id.jobId}/prepare`, { mode: "review" }],
    ["GET", "/api/applications"],
    ["PATCH", `/api/applications/${id.applicationId}`, { status: "interview" }],
    ["GET", "/api/batch-settings"],
    ["PUT", "/api/batch-settings", {}],
    ["POST", "/api/batch-runs", { jobIds: [id.jobId] }],
    ["GET", "/api/activity"],
    ["GET", `/api/jobs/${id.jobId}/generations`],
    ["POST", `/api/jobs/${id.jobId}/generations`, { instructions: "" }],
    ["GET", `/api/generations/${id.generationId}`],
    ["PATCH", `/api/generations/${id.generationId}`, { status: "approved" }],
    ["GET", `/api/generations/${id.generationId}/cv.docx`],
    ["GET", `/api/generations/${id.generationId}/cover-letter.docx`],
  ];
  try {
    for (const [method, path, body] of routes) {
      assert.equal((await request(server.baseUrl, method, path, { body })).status, 401, `${method} ${path}`);
    }
  } finally {
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
  }
});

test("owner boundaries hide lists and reject cross-owner reads, writes, generation, preparation, and downloads", { skip: !databaseAvailable }, async () => {
  const ownerA = owners[0];
  const ownerB = owners[1];
  const id = resources!;
  const server = await listen(createInjectedRouteApp());
  try {
    const ownerBJobs = JSON.parse((await request(server.baseUrl, "GET", "/jobs", { owner: ownerB })).body);
    const ownerBApplications = JSON.parse((await request(server.baseUrl, "GET", "/applications", { owner: ownerB })).body);
    assert.ok(ownerBJobs.every((job: { id: number }) => job.id !== id.jobId));
    assert.ok(ownerBApplications.every((application: { id: number }) => application.id !== id.applicationId));
    assert.equal((await request(server.baseUrl, "GET", `/jobs/${id.jobId}`, { owner: ownerB })).status, 404);
    assert.equal((await request(server.baseUrl, "PATCH", `/jobs/${id.jobId}`, { owner: ownerB, body: { status: "ready" } })).status, 404);
    assert.equal((await request(server.baseUrl, "PATCH", `/applications/${id.applicationId}`, { owner: ownerB, body: { status: "interview" } })).status, 404);
    assert.equal((await request(server.baseUrl, "PATCH", `/applications/${id.mismatchedApplicationId}`, { owner: ownerA, body: { status: "interview" } })).status, 404);
    assert.equal((await request(server.baseUrl, "POST", `/jobs/${id.jobId}/prepare`, { owner: ownerB, body: { mode: "review" } })).status, 404);
    assert.equal((await request(server.baseUrl, "GET", `/jobs/${id.jobId}/generations`, { owner: ownerB })).status, 404);
    assert.equal((await request(server.baseUrl, "POST", `/jobs/${id.jobId}/generations`, { owner: ownerB, body: { instructions: "" } })).status, 404);
    assert.equal((await request(server.baseUrl, "GET", `/generations/${id.generationId}`, { owner: ownerB })).status, 404);
    assert.equal((await request(server.baseUrl, "PATCH", `/generations/${id.generationId}`, { owner: ownerB, body: { status: "approved" } })).status, 404);
    assert.equal((await request(server.baseUrl, "GET", `/generations/${id.generationId}/cv.docx`, { owner: ownerB })).status, 404);
    assert.equal((await request(server.baseUrl, "GET", `/generations/${id.generationId}/cover-letter.docx`, { owner: ownerB })).status, 404);

    assert.equal((await request(server.baseUrl, "GET", `/jobs/${id.jobId}`, { owner: ownerA })).status, 200);
    assert.equal((await request(server.baseUrl, "GET", "/profile", { owner: ownerA })).status, 200);
    assert.equal((await request(server.baseUrl, "GET", `/applications`, { owner: ownerA })).status, 200);
    assert.equal((await request(server.baseUrl, "GET", `/jobs/${id.jobId}/generations`, { owner: ownerA })).status, 200);
    assert.equal((await request(server.baseUrl, "GET", `/generations/${id.generationId}`, { owner: ownerA })).status, 200);
    assert.equal((await request(server.baseUrl, "PATCH", `/applications/${id.applicationId}`, { owner: ownerA, body: { status: "interview" } })).status, 200);
    assert.equal((await request(server.baseUrl, "GET", `/generations/${id.generationId}/cv.docx`, { owner: ownerA })).status, 200);

    const { db, jobsTable, applicationsTable, documentGenerationsTable } = database!;
    const [job, application, generation, mismatchedApplication] = await Promise.all([
      db.select().from(jobsTable).where(eq(jobsTable.id, id.jobId)),
      db.select().from(applicationsTable).where(eq(applicationsTable.id, id.applicationId)),
      db.select().from(documentGenerationsTable).where(eq(documentGenerationsTable.id, id.generationId)),
      db.select().from(applicationsTable).where(eq(applicationsTable.id, id.mismatchedApplicationId)),
    ]);
    assert.equal(job[0]?.status, "new");
    assert.equal(application[0]?.status, "interview");
    assert.equal(mismatchedApplication[0]?.status, "preparing");
    assert.equal(generation[0]?.version, 1);
  } finally {
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
  }
});

test("per-user AI quota rejects paid generation before the provider is called", { skip: !databaseAvailable }, async () => {
  const ownerA = owners[0];
  const id = resources!;
  const { db, aiRequestEventsTable } = database!;
  await db.insert(aiRequestEventsTable).values([
    { ownerId: ownerA, requestType: "test", requestedAt: new Date() },
    { ownerId: ownerA, requestType: "test", requestedAt: new Date() },
    { ownerId: ownerA, requestType: "test", requestedAt: new Date() },
  ]);
  const server = await listen(createInjectedRouteApp());
  try {
    assert.equal(
      (await request(server.baseUrl, "POST", `/jobs/${id.jobId}/generations`, {
        owner: ownerA,
        body: { instructions: "" },
      })).status,
      429,
    );
  } finally {
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
  }
});