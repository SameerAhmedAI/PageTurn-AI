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

export type DocumentStatus = "processing" | "extracting" | "chunking" | "ready" | "failed";

export type DocumentRecord = {
  id: number;
  subject_id: number;
  filename: string;
  upload_status: DocumentStatus;
  page_count: number | null;
  error_message: string | null;
  uploaded_at: string;
};

export type ExplanationMode = "simple" | "university";

export type Citation = {
  chunk_id?: number;
  document_id: number;
  filename: string;
  page_number: number;
  chunk_text: string;
};

export type GenerationType =
  | "summary"
  | "mcq"
  | "flashcard"
  | "short_answer"
  | "topic_prediction"
  | "exam_prep";

export type SummaryContent = {
  type: "summary";
  topic: string | null;
  title: string;
  sections: Array<{
    heading: string;
    bullets: string[];
  }>;
  citations: Citation[];
  error?: string;
};

export type McqContent = {
  type: "mcq";
  topic: string | null;
  questions: Array<{
    id: number;
    question: string;
    options: string[];
    correct_index: number;
    explanation: string;
    citation: Citation;
  }>;
  error?: string;
};

export type FlashcardContent = {
  type: "flashcard";
  topic: string | null;
  cards: Array<{
    id: number;
    front: string;
    back: string;
    citation: Citation;
    review_state: string;
  }>;
  error?: string;
};

export type ShortAnswerContent = {
  type: "short_answer";
  topic: string | null;
  questions: Array<{
    id: number;
    question: string;
    answer_guide: string;
    difficulty: "short" | "long";
    citation: Citation;
  }>;
  error?: string;
};

export type TopicPredictionContent = {
  type: "topic_prediction";
  topic: null;
  title: string;
  topics: Array<{
    id: number;
    name: string;
    reason: string;
    source_chunk_ids?: string[];
    citations: Citation[];
  }>;
  error?: string;
};

export type ExamPrepContent = {
  type: "exam_prep";
  topic: null;
  title: string;
  selected_chunk_ids: number[];
  topics_covered: TopicPredictionContent["topics"];
  summary: SummaryContent;
  mcqs: McqContent;
  short_answer_questions: ShortAnswerContent;
  error?: string;
};

export type GeneratedContentPayload =
  | SummaryContent
  | McqContent
  | FlashcardContent
  | ShortAnswerContent
  | TopicPredictionContent
  | ExamPrepContent;

export type GeneratedContent = {
  id: number;
  subject_id: number;
  type: GenerationType;
  content_json: GeneratedContentPayload;
  created_at: string;
};

export type LlmConfig = {
  ollama_host: string;
  ollama_model: string;
  groq_configured: boolean;
  groq_model: string;
};

export type DashboardStats = {
  subject_count: number;
  document_count: number;
  chat_session_count: number;
  generated_set_count: number;
};

export type ChatHistoryMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  citations: Citation[];
};

export type ChatHistorySession = {
  id: number;
  subject_id: number;
  created_at: string;
  title: string;
  messages: ChatHistoryMessage[];
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export async function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export async function fetchLlmConfig(): Promise<LlmConfig> {
  return request<LlmConfig>("/settings/llm");
}

export async function fetchSubjects(): Promise<Subject[]> {
  return request<Subject[]>("/subjects");
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  return request<DashboardStats>("/subjects/dashboard/stats");
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

export async function updateSubject(subjectId: number, name: string): Promise<Subject> {
  return request<Subject>(`/subjects/${subjectId}`, {
    method: "PATCH",
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

export async function deleteSubject(subjectId: number): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/subjects/${subjectId}`, {
    method: "DELETE",
  });
}

export async function deleteDocument(
  subjectId: number,
  documentId: number,
): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/subjects/${subjectId}/documents/${documentId}`, {
    method: "DELETE",
  });
}

export async function deleteGeneratedContent(
  subjectId: number,
  contentId: number,
): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/subjects/${subjectId}/generated/${contentId}`, {
    method: "DELETE",
  });
}

export function getDocumentFileUrl(documentId: number, pageNumber: number): string {
  return `${API_BASE_URL}/subjects/document-files/${documentId}#page=${pageNumber}`;
}

export async function generateStudyContent({
  subjectId,
  type,
  topic,
  count,
  selectedChunkIds,
}: {
  subjectId: number;
  type: GenerationType;
  topic?: string;
  count?: number;
  selectedChunkIds?: number[];
}): Promise<GeneratedContent> {
  return request<GeneratedContent>(`/subjects/${subjectId}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type,
      topic: topic?.trim() || null,
      count: count ?? 5,
      selected_chunk_ids: selectedChunkIds ?? null,
    }),
  });
}

export async function predictImportantTopics(subjectId: number): Promise<GeneratedContent> {
  return request<GeneratedContent>(`/subjects/${subjectId}/predict-topics`, {
    method: "POST",
  });
}

export async function generateExamPrepPack({
  selectedChunkIds,
  selectedTopics,
  subjectId,
}: {
  subjectId: number;
  selectedChunkIds: number[];
  selectedTopics: TopicPredictionContent["topics"];
}): Promise<GeneratedContent> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 300000);

  try {
    return await request<GeneratedContent>(`/subjects/${subjectId}/exam-prep`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        selected_chunk_ids: selectedChunkIds,
        selected_topics: selectedTopics,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Exam prep generation timed out after 5 minutes. Try fewer topics or check the LLM provider.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchGeneratedContent(subjectId: number): Promise<GeneratedContent[]> {
  return request<GeneratedContent[]>(`/subjects/${subjectId}/generated`);
}

export async function fetchAllGeneratedContent(): Promise<GeneratedContent[]> {
  return request<GeneratedContent[]>("/subjects/generated/all");
}

export async function fetchChatHistory(subjectId: number): Promise<ChatHistorySession[]> {
  return request<ChatHistorySession[]>(`/subjects/${subjectId}/chat/history`);
}

export function getGeneratedExportUrl(
  subjectId: number,
  contentId: number,
  format: "markdown" | "pdf",
): string {
  return `${API_BASE_URL}/subjects/${subjectId}/export/${contentId}?format=${format}`;
}

export async function streamChatAnswer({
  subjectId,
  question,
  explanationMode,
  sessionId,
  onToken,
  onCitations,
  onSession,
}: {
  subjectId: number;
  question: string;
  explanationMode: ExplanationMode;
  sessionId?: number | null;
  onToken: (text: string) => void;
  onCitations: (citations: Citation[]) => void;
  onSession?: (sessionId: number) => void;
}): Promise<void> {
  const response = await fetchApi(`/subjects/${subjectId}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      question,
      explanation_mode: explanationMode,
      session_id: sessionId ?? null,
    }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  if (!response.body) {
    throw new Error("The chat stream did not return a response body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const eventBlock of events) {
      handleSseEvent(eventBlock, onToken, onCitations, onSession);
    }
  }

  if (buffer.trim()) {
    handleSseEvent(buffer, onToken, onCitations, onSession);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchApi(path, init);

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return response.json() as Promise<T>;
}

async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, init);
  } catch (error) {
    if (error instanceof Error && error.message === "Failed to fetch") {
      throw new Error(
        "The request failed before the backend response could be read. " +
          "Check that the API is running and that CORS is returning error responses.",
      );
    }

    throw error;
  }
}

async function getErrorMessage(response: Response): Promise<string> {
  const fallback = `Request failed with status ${response.status}`;

  try {
    const body = await response.text();
    if (!body.trim()) {
      return fallback;
    }

    try {
      const data = JSON.parse(body) as { detail?: unknown; error?: unknown; message?: unknown };
      if (typeof data.detail === "string") {
        return data.detail;
      }
      if (typeof data.message === "string") {
        return data.message;
      }
      if (typeof data.error === "string") {
        return data.error;
      }
      if (Array.isArray(data.detail)) {
        return data.detail
          .map((item) => {
            if (typeof item === "string") {
              return item;
            }
            if (
              item &&
              typeof item === "object" &&
              "msg" in item &&
              typeof item.msg === "string"
            ) {
              return item.msg;
            }
            return JSON.stringify(item);
          })
          .join("; ");
      }
    } catch {
      return body;
    }
  } catch {
    // Fall through to the status message when the backend does not return JSON.
  }

  return fallback;
}

function handleSseEvent(
  eventBlock: string,
  onToken: (text: string) => void,
  onCitations: (citations: Citation[]) => void,
  onSession?: (sessionId: number) => void,
) {
  const lines = eventBlock.split("\n");
  const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
  const dataLine = lines.find((line) => line.startsWith("data: "));

  if (!event || !dataLine) {
    return;
  }

  const data = JSON.parse(dataLine.slice(6)) as {
    id?: number;
    text?: string;
    citations?: Citation[];
  };

  if (event === "session" && typeof data.id === "number") {
    onSession?.(data.id);
  }

  if (event === "token" && typeof data.text === "string") {
    onToken(data.text);
  }

  if (event === "citations" && Array.isArray(data.citations)) {
    onCitations(data.citations);
  }
}
