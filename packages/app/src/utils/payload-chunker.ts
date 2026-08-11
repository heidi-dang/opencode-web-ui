/**
 * Dynamic Payload Chunker for high-reliability file transfers
 */

export interface ChunkInfo {
  index: number;
  total: number;
  sha256: string;
  data: Blob;
}

export async function computeSHA256(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function chunkFile(file: File | Blob, chunkSize: number = 1024 * 1024): Promise<ChunkInfo[]> {
  const total = Math.ceil(file.size / chunkSize);
  const chunks: ChunkInfo[] = [];

  for (let index = 0; index < total; index++) {
    const start = index * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const chunkData = file.slice(start, end);
    const sha256 = await computeSHA256(chunkData);
    chunks.push({
      index,
      total,
      sha256,
      data: chunkData
    });
  }

  return chunks;
}

export interface ChunkUploaderOptions {
  uploadUrl: string;
  maxRetries?: number;
  customFetch?: typeof fetch;
}

export async function uploadFileInChunks(
  file: File | Blob,
  fileName: string,
  options: ChunkUploaderOptions
): Promise<Response> {
  const chunks = await chunkFile(file);
  const customFetch = options.customFetch ?? fetch;
  const maxRetries = options.maxRetries ?? 3;
  const uploadId = crypto.randomUUID();

  for (const chunk of chunks) {
    let attempts = 0;
    let success = false;
    let lastError: unknown;

    while (attempts < maxRetries && !success) {
      try {
        const formData = new FormData();
        formData.append("uploadId", uploadId);
        formData.append("fileName", fileName);
        formData.append("chunkIndex", String(chunk.index));
        formData.append("totalChunks", String(chunk.total));
        formData.append("sha256", chunk.sha256);
        formData.append("file", chunk.data);

        const res = await customFetch(options.uploadUrl, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          throw new Error(`Upload response status ${res.status}`);
        }

        success = true;
      } catch (error) {
        attempts++;
        lastError = error;
        // Exponential backoff before retry
        await new Promise(r => setTimeout(r, 200 * 2 ** attempts));
      }
    }

    if (!success) {
      throw new Error(`Chunk ${chunk.index}/${chunk.total} upload failed after ${maxRetries} attempts. Reason: ${String(lastError)}`);
    }
  }

  // Finalize call
  const finalizeRes = await customFetch(`${options.uploadUrl}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, fileName, totalChunks: chunks.length }),
  });

  return finalizeRes;
}
