import { openai } from "./client";

export const TAILORING_MODEL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
  ? "gpt-5.6-terra"
  : "gpt-5.4";

export type TailoringInput = {
  identity: {
    fullName: string;
    email: string;
    phone?: string;
    location?: string;
    headline?: string;
  };
  skills: string[];
  evidence: Array<{
    id: string;
    category: string;
    title: string;
    organization: string;
    startDate?: string;
    endDate?: string;
    detail: string;
    source: string;
  }>;
  job: {
    company: string;
    title: string;
    location: string;
    workMode: string;
    salary: string;
    description: string;
  };
  instructions: string;
};

export type TailoringOutput = {
  summaryEvidenceIds: string[];
  experienceEvidenceIds: string[];
  projectEvidenceIds: string[];
  educationEvidenceIds: string[];
  coverLetterEvidenceIds: string[];
};

export type EditedDocumentClaim = {
  section: string;
  text: string;
  evidenceId: string;
  supportingDetail: string;
};

export type EditedDocumentVerification = {
  claims: EditedDocumentClaim[];
  unsupportedClaims: string[];
};

const idListSchema = {
  type: "array",
  items: { type: "string" },
} as const;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summaryEvidenceIds",
    "experienceEvidenceIds",
    "projectEvidenceIds",
    "educationEvidenceIds",
    "coverLetterEvidenceIds",
  ],
  properties: {
    summaryEvidenceIds: idListSchema,
    experienceEvidenceIds: idListSchema,
    projectEvidenceIds: idListSchema,
    educationEvidenceIds: idListSchema,
    coverLetterEvidenceIds: idListSchema,
  },
} as const;

const verificationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["claims", "unsupportedClaims"],
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "text", "evidenceId", "supportingDetail"],
        properties: {
          section: { type: "string" },
          text: { type: "string" },
          evidenceId: { type: "string" },
          supportingDetail: { type: "string" },
        },
      },
    },
    unsupportedClaims: { type: "array", items: { type: "string" } },
  },
} as const;

/**
 * Ask the model only to rank/select evidence. All prose is composed
 * deterministically by the API from the selected structured records.
 */
export async function generateTailoredDocuments(
  input: TailoringInput,
): Promise<TailoringOutput> {
  const response = await openai.responses.create({
    model: TAILORING_MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You select and rank verified career evidence for ATS-friendly job documents. Return only exact IDs from the supplied evidence array. " +
              "Put experience/achievement IDs in experienceEvidenceIds, project IDs in projectEvidenceIds, and education/certification IDs in educationEvidenceIds. " +
              "Choose up to two strong summary IDs and up to three cover-letter IDs. Never write claims or invent IDs. Order each list by relevance to the job.",
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(input) }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "truthful_tailored_documents",
        strict: true,
        schema: responseSchema,
      },
    },
  });

  if (!response.output_text) {
    throw new Error("OpenAI returned no structured tailoring output.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.output_text);
  } catch {
    throw new Error("OpenAI returned invalid structured tailoring JSON.");
  }
  return parsed as TailoringOutput;
}

export async function verifyEditedDocuments(input: {
  cvMarkdown: string;
  coverLetterMarkdown: string;
  evidence: TailoringInput["evidence"];
  job: TailoringInput["job"];
}): Promise<EditedDocumentVerification> {
  const response = await openai.responses.create({
    model: TAILORING_MODEL,
    input: [
      {
        role: "system",
        content: [{
          type: "input_text",
          text:
            "Verify edited job documents against the supplied profile evidence. Extract every factual career claim from both documents. " +
            "For each supported claim, return the exact claim text as it appears, one evidenceId, and that evidence item's supportingDetail copied exactly. " +
            "A claim is supported only when its supportingDetail is exactly one supplied evidence detail after whitespace normalization. " +
            "Put every unsupported, invented, or unverifiable factual claim in unsupportedClaims. Do not treat the job description or ordinary application framing as career evidence.",
        }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(input) }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "verified_edited_documents",
        strict: true,
        schema: verificationSchema,
      },
    },
  });
  if (!response.output_text) throw new Error("OpenAI returned no edit verification output.");
  try {
    return JSON.parse(response.output_text) as EditedDocumentVerification;
  } catch {
    throw new Error("OpenAI returned invalid edit verification JSON.");
  }
}