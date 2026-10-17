import { getToken } from "@/lib/token";

export const REPORT_REASONS = [
  "report.reason.spam",
  "report.reason.abuse",
  "report.reason.fake",
  "report.reason.scam",
  "report.reason.content",
] as const;

export type ReportReasonKey = (typeof REPORT_REASONS)[number];

const API_REASON: Record<ReportReasonKey, string> = {
  "report.reason.spam": "spam",
  "report.reason.abuse": "harassment",
  "report.reason.fake": "fake",
  "report.reason.scam": "other",
  "report.reason.content": "offensive",
};

export function reportReasonToApi(reasonKey: string): string | null {
  return API_REASON[reasonKey as ReportReasonKey] ?? null;
}

export async function submitReport(
  reportedId: number,
  reasonKey: string,
  description: string,
): Promise<boolean> {
  const reason = reportReasonToApi(reasonKey);
  if (!Number.isInteger(reportedId) || reportedId <= 0 || !reason) return false;

  const token = getToken();
  try {
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        reported_id: reportedId,
        reason,
        description: description.trim() || undefined,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
