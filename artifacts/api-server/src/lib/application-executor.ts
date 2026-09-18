import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { profilesTable, jobsTable, applicationsTable, documentGenerationsTable } from "@workspace/db";
import { markdownToDocx } from "./docx";

export type PortalType = "greenhouse" | "lever";

export type ExecutionInput = {
  job: typeof jobsTable.$inferSelect;
  application: typeof applicationsTable.$inferSelect;
  profile: typeof profilesTable.$inferSelect;
  generation?: typeof documentGenerationsTable.$inferSelect;
  submitAutomatically: boolean;
};

export type ExecutionResult = {
  portalType: PortalType | "unknown";
  executionState: "ready_for_submit" | "submitted" | "blocked" | "failed";
  currentStep: string;
  filledFields: number;
  totalFields: number;
  unresolvedFields: string[];
  requiresUserAction: boolean;
  approvalToken: string | null;
  message: string;
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
};

export class ExecutionBlockedError extends Error {
  constructor(
    message: string,
    public readonly portalType: string = "unknown",
  ) {
    super(message);
  }
}

const sensitiveQuestionPattern =
  /(sponsor|visa|work authorization|right to work|veteran|disab|race|ethnic|gender|sexual orientation|criminal|felony|conviction|demographic|citizenship|social security|salary expectation)/i;

function portalForUrl(rawUrl: string): PortalType {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ExecutionBlockedError("The application URL is not a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") {
    throw new ExecutionBlockedError("Only HTTPS application URLs are supported.");
  }
  const host = url.hostname.toLowerCase();
  if (host === "greenhouse.io" || host.endsWith(".greenhouse.io")) return "greenhouse";
  if (host === "lever.co" || host.endsWith(".lever.co")) return "lever";
  throw new ExecutionBlockedError(
    "This portal is not supported yet. JobPilot supports Greenhouse and Lever application forms.",
  );
}

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function labelForField(field: {
  name?: string;
  id?: string;
  label?: string;
  placeholder?: string;
  type?: string;
}) {
  return clean([field.label, field.name, field.id, field.placeholder].filter(Boolean).join(" "));
}

function valueForField(
  field: { name?: string; id?: string; label?: string; placeholder?: string; type?: string },
  profile: typeof profilesTable.$inferSelect,
) {
  const label = labelForField(field);
  const fullName = profile.fullName.trim();
  const [firstName, ...lastParts] = fullName.split(/\s+/);
  const lastName = lastParts.join(" ");

  if (field.type === "email" || /\bemail\b/.test(label)) return profile.email;
  if (field.type === "tel" || /\b(phone|mobile|telephone)\b/.test(label)) return profile.phone;
  if (/\b(first.?name|given name)\b/.test(label)) return firstName;
  if (/\b(last.?name|family name|surname)\b/.test(label)) return lastName;
  if (/\b(full.?name|your name|name)\b/.test(label) && !/company|organization/.test(label)) return fullName;
  if (/\b(city|location|address)\b/.test(label)) return profile.location;
  if (/\b(linkedin)\b/.test(label)) return "";
  if (/\b(github)\b/.test(label)) return "";
  if (/\b(website|portfolio)\b/.test(label)) return "";
  if (/\b(summary|about you|cover letter|introduction|message)\b/.test(label)) return null;
  return undefined;
}

function challengeMessage(content: string, url: string) {
  const text = `${url}\n${content}`.toLowerCase();
  if (/(captcha|recaptcha|hcaptcha|verify you are human|i'm not a robot)/.test(text)) {
    return "CAPTCHA or human verification detected. Complete it manually, then prepare the application again.";
  }
  if (/(multi-factor|two-factor|one-time password|verification code|authenticator app)/.test(text)) {
    return "MFA or a verification code is required. JobPilot stopped without attempting to bypass it.";
  }
  if (/(sign in|log in|login|create an account)/.test(text) && !/application|apply/.test(text)) {
    return "The portal requires an account session. Sign in manually, then prepare the application again.";
  }
  return null;
}

async function findFieldDescriptors(page: Page) {
  return page.locator("input, textarea, select").evaluateAll((elements) =>
    elements.map((element, index) => {
      const node = element as unknown as {
        id?: string;
        name?: string;
        type?: string;
        value?: string;
        required?: boolean;
        disabled?: boolean;
        offsetParent?: unknown;
        getAttribute: (name: string) => string | null;
        closest: (selector: string) => { textContent?: string | null } | null;
      };
      const explicitLabel = node.getAttribute("aria-label") ?? "";
      const parentLabel = node.closest("label")?.textContent ?? "";
      return {
        index,
        name: node.name,
        id: node.id,
        label: `${explicitLabel} ${parentLabel}`,
        placeholder: node.getAttribute("placeholder") ?? "",
        type: node.type ?? "",
        required: node.required,
        disabled: node.disabled,
        hidden: node.type === "hidden" || node.offsetParent === null,
        value: node.value,
      };
    }),
  );
}

function getSubmitButton(page: Page) {
  return page.locator("button, input[type='submit']").filter({
    hasText: /apply|submit|send application|finish/i,
  }).first();
}

async function uploadDocuments(
  page: Page,
  generation: typeof documentGenerationsTable.$inferSelect,
) {
  const directory = path.join(os.tmpdir(), "jobpilot-execution");
  await mkdir(directory, { recursive: true });
  const cvPath = path.join(directory, `cv-${generation.id}.docx`);
  const coverPath = path.join(directory, `cover-letter-${generation.id}.docx`);
  await Promise.all([
    writeFile(cvPath, await markdownToDocx(generation.cvMarkdown)),
    writeFile(coverPath, await markdownToDocx(generation.coverLetterMarkdown)),
  ]);

  const files = page.locator("input[type='file']");
  const count = await files.count();
  for (let index = 0; index < count; index += 1) {
    const field = files.nth(index);
    const descriptor = await field.evaluate((element) => ({
      name: (element as unknown as { name?: string }).name,
      id: (element as unknown as { id?: string }).id,
      label: (element as unknown as { closest: (selector: string) => { textContent?: string | null } | null })
        .closest("label")?.textContent ?? "",
    }));
    const label = labelForField(descriptor);
    await field.setInputFiles(/cover|letter/.test(label) ? coverPath : cvPath);
  }
  return { cvPath, coverPath };
}

export async function executeApplication(input: ExecutionInput): Promise<ExecutionResult> {
  const portalType = portalForUrl(input.job.sourceUrl);
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let temporaryFiles: string[] = [];

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    await page.goto(input.job.sourceUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(700);

    const challenge = challengeMessage(await page.locator("body").innerText().catch(() => ""), page.url());
    if (challenge) {
      await browser.close();
      return {
        portalType,
        executionState: "blocked",
        currentStep: "blocked",
        filledFields: 0,
        totalFields: 0,
        unresolvedFields: [],
        requiresUserAction: true,
        approvalToken: null,
        message: challenge,
      };
    }

    const hasForm = await page.locator("form, input, textarea, select").count() > 0;
    if (!hasForm) {
      const applyLink = page.locator("a, button").filter({ hasText: /apply now|apply for this job|apply/i }).first();
      if (await applyLink.count() > 0) {
        await applyLink.click();
        await page.waitForTimeout(700);
      }
    }

    const descriptors = await findFieldDescriptors(page);
    const visibleFields = descriptors.filter((field) => !field.hidden && !field.disabled);
    const unresolvedFields: string[] = [];
    let filledFields = 0;
    let hasSensitiveQuestion = false;

    for (const field of visibleFields) {
      const label = labelForField(field);
      if (field.required && sensitiveQuestionPattern.test(label)) {
        hasSensitiveQuestion = true;
        unresolvedFields.push(field.label || field.name || field.id || "Sensitive question");
        continue;
      }
      if (field.type === "file") continue;
      const value = valueForField(field, input.profile);
      const locator = page.locator("input, textarea, select").nth(field.index);
      if (value === null) {
        if (input.generation) {
          await locator.fill(input.generation.coverLetterMarkdown);
          filledFields += 1;
        } else if (field.required) {
          unresolvedFields.push(field.label || field.name || field.id || "Cover letter");
        }
        continue;
      }
      if (typeof value === "string" && value.length > 0) {
        if (field.type === "select-one") {
          await locator.selectOption({ label: value }).catch(async () => locator.selectOption({ value }).catch(() => undefined));
        } else {
          await locator.fill(value);
        }
        filledFields += 1;
      } else if (field.required && !field.value) {
        unresolvedFields.push(field.label || field.name || field.id || "Required field");
      }
    }

    if (input.generation && await page.locator("input[type='file']").count()) {
      const uploaded = await uploadDocuments(page, input.generation);
      temporaryFiles = [uploaded.cvPath, uploaded.coverPath];
      filledFields += await page.locator("input[type='file']").count();
    }

    const totalFields = visibleFields.filter((field) => field.type !== "hidden").length;
    const submitButton = getSubmitButton(page);
    const hasSubmit = await submitButton.count() > 0;
    if (!hasSubmit) unresolvedFields.push("Application submit control");
    if (!input.generation && await page.locator("input[type='file']").count()) {
      unresolvedFields.push("Approved tailored CV and cover letter");
    }

    if (hasSensitiveQuestion || unresolvedFields.length) {
      await browser.close();
      return {
        portalType,
        executionState: "blocked",
        currentStep: "manual_review",
        filledFields,
        totalFields,
        unresolvedFields,
        requiresUserAction: true,
        approvalToken: null,
        message: hasSensitiveQuestion
          ? "A sensitive or legal question requires your answer. JobPilot stopped before submission."
          : "Some required fields could not be mapped safely. Review the portal manually before submitting.",
      };
    }

    if (input.submitAutomatically) {
      await submitButton.click();
      await page.waitForTimeout(1_000);
      const afterSubmitChallenge = challengeMessage(
        await page.locator("body").innerText().catch(() => ""),
        page.url(),
      );
      if (afterSubmitChallenge) {
        await browser.close();
        return {
          portalType,
          executionState: "blocked",
          currentStep: "post_submit_check",
          filledFields,
          totalFields,
          unresolvedFields: [],
          requiresUserAction: true,
          approvalToken: null,
          message: afterSubmitChallenge,
        };
      }
      await browser.close();
      return {
        portalType,
        executionState: "submitted",
        currentStep: "submitted",
        filledFields,
        totalFields,
        unresolvedFields: [],
        requiresUserAction: false,
        approvalToken: null,
        message: "Application submitted through the supported portal.",
      };
    }

    const approvalToken = randomBytes(24).toString("hex");
    return {
      portalType,
      executionState: "ready_for_submit",
      currentStep: "review_before_submit",
      filledFields,
      totalFields,
      unresolvedFields: [],
      requiresUserAction: true,
      approvalToken,
      message: "The supported portal is filled and ready for your final review.",
      browser,
      context,
      page,
    };
  } catch (error) {
    if (browser) await browser.close().catch(() => undefined);
    if (error instanceof ExecutionBlockedError) throw error;
    return {
      portalType,
      executionState: "failed",
      currentStep: "failed",
      filledFields: 0,
      totalFields: 0,
      unresolvedFields: [],
      requiresUserAction: true,
      approvalToken: null,
      message: error instanceof Error ? error.message : "The application portal could not be opened.",
    };
  } finally {
    await Promise.all(temporaryFiles.map((file) => rm(file, { force: true }).catch(() => undefined)));
  }
}

export async function submitPreparedApplication(page: Page) {
  const submitButton = getSubmitButton(page);
  if (await submitButton.count() === 0) {
    throw new Error("The application submit control is no longer available.");
  }
  await submitButton.click();
  await page.waitForTimeout(1_000);
  const challenge = challengeMessage(await page.locator("body").innerText().catch(() => ""), page.url());
  if (challenge) throw new Error(challenge);
}

export function portalFromUrl(rawUrl: string) {
  return portalForUrl(rawUrl);
}