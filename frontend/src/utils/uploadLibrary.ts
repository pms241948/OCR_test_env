import type { UploadedDocument } from "./types";

const DATABASE_NAME = "ocr-compare-upload-library";
const DATABASE_VERSION = 1;
const DOCUMENT_STORE = "documents";
const SETTINGS_STORE = "settings";
const ACTIVE_DOCUMENT_ID_KEY = "activeDocumentId";

export const MAX_PERSISTED_DOCUMENT_COUNT = 8;
export const MAX_PERSISTED_DOCUMENT_TOTAL_BYTES = 200 * 1024 * 1024;
export const UPLOAD_LIBRARY_LIMIT_ERROR = "upload-library/limit-exceeded";

type PersistedUploadedDocument = UploadedDocument & {
  createdAt: string;
  lastAccessedAt: string;
};

type UploadLibrarySnapshot = {
  documents: UploadedDocument[];
  activeDocumentId: string | null;
};

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error || new Error("IndexedDB transaction aborted."));
  });
}

function sortPersistedDocumentsForDisplay(
  documents: PersistedUploadedDocument[]
): PersistedUploadedDocument[] {
  return [...documents].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

function sortPersistedDocumentsForEviction(
  documents: PersistedUploadedDocument[]
): PersistedUploadedDocument[] {
  return [...documents].sort(
    (left, right) =>
      new Date(right.lastAccessedAt).getTime() - new Date(left.lastAccessedAt).getTime()
  );
}

function toUploadedDocument(document: PersistedUploadedDocument): UploadedDocument {
  return {
    id: document.id,
    file: document.file,
    meta: document.meta,
  };
}

function openUploadLibraryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
        database.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB."));
  });
}

async function readSnapshotFromDatabase(database: IDBDatabase): Promise<UploadLibrarySnapshot> {
  const transaction = database.transaction([DOCUMENT_STORE, SETTINGS_STORE], "readonly");
  const documentStore = transaction.objectStore(DOCUMENT_STORE);
  const settingsStore = transaction.objectStore(SETTINGS_STORE);

  const documents = sortPersistedDocumentsForDisplay(
    (await requestToPromise(documentStore.getAll())) as PersistedUploadedDocument[]
  ).map(toUploadedDocument);
  const activeDocumentId = ((await requestToPromise(
    settingsStore.get(ACTIVE_DOCUMENT_ID_KEY)
  )) as string | null | undefined) || null;

  await transactionToPromise(transaction);

  return {
    documents,
    activeDocumentId: documents.some((document) => document.id === activeDocumentId)
      ? activeDocumentId
      : documents[0]?.id || null,
  };
}

export async function loadUploadLibrary(): Promise<UploadLibrarySnapshot> {
  const database = await openUploadLibraryDatabase();

  try {
    return await readSnapshotFromDatabase(database);
  } finally {
    database.close();
  }
}

export async function saveUploadedDocumentToLibrary(
  document: UploadedDocument
): Promise<UploadLibrarySnapshot> {
  if (document.meta.fileSize > MAX_PERSISTED_DOCUMENT_TOTAL_BYTES) {
    throw new Error(UPLOAD_LIBRARY_LIMIT_ERROR);
  }

  const database = await openUploadLibraryDatabase();

  try {
    const transaction = database.transaction([DOCUMENT_STORE, SETTINGS_STORE], "readwrite");
    const documentStore = transaction.objectStore(DOCUMENT_STORE);
    const settingsStore = transaction.objectStore(SETTINGS_STORE);
    const existingRecord = (await requestToPromise(
      documentStore.get(document.id)
    )) as PersistedUploadedDocument | undefined;
    const now = new Date().toISOString();

    documentStore.put({
      ...document,
      createdAt: existingRecord?.createdAt || now,
      lastAccessedAt: now,
    } satisfies PersistedUploadedDocument);
    settingsStore.put(document.id, ACTIVE_DOCUMENT_ID_KEY);

    const allRecords = sortPersistedDocumentsForDisplay(
      (await requestToPromise(documentStore.getAll())) as PersistedUploadedDocument[]
    );
    const removableRecords = [...sortPersistedDocumentsForEviction(allRecords)].reverse();
    let remainingDocuments = [...allRecords];
    let totalBytes = remainingDocuments.reduce(
      (sum, current) => sum + (current.meta.fileSize || current.file.size || 0),
      0
    );

    while (
      remainingDocuments.length > MAX_PERSISTED_DOCUMENT_COUNT ||
      totalBytes > MAX_PERSISTED_DOCUMENT_TOTAL_BYTES
    ) {
      const nextToRemove = removableRecords.shift();
      if (!nextToRemove) {
        break;
      }

      if (nextToRemove.id === document.id && remainingDocuments.length === 1) {
        documentStore.delete(document.id);
        settingsStore.put(null, ACTIVE_DOCUMENT_ID_KEY);
        await transactionToPromise(transaction);
        throw new Error(UPLOAD_LIBRARY_LIMIT_ERROR);
      }

      documentStore.delete(nextToRemove.id);
      remainingDocuments = remainingDocuments.filter((item) => item.id !== nextToRemove.id);
      totalBytes -= nextToRemove.meta.fileSize || nextToRemove.file.size || 0;
    }

    await transactionToPromise(transaction);

    return {
      documents: remainingDocuments.map(toUploadedDocument),
      activeDocumentId: document.id,
    };
  } finally {
    database.close();
  }
}

export async function setActiveUploadLibraryDocument(documentId: string | null): Promise<void> {
  const database = await openUploadLibraryDatabase();

  try {
    const transaction = database.transaction([DOCUMENT_STORE, SETTINGS_STORE], "readwrite");
    const documentStore = transaction.objectStore(DOCUMENT_STORE);
    const settingsStore = transaction.objectStore(SETTINGS_STORE);

    if (documentId) {
      const existingRecord = (await requestToPromise(
        documentStore.get(documentId)
      )) as PersistedUploadedDocument | undefined;

      if (existingRecord) {
        documentStore.put({
          ...existingRecord,
          lastAccessedAt: new Date().toISOString(),
        } satisfies PersistedUploadedDocument);
      }
    }

    settingsStore.put(documentId, ACTIVE_DOCUMENT_ID_KEY);
    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}

export async function deleteUploadedDocumentFromLibrary(documentId: string): Promise<void> {
  const database = await openUploadLibraryDatabase();

  try {
    const transaction = database.transaction([DOCUMENT_STORE, SETTINGS_STORE], "readwrite");
    const documentStore = transaction.objectStore(DOCUMENT_STORE);
    const settingsStore = transaction.objectStore(SETTINGS_STORE);
    const activeDocumentId = ((await requestToPromise(
      settingsStore.get(ACTIVE_DOCUMENT_ID_KEY)
    )) as string | null | undefined) || null;

    documentStore.delete(documentId);

    if (activeDocumentId === documentId) {
      settingsStore.put(null, ACTIVE_DOCUMENT_ID_KEY);
    }

    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}
