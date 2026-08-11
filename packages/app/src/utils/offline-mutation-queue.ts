/**
 * Offline Event Queue Persistence (IndexedDB)
 */

export interface OfflineMutation {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  timestamp: number;
}

const DB_NAME = "opencode-offline-queue";
const STORE_NAME = "mutations";

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueueOfflineMutation(mutation: Omit<OfflineMutation, "id" | "timestamp">): Promise<void> {
  const id = Math.random().toString(36).substring(2) + Date.now().toString(36);
  const record: OfflineMutation = {
    ...mutation,
    id,
    timestamp: Date.now(),
  };

  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOfflineMutations(): Promise<OfflineMutation[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const results = request.result as OfflineMutation[];
      // Sort by timestamp to ensure in-order execution
      results.sort((a, b) => a.timestamp - b.timestamp);
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function clearOfflineMutation(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let isReplaying = false;

export async function replayOfflineMutations(customFetch = fetch): Promise<void> {
  if (isReplaying) return;
  isReplaying = true;

  try {
    const mutations = await getOfflineMutations();
    for (const mut of mutations) {
      try {
        const res = await customFetch(mut.url, {
          method: mut.method,
          headers: mut.headers,
          body: mut.body,
        });
        if (res.ok) {
          await clearOfflineMutation(mut.id);
        } else {
          // If server rejects with client error (e.g. 400), clear it to prevent blocking the queue.
          // If it's a transient 5xx or server timeout, halt replaying to retry later.
          if (res.status >= 400 && res.status < 500) {
            await clearOfflineMutation(mut.id);
          } else {
            console.warn(`[offline-queue] mutation replay failed with status ${res.status}, halting queue replay.`);
            break;
          }
        }
      } catch (error) {
        console.error("[offline-queue] mutation replay error", error);
        break; // Stop replay on network connection errors
      }
    }
  } finally {
    isReplaying = false;
  }
}

// Setup automated reconnection event listener in browser environments
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    replayOfflineMutations().catch((err) => console.error("[offline-queue] auto-replay error", err));
  });
}
