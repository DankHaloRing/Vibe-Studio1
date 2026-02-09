import { get, set } from 'idb-keyval';

// This function remembers your folder even if the app crashes
export async function getStoredDirectory() {
  const handle = await get('project-root');
  if (handle) {
    // Check if we still have permission to read the folder
    const status = await handle.requestPermission({ mode: 'readwrite' });
    return status === 'granted'? handle : null;
  }
  return null;
}

export async function saveDirectory(handle: FileSystemDirectoryHandle) {
  await set('project-root', handle);
}