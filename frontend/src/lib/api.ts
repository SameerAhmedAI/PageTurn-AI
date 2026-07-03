export type HealthResponse = {
  status: string;
  service: string;
  version: string;
  checked_at: string;
};

export type Subject = {
  id: number;
  name: string;
  created_at: string;
  document_count: number;
};

export type DocumentStatus = "processing" | "extracting" | "ready" | "failed";

export type DocumentRecord = {
  id: number;
  subject_id: number;
  filename: string;
  upload_status: DocumentStatus;
  page_count: number | null;
  error_message: string | null;
  uploaded_at: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export async function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export async function fetchSubjects(): Promise<Subject[]> {
  return request<Subject[]>("/subjects");
}

export async function createSubject(name: string): Promise<Subject> {
  return request<Subject>("/subjects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
}

export async function fetchDocuments(subjectId: number): Promise<DocumentRecord[]> {
  return request<DocumentRecord[]>(`/subjects/${subjectId}/documents`);
}

export async function uploadDocument(
  subjectId: number,
  file: File,
): Promise<DocumentRecord> {
  const body = new FormData();
  body.append("file", file);

  return request<DocumentRecord>(`/subjects/${subjectId}/documents`, {
    method: "POST",
    body,
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return response.json() as Promise<T>;
}

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { detail?: unknown };
    if (typeof data.detail === "string") {
      return data.detail;
    }
  } catch {
    // Fall through to the status message when the backend does not return JSON.
  }

  return `Request failed with status ${response.status}`;
}
