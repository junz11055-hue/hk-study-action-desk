const defaultRequestLimit = 4_096;
const defaultResponseLimit = 1_048_576;

export type BoundedJsonResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; reason: "content_type" | "size" | "encoding" | "json" }>;

function jsonContentType(headers: Headers): boolean {
  return (
    headers.get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() === "application/json"
  );
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  if (stream === null) return null;

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const payload = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return payload;
}

async function parseBoundedJson(
  headers: Headers,
  stream: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<BoundedJsonResult> {
  if (!jsonContentType(headers)) {
    return { ok: false, reason: "content_type" };
  }

  const declaredLength = headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    return { ok: false, reason: "size" };
  }

  const payload = await readBoundedStream(stream, maximumBytes);
  if (payload === null) {
    return { ok: false, reason: "size" };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    return { ok: false, reason: "encoding" };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "json" };
  }
}

export function readBoundedRequestJson(
  request: Request,
  maximumBytes = defaultRequestLimit,
): Promise<BoundedJsonResult> {
  return parseBoundedJson(request.headers, request.body, maximumBytes);
}

export function readBoundedResponseJson(
  response: Response,
  maximumBytes = defaultResponseLimit,
): Promise<BoundedJsonResult> {
  return parseBoundedJson(response.headers, response.body, maximumBytes);
}
