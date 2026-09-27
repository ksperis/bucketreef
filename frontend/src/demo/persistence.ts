import { createSeed, type DemoBucket, type DemoObject, type DemoObjectVersion, type DemoState } from "./state";

import { demoDataVersion } from "../../demo-data-version.json";
const DB_NAME = "bucketreef-demo";
const STORE = "demo";
type StoredVersion = Omit<DemoObjectVersion, "body"> & { body: ArrayBuffer; bodyType: string };
type StoredObject = Omit<DemoObject, "versions"> & { versions: StoredVersion[] };
type StoredBucket = Omit<DemoBucket, "objects"> & { objects: StoredObject[] };
type StoredState = Omit<DemoState, "buckets"> & { buckets: StoredBucket[] };
type Envelope = { demoDataVersion: number; state: StoredState };
const fileBytes = new WeakMap<Blob, ArrayBuffer>();

async function encodeState(state: DemoState): Promise<StoredState> {
  // Binary buffers also work in WebKit contexts that cannot persist Blob handles.
  return { ...state, buckets: await Promise.all(state.buckets.map(async bucket => ({
    ...bucket, objects: await Promise.all(bucket.objects.map(async object => ({
      ...object, versions: await Promise.all(object.versions.map(async version => {
        const body = fileBytes.get(version.body) ?? await version.body.arrayBuffer();
        fileBytes.set(version.body, body);
        return { ...version, body, bodyType: version.body.type };
      })),
    }))),
  }))) };
}

function decodeState(state: StoredState): DemoState {
  return { ...state, buckets: state.buckets.map(bucket => ({
    ...bucket, objects: bucket.objects.map(object => ({
      ...object, versions: object.versions.map(({ body: bytes, bodyType, ...version }) => {
        const body = new Blob([bytes], { type: bodyType });
        fileBytes.set(body, bytes);
        return { ...version, body };
      }),
    })),
  })) };
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error("Demo storage transaction aborted"));
      request.onerror = () => reject(request.error ?? new Error("Demo storage request failed"));
    });
  } finally { db.close(); }
}

export async function loadState(): Promise<DemoState | null> {
  const saved = await transaction<Envelope | undefined>("readonly", store => store.get("state"));
  if (saved && saved.demoDataVersion !== demoDataVersion) return null;
  if (saved) return decodeState(saved.state);
  const state = createSeed();
  await saveState(state);
  return state;
}
export async function saveState(state: DemoState): Promise<void> {
  const encoded = await encodeState(state);
  await transaction("readwrite", store => store.put({ demoDataVersion, state: encoded } satisfies Envelope, "state"));
}
export async function resetState(): Promise<void> { await saveState(createSeed()); }
