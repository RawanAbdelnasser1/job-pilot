import { Router, type IRouter, type Response } from "express";
import { and, desc, eq, max, sql } from "drizzle-orm";
import type { Request } from "express";
import {
  db,
  aiRequestEventsTable,
  documentGenerationsTable,
  type GenerationClaim,
  jobsTable,
  profilesTable,
  type ProfileEvidence,
} from "@workspace/db";
import {
  GenerateJobDocumentsBody,
  GenerateJobDocumentsParams,
  GenerateJobDocumentsResponse,
  DownloadGenerationCoverLetterParams,
  DownloadGenerationCvParams,
  GetGenerationParams,
  GetGenerationResponse,
  ListJobGenerationsParams,
  ListJobGenerationsResponse,
  UpdateGenerationBody,
  UpdateGenerationParams,
  UpdateGenerationResponse,
} from "@workspace/api-zod";
import { markdownToDocx } from "../lib/docx";
import { logger } from "../lib/logger";
import type { AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();
const ownerOf = (req: Request) => (req as AuthenticatedRequest).userId;

type EvidenceSelection = {
  summaryEvidenceIds?: string[];
  experienceEvidenceIds?: string[];
  projectEvidenceIds?: string[];
  educationEvidenceIds?: string[];
  coverLetterEvidenceIds?: string[];
};

class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

async function reserveAiRequest(ownerId: string, requestType: string) {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ownerId}))`);
    const [minute] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(aiRequestEventsTable)
      .where(and(
        eq(aiRequestEventsTable.ownerId, ownerId),
        sql`${aiRequestEventsTable.requestedAt} > now() - interval '1 minute'`,
      ));
    const [day] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(aiRequestEventsTable)
      .where(and(
        eq(aiRequestEventsTable.ownerId, ownerId),
        sql`${aiRequestEventsTable.requestedAt} >= date_trunc('day', now() at time zone 'utc')`,
      ));
    if (Number(minute?.count ?? 0) >= 3) return "minute";
    if (Number(day?.count ?? 0) >= 20) return "day";
    await tx.insert(aiRequestEventsTable).values({ ownerId, requestType });
    return null;
  });
  if (result === "minute") {
    throw new HttpError(429, "AI request limit reached. Try again in a minute.");
  }
  if (result === "day") {
    throw new HttpError(429, "Daily AI request limit reached. Try again tomorrow.");
  }
}

export function validateEditedVerification(
  verification: {
    claims?: Array<{ section?: unknown; text?: unknown; evidenceId?: unknown; supportingDetail?: unknown }>;
    unsupportedClaims?: unknown;
  },
  documents: { cvMarkdown: string; coverLetterMarkdown: string },
  evidence: ProfileEvidence[],
) {
  if (!Array.isArray(verification.claims) || !Array.isArray(verification.unsupportedClaims)) {
    throw new HttpError(422, "Edited documents could not be verified.");
  }
  if (verification.unsupportedClaims.length > 0) {
    throw new HttpError(422, "Edited documents contain unsupported factual claims.");
  }
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const claims: GenerationClaim[] = [];
  const evidenceIds = new Set<string>();
  for (const claim of verification.claims) {
    if (
      typeof claim.section !== "string" ||
      typeof claim.text !== "string" ||
      typeof claim.evidenceId !== "string" ||
      typeof claim.supportingDetail !== "string"
    ) {
      throw new HttpError(422, "Edited documents contain an invalid claim verification.");
    }
    const source = byId.get(claim.evidenceId);
    if (!source || normalize(claim.supportingDetail) !== normalize(source.detail)) {
      throw new HttpError(422, "Edited documents contain an unsupported evidence citation.");
    }
    if (!documents.cvMarkdown.includes(claim.text) && !documents.coverLetterMarkdown.includes(claim.text)) {
      throw new HttpError(422, "Verified claim text was not found in the edited documents.");
    }
    claims.push({ section: claim.section, text: claim.text, evidenceIds: [source.id] });
    evidenceIds.add(source.id);
  }
  if (!claims.length) throw new HttpError(422, "Edited documents contain no verifiable profile claims.");
  return { claims, evidenceIds: [...evidenceIds] };
}

function serializeGeneration(
  generation: typeof documentGenerationsTable.$inferSelect,
) {
  return {
    id: generation.id,
    jobId: generation.jobId,
    version: generation.version,
    status: generation.status,
    model: generation.model,
    cvMarkdown: generation.cvMarkdown,
    coverLetterMarkdown: generation.coverLetterMarkdown,
    evidenceIds: generation.evidenceIds,
    claims: generation.claims,
    rejectedClaims: generation.rejectedClaims,
    createdAt: generation.createdAt.toISOString(),
    updatedAt: generation.updatedAt.toISOString(),
  };
}

/**
 * A citation is necessary but not sufficient: require the generated sentence
 * to contain a meaningful term from the cited evidence or an allowed job/
 * identity field. This deterministic check catches plausible-sounding
 * uncited hallucinations before persistence.
 */
function validateSelections(
  output: EvidenceSelection,
  evidence: ProfileEvidence[],
) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const rejectedClaims: string[] = [];
  const evidenceIds = new Set<string>();
  const select = (
    ids: unknown,
    categories?: ProfileEvidence["category"][],
  ): ProfileEvidence[] => {
    if (!Array.isArray(ids)) return [];
    return ids.flatMap((value) => {
      if (typeof value !== "string") {
        rejectedClaims.push("AI returned a malformed evidence reference.");
        return [];
      }
      const item = evidenceById.get(value);
      if (!item || (categories && !categories.includes(item.category))) {
        rejectedClaims.push(`Rejected unsupported evidence reference: ${value}`);
        return [];
      }
      evidenceIds.add(item.id);
      return [item];
    });
  };
  const sections = {
    summary: select(output.summaryEvidenceIds).slice(0, 2),
    experience: select(output.experienceEvidenceIds, ["experience", "achievement"]),
    projects: select(output.projectEvidenceIds, ["project"]),
    education: select(output.educationEvidenceIds, ["education", "certification"]),
    coverLetter: select(output.coverLetterEvidenceIds).slice(0, 3),
  };
  const hasCvClaims =
    sections.summary.length > 0 ||
    sections.experience.length > 0 ||
    sections.projects.length > 0 ||
    sections.education.length > 0;
  if (!hasCvClaims || sections.coverLetter.length === 0) {
    throw new Error(
      "Generated content did not contain supported claims for both the CV and cover letter.",
    );
  }
  return { sections, rejectedClaims, evidenceIds: [...evidenceIds] };
}

function buildDocuments(
  profile: typeof profilesTable.$inferSelect,
  job: typeof jobsTable.$inferSelect,
  validated: ReturnType<typeof validateSelections>,
) {
  const contact = [profile.email, profile.phone, profile.location].filter(Boolean).join(" · ");
  const cv: string[] = [`# ${profile.fullName}`, contact];
  if (profile.headline) cv.push(profile.headline);
  const claims: GenerationClaim[] = [];
  if (validated.sections.summary.length) {
    cv.push(
      "## Professional Summary",
      profile.headline || `${profile.targetRoles[0] ?? "Professional"} with verified relevant experience.`,
      ...validated.sections.summary.map((item) => item.detail),
    );
    claims.push(
      ...validated.sections.summary.map((item) => ({
        section: "summary",
        text: item.detail,
        evidenceIds: [item.id],
      })),
    );
  }
  const sections: Array<[string, ProfileEvidence[]]> = [
    ["Experience", validated.sections.experience],
    ["Projects", validated.sections.projects],
    ["Education & Certifications", validated.sections.education],
  ];
  for (const [heading, claims] of sections) {
    if (claims.length) {
      cv.push(`## ${heading}`);
      for (const item of claims) {
        const dates = [item.startDate, item.endDate].filter(Boolean).join(" – ");
        cv.push(`### ${item.title}${item.organization ? ` — ${item.organization}` : ""}`);
        if (dates) cv.push(dates);
        cv.push(`- ${item.detail}`);
      }
    }
  }
  for (const [section, items] of [
    ["experience", validated.sections.experience],
    ["projects", validated.sections.projects],
    ["education", validated.sections.education],
  ] as const) {
    claims.push(...items.map((item) => ({ section, text: item.detail, evidenceIds: [item.id] })));
  }
  const skills = profile.skills;
  if (skills.length) cv.push("## Skills", skills.map((skill) => `- ${skill}`).join("\n"));

  const cover: string[] = [
    `# ${profile.fullName}`,
    contact,
    "",
    `Re: ${job.title} at ${job.company}`,
    "",
    "Dear Hiring Team,",
    "",
    `I am applying for the ${job.title} role at ${job.company}. My verified background includes experience relevant to this opportunity:`,
    "",
    ...validated.sections.coverLetter.map((item) => {
      const context = [item.title, item.organization].filter(Boolean).join(" at ");
      return `${context ? `${context}: ` : ""}${item.detail}`;
    }),
    "",
    `I would welcome the opportunity to discuss how this experience and my skills in ${profile.skills.join(", ")} can contribute to your team.`,
    "",
    "Sincerely,",
    profile.fullName,
  ];
  claims.push(
    ...validated.sections.coverLetter.map((item) => ({
      section: "cover_letter",
      text: item.detail,
      evidenceIds: [item.id],
    })),
  );
  return { cvMarkdown: cv.join("\n"), coverLetterMarkdown: cover.join("\n"), claims };
}

type NewGeneration = Omit<
  typeof documentGenerationsTable.$inferInsert,
  "id" | "version" | "createdAt" | "updatedAt" | "ownerId"
> & { ownerId: string };

async function insertRevision(values: NewGeneration) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${values.jobId})`);
    const [current] = await tx
      .select({ version: max(documentGenerationsTable.version) })
      .from(documentGenerationsTable)
      .where(
        and(
          eq(documentGenerationsTable.jobId, values.jobId),
          eq(documentGenerationsTable.ownerId, values.ownerId),
        ),
      );
    const now = new Date();
    const [revision] = await tx
      .insert(documentGenerationsTable)
      .values({
        ...values,
        version: (current?.version ?? 0) + 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return revision;
  });
}

async function parentJobBelongsToOwner(jobId: number, ownerId: string) {
  const [job] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.ownerId, ownerId)));
  return Boolean(job);
}

router.get("/jobs/:id/generations", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const params = ListJobGenerationsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [job] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.ownerId, ownerId)));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const rows = await db
    .select()
    .from(documentGenerationsTable)
    .where(
      and(
        eq(documentGenerationsTable.jobId, params.data.id),
        eq(documentGenerationsTable.ownerId, ownerId),
      ),
    )
    .orderBy(desc(documentGenerationsTable.version));
  res.json(ListJobGenerationsResponse.parse(rows.map(serializeGeneration)));
});

router.post("/jobs/:id/generations", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const params = GenerateJobDocumentsParams.safeParse(req.params);
  const body = GenerateJobDocumentsBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid document generation request" });
    return;
  }
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.ownerId, ownerId)));
  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.ownerId, ownerId))
    .limit(1);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (!profile) {
    res.status(422).json({ error: "A profile with evidence is required before generation." });
    return;
  }
  if (!profile.evidence.length) {
    res.status(422).json({ error: "Insufficient profile evidence to generate truthful documents." });
    return;
  }

  try {
    await reserveAiRequest(ownerId, "generate_documents");
    // Dynamic import keeps the API available for non-AI routes when the
    // integration has not been provisioned; this request then fails clearly.
    const { generateTailoredDocuments, TAILORING_MODEL } = await import(
      "@workspace/integrations-openai-ai-server/tailoring"
    );
    const generated = await generateTailoredDocuments({
      identity: {
        fullName: profile.fullName,
        email: profile.email,
        phone: profile.phone,
        location: profile.location,
        headline: profile.headline,
      },
      skills: profile.skills,
      evidence: profile.evidence,
      job: {
        company: job.company,
        title: job.title,
        location: job.location,
        workMode: job.workMode,
        salary: job.salary,
        description: job.description,
      },
      instructions: body.data.instructions,
    });
    const validated = validateSelections(generated, profile.evidence);
    const documents = buildDocuments(profile, job, validated);
    const generation = await insertRevision({
        ownerId,
        jobId: job.id,
        status: "draft",
        model: TAILORING_MODEL,
        jobSnapshot: JSON.parse(JSON.stringify(job)),
        profileSnapshot: JSON.parse(JSON.stringify(profile)),
        content: documents,
        ...documents,
        evidenceIds: validated.evidenceIds,
        claims: documents.claims,
        rejectedClaims: validated.rejectedClaims,
      });
    res.status(201).json(GenerateJobDocumentsResponse.parse(serializeGeneration(generation)));
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error({ err: error, jobId: params.data.id }, "Truthful document generation failed");
    res.status(503).json({
      error: error instanceof Error ? error.message : "AI document generation is unavailable.",
    });
  }
});

router.get("/generations/:id", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const params = GetGenerationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [generation] = await db
    .select()
    .from(documentGenerationsTable)
    .where(and(eq(documentGenerationsTable.id, params.data.id), eq(documentGenerationsTable.ownerId, ownerId)));
  if (!generation) {
    res.status(404).json({ error: "Generation not found" });
    return;
  }
  if (!(await parentJobBelongsToOwner(generation.jobId, ownerId))) {
    res.status(404).json({ error: "Generation not found" });
    return;
  }
  res.json(GetGenerationResponse.parse(serializeGeneration(generation)));
});

router.patch("/generations/:id", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const params = UpdateGenerationParams.safeParse(req.params);
  const body = UpdateGenerationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid generation update" });
    return;
  }
  const [existing] = await db
    .select()
    .from(documentGenerationsTable)
    .where(and(eq(documentGenerationsTable.id, params.data.id), eq(documentGenerationsTable.ownerId, ownerId)));
  if (!existing) {
    res.status(404).json({ error: "Generation not found" });
    return;
  }
  if (!(await parentJobBelongsToOwner(existing.jobId, ownerId))) {
    res.status(404).json({ error: "Generation not found" });
    return;
  }
  const cvMarkdown = body.data.cvMarkdown ?? existing.cvMarkdown;
  const coverLetterMarkdown = body.data.coverLetterMarkdown ?? existing.coverLetterMarkdown;
  const contentChanged =
    cvMarkdown !== existing.cvMarkdown ||
    coverLetterMarkdown !== existing.coverLetterMarkdown;
  if (body.data.status === "approved" && contentChanged) {
    res.status(422).json({ error: "Edited content cannot be approved until it is regenerated and verified." });
    return;
  }
  if (body.data.status === "approved" && existing.evidenceIds.length === 0) {
    res.status(422).json({ error: "This draft has no verified claim provenance and cannot be approved." });
    return;
  }
  let verifiedClaims = existing.claims;
  let verifiedEvidenceIds = existing.evidenceIds;
  if (contentChanged) {
    try {
      await reserveAiRequest(ownerId, "verify_edited_documents");
      const { verifyEditedDocuments, TAILORING_MODEL } = await import(
        "@workspace/integrations-openai-ai-server/tailoring"
      );
      const profileEvidence = Array.isArray(existing.profileSnapshot.evidence)
        ? existing.profileSnapshot.evidence as unknown as ProfileEvidence[]
        : [];
      const verification = await verifyEditedDocuments({
        cvMarkdown,
        coverLetterMarkdown,
        evidence: profileEvidence,
        job: existing.jobSnapshot as never,
      });
      const validated = validateEditedVerification(
        verification,
        { cvMarkdown, coverLetterMarkdown },
        profileEvidence,
      );
      verifiedClaims = validated.claims;
      verifiedEvidenceIds = validated.evidenceIds;
      const revision = await insertRevision({
        ownerId,
        jobId: existing.jobId,
        status: "draft",
        model: TAILORING_MODEL,
        jobSnapshot: existing.jobSnapshot,
        profileSnapshot: existing.profileSnapshot,
        content: { cvMarkdown, coverLetterMarkdown },
        cvMarkdown,
        coverLetterMarkdown,
        evidenceIds: verifiedEvidenceIds,
        claims: verifiedClaims,
        rejectedClaims: verification.unsupportedClaims as string[],
      });
      res.json(UpdateGenerationResponse.parse(serializeGeneration(revision)));
      return;
    } catch (error) {
      if (error instanceof HttpError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      logger.error({ err: error, generationId: existing.id }, "Edited document verification failed");
      res.status(503).json({ error: error instanceof Error ? error.message : "AI edit verification is unavailable." });
      return;
    }
  }
  // Never mutate an existing row: an edit is a new immutable revision.
  const revision = await insertRevision({
      ownerId,
      jobId: existing.jobId,
      status: contentChanged ? "draft" : (body.data.status ?? existing.status),
      model: existing.model,
      jobSnapshot: existing.jobSnapshot,
      profileSnapshot: existing.profileSnapshot,
      content: { cvMarkdown, coverLetterMarkdown },
      cvMarkdown,
      coverLetterMarkdown,
      evidenceIds: verifiedEvidenceIds,
      claims: verifiedClaims,
      rejectedClaims: existing.rejectedClaims,
    });
  res.json(UpdateGenerationResponse.parse(serializeGeneration(revision)));
});

async function downloadDocument(
  id: number,
  kind: "cv" | "cover-letter",
  ownerId: string,
  res: Response,
) {
  const [generation] = await db
    .select()
    .from(documentGenerationsTable)
    .where(and(eq(documentGenerationsTable.id, id), eq(documentGenerationsTable.ownerId, ownerId)));
  if (!generation) {
    res.status(404).json({ error: "Generation not found" });
    return;
  }
  if (!(await parentJobBelongsToOwner(generation.jobId, ownerId))) {
    res.status(404).json({ error: "Generation not found" });
    return;
  }
  const markdown = kind === "cv" ? generation.cvMarkdown : generation.coverLetterMarkdown;
  const filename = kind === "cv" ? "tailored-cv.docx" : "tailored-cover-letter.docx";
  const bytes = await markdownToDocx(markdown);
  res.type("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(bytes);
}

router.get("/generations/:id/cv.docx", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const params = DownloadGenerationCvParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await downloadDocument(params.data.id, "cv", ownerId, res);
});

router.get("/generations/:id/cover-letter.docx", async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const params = DownloadGenerationCoverLetterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await downloadDocument(params.data.id, "cover-letter", ownerId, res);
});

export default router;