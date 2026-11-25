import { workspaceKey } from "../../account/accountWorkspace";

const databaseName = "team-ai-project-documents";

export type ProjectDocument = {
  id: string;
  projectId: string;
  chatId: string | null;
  name: string;
  type: string;
  bytes: ArrayBuffer;
  enabled: boolean;
};

type StoredDocument = Omit<ProjectDocument, "enabled"> & {
  enabled?: boolean;
  disabledFor?: string[];
};

function normalizeDocument({
  enabled,
  disabledFor,
  ...document
}: StoredDocument): ProjectDocument {
  return { ...document, enabled: enabled ?? !disabledFor?.length };
}

export const projectDocumentsKey = (projectId: string) =>
  [workspaceKey("project-documents"), projectId] as const;

export function projectDocumentId(
  projectId: string,
  chatId: string | null,
  file: File,
) {
  return JSON.stringify([
    projectId,
    chatId,
    file.name,
    file.size,
    file.lastModified,
  ]);
}

export type Specification = {
  id: string;
  projectId: string;
  version: number;
  name: string;
  author: string;
  uploadedAt: string;
};

function openDatabase(name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("documents"))
        db.createObjectStore("documents", { keyPath: "id" }).createIndex(
          "project",
          "projectId",
        );
      if (!db.objectStoreNames.contains("specifications"))
        db.createObjectStore("specifications", { keyPath: "id" }).createIndex(
          "project",
          "projectId",
        );
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}
async function withDocuments<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, setResult: (result: T) => void) => void,
  name = workspaceKey(databaseName),
  signal?: AbortSignal,
  stores: string[] = ["documents"],
): Promise<T> {
  const db = await openDatabase(name);
  try {
    signal?.throwIfAborted();
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(stores, mode);
      let result: T;
      const abort = () => transaction.abort();
      signal?.addEventListener("abort", abort, { once: true });
      transaction.oncomplete = () => {
        signal?.removeEventListener("abort", abort);
        resolve(result);
      };
      transaction.onabort = () => {
        signal?.removeEventListener("abort", abort);
        reject(signal?.reason ?? transaction.error);
      };
      action(transaction.objectStore(stores[0]!), (value) => {
        result = value;
      });
    });
  } finally {
    db.close();
  }
}

export function readBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export function listProjectDocuments(projectId: string, signal?: AbortSignal) {
  return withDocuments<ProjectDocument[]>(
    "readonly",
    (store, setResult) => {
      const request = store.index("project").getAll(projectId);
      request.onsuccess = () =>
        setResult((request.result as StoredDocument[]).map(normalizeDocument));
    },
    undefined,
    signal,
  );
}

export async function storeProjectDocuments(
  projectId: string,
  chatId: string | null,
  files: readonly File[],
  signal?: AbortSignal,
) {
  if (!files.length) return;
  const name = workspaceKey(databaseName);
  const records = await Promise.all(
    files.map(async (file): Promise<ProjectDocument> => ({
      id: projectDocumentId(projectId, chatId, file),
      projectId,
      chatId,
      name: file.name,
      type: file.type,
      bytes: await readBytes(file),
      enabled: true,
    })),
  );
  await withDocuments<void>(
    "readwrite",
    (store) => {
      for (const record of records) {
        const existing = store.get(record.id);
        existing.onsuccess = () => {
          if (!existing.result) store.put(record);
        };
      }
    },
    name,
    signal,
  );
}

export function setProjectDocumentEnabled(
  id: string,
  enabled: boolean,
  signal?: AbortSignal,
) {
  return withDocuments<ProjectDocument>(
    "readwrite",
    (store, setResult) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const document = request.result as StoredDocument | undefined;
        if (!document) {
          store.transaction.abort();
          return;
        }
        const updated = { ...normalizeDocument(document), enabled };
        store.put(updated);
        setResult(updated);
      };
    },
    undefined,
    signal,
  );
}

export function listSpecifications(projectId: string, signal?: AbortSignal) {
  return withDocuments<Specification[]>(
    "readonly",
    (store, result) => {
      const request = store.index("project").getAll(projectId);
      request.onsuccess = () =>
        result(
          (request.result as Specification[]).sort(
            (a, b) => b.version - a.version,
          ),
        );
    },
    undefined,
    signal,
    ["specifications"],
  );
}

export async function saveSpecification(
  projectId: string,
  file: File,
  author: string,
  signal?: AbortSignal,
) {
  const database = workspaceKey(databaseName);
  const bytes = await readBytes(file);
  const id =
    "specification:" + crypto.getRandomValues(new Uint32Array(4)).join("-");
  return withDocuments<Specification>(
    "readwrite",
    (store, result) => {
      const versions = store.index("project").count(projectId);
      versions.onsuccess = () => {
        const metadata = {
          id,
          projectId,
          name: file.name,
          author,
          version: versions.result + 1,
          uploadedAt: new Date().toISOString(),
        };
        const document: ProjectDocument = {
          id,
          projectId,
          chatId: null,
          name: file.name,
          type: file.type,
          bytes,
          enabled: true,
        };
        store.add(metadata);
        store.transaction.objectStore("documents").add(document);
        result(metadata);
      };
    },
    database,
    signal,
    ["specifications", "documents"],
  );
}

export function readSpecificationFile(
  projectId: string,
  id: string,
  signal?: AbortSignal,
) {
  return withDocuments<File | null>(
    "readonly",
    (store, result) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const document = request.result as StoredDocument | undefined;
        result(
          document?.projectId === projectId
            ? new File([document.bytes], document.name, { type: document.type })
            : null,
        );
      };
    },
    undefined,
    signal,
  );
}
