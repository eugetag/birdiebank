/**
 * Server-only OpenAI Vision scorecard reader.
 */

import OpenAI from "openai";
import { APIError } from "openai";
import {
  parseScorecardAnalysisJson,
  type ScorecardAnalyzeFailure,
  type ScorecardAnalyzeSuccess,
  type ScorecardAnalysisResult,
} from "./scorecard-analysis";

const DEFAULT_MODEL = "gpt-4o";

export type AnalyzeScorecardInput = {
  imageBase64: string;
  mimeType: string;
  playerNames: string[];
  holeCount: 9 | 18;
  holes: number[];
};

export type AnalyzeScorecardVisionResult =
  | ScorecardAnalyzeSuccess
  | ScorecardAnalyzeFailure;

function buildSystemPrompt(): string {
  return [
    "You read golf scorecard photos and return structured JSON only.",
    "Match player rows to the exact names provided by the host.",
    "Hole numbers in scores must be string keys (e.g. \"1\", \"10\").",
    "Use null for any score you cannot read confidently.",
    "Gross stroke counts only (not points or Stableford unless clearly labeled as strokes).",
    "Ignore handicap, par, yardage, and signature columns unless they are clearly player score columns.",
    "If the card shows front 9 and back 9, map to the requested hole numbers in order.",
    "confidence: high when most cells are clear, medium when some are uncertain, low when the image is blurry or ambiguous.",
    "notes: short strings explaining ambiguities, unread holes, or name mismatches.",
  ].join(" ");
}

function buildUserPrompt(input: AnalyzeScorecardInput): string {
  const holeList = input.holes.join(", ");
  return [
    `Round has ${input.holeCount} holes. Score these hole numbers only: ${holeList}.`,
    `Players (use these exact names in your response): ${input.playerNames.join(", ")}.`,
    "",
    "Return JSON with this shape:",
    "{",
    '  "players": [',
    '    { "name": string, "scores": { "1": number | null, "2": number | null, ... } }',
    "  ],",
    '  "confidence": "high" | "medium" | "low",',
    '  "notes": string[]',
    "}",
  ].join("\n");
}

function failure(
  error: string,
  rawResponse: string | null,
  parsedJson?: unknown,
): ScorecardAnalyzeFailure {
  return {
    success: false,
    error,
    rawResponse,
    debug: true,
    ...(parsedJson !== undefined ? { parsedJson } : {}),
  };
}

function success(
  result: ScorecardAnalysisResult,
  rawResponse: string,
): ScorecardAnalyzeSuccess {
  return {
    success: true,
    ...result,
    rawResponse,
    debug: true,
  };
}

export async function analyzeScorecardWithVision(
  apiKey: string,
  input: AnalyzeScorecardInput,
): Promise<AnalyzeScorecardVisionResult> {
  const model =
    process.env.OPENAI_SCORECARD_MODEL?.trim() || DEFAULT_MODEL;
  const client = new OpenAI({ apiKey });

  const dataUrl = `data:${input.mimeType};base64,${input.imageBase64}`;

  let completion;
  try {
    completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      max_tokens: 4096,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "user",
          content: [
            { type: "text", text: buildUserPrompt(input) },
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "high" },
            },
          ],
        },
      ],
    });
  } catch (err) {
    const message =
      err instanceof APIError
        ? err.message || `OpenAI API error (${err.status ?? "unknown"})`
        : err instanceof Error
          ? err.message
          : "OpenAI request failed.";
    return failure(message, null);
  }

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    return failure("Vision model returned an empty response.", null);
  }

  const rawResponse = content;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return failure("Vision model returned invalid JSON.", rawResponse);
  }

  const result = parseScorecardAnalysisJson(parsed);
  if (!result) {
    return failure(
      "Vision model JSON did not match the expected scorecard shape.",
      rawResponse,
      parsed,
    );
  }

  return success(result, rawResponse);
}

export function visionErrorMessage(err: unknown): string {
  if (err instanceof APIError) {
    return err.message || "OpenAI request failed.";
  }
  if (err instanceof Error) return err.message;
  return "Unexpected error reading scorecard.";
}
