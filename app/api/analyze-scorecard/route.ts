import { analyzeScorecardWithVision } from "@/lib/analyze-scorecard-vision";
import type { ScorecardAnalyzeApiResponse } from "@/lib/scorecard-analysis";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function debugFailure(
  error: string,
  rawResponse: string | null = null,
  parsedJson?: unknown,
): Response {
  const body: ScorecardAnalyzeApiResponse = {
    success: false,
    error,
    rawResponse,
    debug: true,
    ...(parsedJson !== undefined ? { parsedJson } : {}),
  };
  console.log("OCR response", body);
  return Response.json(body, { status: 200 });
}

function parsePlayerNames(raw: FormDataEntryValue | null): string[] | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const names = parsed
      .filter((n): n is string => typeof n === "string" && n.trim() !== "")
      .map((n) => n.trim());
    return names.length > 0 ? names : null;
  } catch {
    return null;
  }
}

function parseHoles(raw: FormDataEntryValue | null): number[] | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const holes = parsed
      .map((h) => (typeof h === "number" ? h : Number(h)))
      .filter((h) => Number.isInteger(h) && h >= 1 && h <= 18);
    return holes.length > 0 ? holes : null;
  } catch {
    return null;
  }
}

function parseHoleCount(raw: FormDataEntryValue | null): 9 | 18 | null {
  const n = typeof raw === "string" ? Number(raw) : NaN;
  if (n === 9 || n === 18) return n;
  return null;
}

function mimeForFile(file: File): string {
  if (file.type && ACCEPTED_MIMES.has(file.type)) return file.type;
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  return "image/jpeg";
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return debugFailure("Server is not configured with OPENAI_API_KEY.");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return debugFailure("Expected multipart form data with an image upload.");
  }

  const imageEntry = formData.get("image");
  if (!(imageEntry instanceof File)) {
    return debugFailure("Missing image file.");
  }

  if (imageEntry.size === 0) {
    return debugFailure("Image file is empty.");
  }
  if (imageEntry.size > MAX_IMAGE_BYTES) {
    return debugFailure("Image must be 8 MB or smaller.");
  }

  const mimeType = mimeForFile(imageEntry);
  if (
    !ACCEPTED_MIMES.has(mimeType) &&
    !imageEntry.name.match(/\.(jpe?g|png|heic|heif)$/i)
  ) {
    return debugFailure("Use a JPG, PNG, or HEIC scorecard photo.");
  }

  const playerNames = parsePlayerNames(formData.get("playerNames"));
  if (!playerNames) {
    return debugFailure("playerNames must be a JSON array of strings.");
  }

  const holes = parseHoles(formData.get("holes"));
  if (!holes) {
    return debugFailure("holes must be a JSON array of hole numbers.");
  }

  const holeCount = parseHoleCount(formData.get("holeCount"));
  if (!holeCount) {
    return debugFailure("holeCount must be 9 or 18.");
  }

  const buffer = Buffer.from(await imageEntry.arrayBuffer());
  const imageBase64 = buffer.toString("base64");

  console.log("OCR request", {
    fileName: imageEntry.name,
    mimeType,
    byteLength: buffer.length,
    playerNames,
    holeCount,
    holes,
  });

  try {
    const outcome = await analyzeScorecardWithVision(apiKey, {
      imageBase64,
      mimeType,
      playerNames,
      holeCount,
      holes,
    });

    console.log("OCR response", outcome);
    return Response.json(outcome, { status: 200 });
  } catch (err) {
    const error =
      err instanceof Error ? err.message : "Unexpected error reading scorecard.";
    return debugFailure(error, null);
  }
}
