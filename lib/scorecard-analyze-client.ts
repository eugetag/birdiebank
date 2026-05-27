/**
 * Client helper for POST /api/analyze-scorecard (no API keys in browser).
 */

import {
  extractedPlayerNames,
  parseScorecardAnalysisJson,
  type OcrDebugState,
  type ScorecardAnalyzeApiResponse,
  type ScorecardAnalysisResult,
} from "./scorecard-analysis";

export const SCORECARD_READ_ERROR =
  "Could not read scorecard clearly. Please enter scores manually.";

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export type ScorecardAnalyzeRequest = {
  imageDataUrl: string;
  fileName: string;
  playerNames: string[];
  holeCount: 9 | 18;
  holes: number[];
};

/** Always returns the API body; never throws on logical OCR failures. */
export async function requestScorecardAnalysis(
  input: ScorecardAnalyzeRequest,
): Promise<ScorecardAnalyzeApiResponse> {
  console.log("OCR request", {
    fileName: input.fileName,
    playerNames: input.playerNames,
    holeCount: input.holeCount,
    holes: input.holes,
  });

  const blob = await dataUrlToBlob(input.imageDataUrl);
  const formData = new FormData();
  formData.append("image", blob, input.fileName);
  formData.append("playerNames", JSON.stringify(input.playerNames));
  formData.append("holes", JSON.stringify(input.holes));
  formData.append("holeCount", String(input.holeCount));

  let res: Response;
  try {
    res = await fetch("/api/analyze-scorecard", {
      method: "POST",
      body: formData,
    });
  } catch (err) {
    const error =
      err instanceof Error ? err.message : "Network error calling analyze-scorecard.";
    const failure: ScorecardAnalyzeApiResponse = {
      success: false,
      error,
      rawResponse: null,
      debug: true,
    };
    console.log("OCR response", failure);
    return failure;
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    const failure: ScorecardAnalyzeApiResponse = {
      success: false,
      error: `Invalid JSON from server (HTTP ${res.status}).`,
      rawResponse: null,
      debug: true,
    };
    console.log("OCR response", failure);
    return failure;
  }

  console.log("OCR response", body);

  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    (body as { success?: unknown }).success === false
  ) {
    const fail = body as ScorecardAnalyzeApiResponse & { success: false };
    return {
      success: false,
      error: typeof fail.error === "string" ? fail.error : "Unknown OCR error.",
      rawResponse:
        typeof fail.rawResponse === "string" ? fail.rawResponse : null,
      debug: true,
      ...(fail.parsedJson !== undefined ? { parsedJson: fail.parsedJson } : {}),
    };
  }

  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    (body as { success?: unknown }).success === true
  ) {
    return body as ScorecardAnalyzeApiResponse & { success: true };
  }

  return {
    success: false,
    error: `Unexpected API response shape (HTTP ${res.status}).`,
    rawResponse:
      typeof body === "string" ? body : JSON.stringify(body, null, 2),
    debug: true,
    parsedJson: body,
  };
}

function parseRawJson(
  rawResponse: string | null,
  parsedJson?: unknown,
): unknown {
  if (parsedJson !== undefined) return parsedJson;
  if (!rawResponse) return null;
  try {
    return JSON.parse(rawResponse) as unknown;
  } catch {
    return rawResponse;
  }
}

export function buildOcrDebugState(
  imageDataUrl: string,
  response: ScorecardAnalyzeApiResponse,
): OcrDebugState {
  const rawResponse = response.success
    ? response.rawResponse
    : response.rawResponse ?? null;

  const rawJson = response.success
    ? parseRawJson(response.rawResponse)
    : parseRawJson(
        response.rawResponse,
        "parsedJson" in response ? response.parsedJson : undefined,
      );

  const parsed = response.success
    ? response
    : parseScorecardAnalysisJson(rawJson);

  const error = response.success ? null : response.error;

  return {
    imageDataUrl,
    error,
    rawResponse,
    rawJson,
    confidence: parsed?.confidence ?? (response.success ? response.confidence : null),
    notes: parsed?.notes ?? (response.success ? response.notes : []),
    extractedPlayerNames: extractedPlayerNames(parsed, rawJson),
    aiResponseSummary: rawResponse,
  };
}

/** Best-effort parse for review UI when the API reports failure. */
export function tryParseAnalysisFromResponse(
  response: ScorecardAnalyzeApiResponse,
): ScorecardAnalysisResult | null {
  if (response.success) return response;
  const rawJson = parseRawJson(
    response.rawResponse,
    "parsedJson" in response ? response.parsedJson : undefined,
  );
  return parseScorecardAnalysisJson(rawJson);
}
