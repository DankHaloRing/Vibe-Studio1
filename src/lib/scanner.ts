const SEQ_PATTERN = /Project_(.*)_Seq(\d+)_(\w+)\.(txt|png|wav|mp4)/i;

export async function scanSequences(dirHandle: FileSystemDirectoryHandle) {
  const library: any = {};

  // Walk through every file in your project folder
  for await (const entry of (dirHandle as any).values()) {
    if (entry.kind === 'file') {
      const match = entry.name.match(SEQ_PATTERN);
      if (match) {
        // Extract the project name, sequence number, and file type (e.g. Script)
        const [_, projectName, seqId, type] = match;
        
        if (!library[seqId]) {
          library[seqId] = { id: seqId, projectName, assets: {} };
        }
        
        // Save the file reference into our library list
        library[seqId].assets[type.toLowerCase()] = entry;
      }
    }
  }
  return library;
}