export type PersistentFileHandle = {
  kind: 'file'
  name: string
  getFile: () => Promise<File>
  queryPermission?: (descriptor?: { mode: 'read' }) => Promise<PermissionState>
}

export type InventorySnapshot = {
  schemaVersion: 1
  importedAt: number
  source: {
    kind: 'local-alecaframe' | 'file'
    name: string
    size: number
    lastModified: number
  }
  itemCounts: Record<string, number>
  relicCounts: Record<string, number>
  pendingRecipes?: Record<string, number>
  equipmentProgress: Record<string, number>
  masteryProgress?: Record<string, number>
}

const DB_NAME = 'relic-ledger'
const STORE_NAME = 'settings'
const HANDLE_KEY = 'inventory-file-handle'
const SNAPSHOT_KEY = 'inventory-snapshot'

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1)
  request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('Unable to open local settings.'))
})

export async function saveInventoryHandle(handle: PersistentFileHandle) {
  if (typeof indexedDB === 'undefined') return
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(handle, HANDLE_KEY)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Unable to save the imported file source.'))
  })
  database.close()
}

export async function loadInventoryHandle(): Promise<PersistentFileHandle | undefined> {
  if (typeof indexedDB === 'undefined') return undefined
  const database = await openDatabase()
  const handle = await new Promise<PersistentFileHandle | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(HANDLE_KEY)
    request.onsuccess = () => resolve(request.result as PersistentFileHandle | undefined)
    request.onerror = () => reject(request.error ?? new Error('Unable to load the saved file source.'))
  })
  database.close()
  return handle
}

export async function clearInventoryHandle() {
  if (typeof indexedDB === 'undefined') return
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(HANDLE_KEY)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Unable to clear the saved file source.'))
  })
  database.close()
}

export async function saveInventorySnapshot(snapshot: InventorySnapshot) {
  if (typeof indexedDB === 'undefined') return
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Unable to save the inventory snapshot.'))
  })
  database.close()
}

export async function loadInventorySnapshot(): Promise<InventorySnapshot | undefined> {
  if (typeof indexedDB === 'undefined') return undefined
  const database = await openDatabase()
  const snapshot = await new Promise<InventorySnapshot | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(SNAPSHOT_KEY)
    request.onsuccess = () => resolve(request.result as InventorySnapshot | undefined)
    request.onerror = () => reject(request.error ?? new Error('Unable to load the inventory snapshot.'))
  })
  database.close()
  return snapshot
}

export async function clearInventorySnapshot() {
  if (typeof indexedDB === 'undefined') return
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(SNAPSHOT_KEY)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Unable to clear the inventory snapshot.'))
  })
  database.close()
}
