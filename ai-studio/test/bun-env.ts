import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

class MockIDBOpenDBRequest {
  result = {
    createObjectStore: () => ({ createIndex: () => {} }),
    transaction: () => ({ objectStore: () => ({ add: () => ({}), put: () => ({}), get: () => ({}), getAll: () => ({}), delete: () => ({}) }) })
  };
  addEventListener() {}
  removeEventListener() {}
}

globalThis.indexedDB = {
  open: () => new MockIDBOpenDBRequest()
} as any;
