import { ReplitConnectors } from "@replit/connectors-sdk";

export type GmailMessage = {
  id: string;
  threadId: string;
  date: string;
  sender: string;
  subject: string;
  snippet: string;
};

export type RecruiterSignalType =
  | "reply"
  | "assessment"
  | "interview"
  | "offer"
  | "rejection";

type GmailSearchResponse = {
  threads?: Array<{
    id?: string;
    messages?: Array<Partial<GmailMessage>>;
  }>;
};

const connectors = new ReplitConnectors();

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function significantWords(value: string) {
  return normalize(value)
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !["inc", "llc", "ltd", "the", "role", "jobs"].includes(word));
}

export function matchesApplication(message: GmailMessage, company: string, title: string) {
  const text = normalize(`${message.sender} ${message.subject} ${message.snippet}`);
  const companyText = normalize(company);
  if (companyText && text.includes(companyText)) return true;
  const companyWords = significantWords(company);
  if (companyWords.some((word) => text.includes(word))) return true;
  const titleMatches = significantWords(title).filter((word) => text.includes(word));
  return titleMatches.length >= 2;
}

export function classifyRecruiterMessage(message: GmailMessage): RecruiterSignalType {
  const text = normalize(`${message.subject} ${message.snippet}`);
  if (/(offer|compensation package|congratulations)/.test(text)) return "offer";
  if (/(interview|phone screen|recruiter screen|onsite|on site|schedule.*call|meet the team)/.test(text)) {
    return "interview";
  }
  if (/(assessment|coding challenge|take home|take-home|technical exercise|assignment)/.test(text)) {
    return "assessment";
  }
  if (/(not moving forward|move forward with other|unfortunately|regret to inform|rejected|withdrawn)/.test(text)) {
    return "rejection";
  }
  return "reply";
}

export async function searchRecentRecruiterMail() {
  const query = encodeURIComponent("newer_than:90d -from:me");
  const response = await connectors.proxy(
    "google-mail",
    `/gmail/v1/users/me/threads:search?q=${query}&pageSize=50&view=THREAD_VIEW_MINIMAL`,
    { method: "GET" },
  );
  if (!response.ok) {
    throw new Error(`Gmail search failed with status ${response.status}.`);
  }
  const payload = (await response.json()) as GmailSearchResponse;
  const messages: GmailMessage[] = [];
  for (const thread of payload.threads ?? []) {
    for (const message of thread.messages ?? []) {
      if (
        typeof message.id === "string" &&
        typeof message.date === "string" &&
        typeof message.sender === "string" &&
        typeof message.subject === "string" &&
        typeof message.snippet === "string"
      ) {
        messages.push({
          id: message.id,
          threadId: message.threadId ?? thread.id ?? message.id,
          date: message.date,
          sender: message.sender,
          subject: message.subject,
          snippet: message.snippet,
        });
      }
    }
  }
  return { scannedThreads: payload.threads?.length ?? 0, messages };
}