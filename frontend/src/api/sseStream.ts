import { sanitizeErrorMessage } from "../utils/apiError";

type SseStreamEvent = {
  event: string;
  data: string;
};

type JsonSseStreamEvent = {
  event: string;
  payload: Record<string, unknown>;
};

export async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseStreamEvent) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "message";
  let currentDataLines: string[] = [];

  const dispatchEvent = () => {
    if (currentDataLines.length === 0) {
      currentEvent = "message";
      return;
    }
    const event = currentEvent;
    const data = currentDataLines.join("\n");
    currentEvent = "message";
    currentDataLines = [];
    onEvent({ event, data });
  };

  const processLine = (line: string) => {
    if (line === "") {
      dispatchEvent();
      return;
    }
    if (line.startsWith(":")) {
      return;
    }
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim() || "message";
      return;
    }
    if (line.startsWith("data:")) {
      currentDataLines.push(line.slice(5).trimStart());
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      processLine(line);
      newlineIndex = buffer.indexOf("\n");
    }
    if (done) {
      if (buffer.length > 0) {
        processLine(buffer);
      }
      processLine("");
      return;
    }
  }
}

export async function consumeJsonSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: JsonSseStreamEvent) => void
): Promise<void> {
  await consumeSseStream(body, ({ event, data }) => {
    const payload = data ? (JSON.parse(data) as Record<string, unknown>) : {};
    onEvent({ event, payload });
  });
}

export function buildSseError(payload: Record<string, unknown>, fallback: string): Error {
  const detail = typeof payload.detail === "string"
    ? payload.detail
    : JSON.stringify(payload.detail ?? payload);
  return new Error(sanitizeErrorMessage(detail || fallback, fallback));
}
