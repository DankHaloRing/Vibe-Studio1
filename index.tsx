import React, { useState, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { get, set } from 'idb-keyval';

// --- Inlined Storage Logic ---
const STORAGE_KEY = 'vibe_studio_handle';

async function getStoredDirectory() {
  return await get(STORAGE_KEY);
}

async function saveDirectory(handle: FileSystemDirectoryHandle) {
  return await set(STORAGE_KEY, handle);
}

// --- Inlined Scanner Logic ---
async function scanSequences(dirHandle: FileSystemDirectoryHandle) {
  const library: Record<string, any> = {};
  // @ts-ignore - FileSystemDirectoryHandle.entries is async iterable
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file') {
      const match = name.match(/Seq(\d+)/i);
      if (match && match[1]) {
        const seqId = match[1];
        if (!library[seqId]) library[seqId] = { assets: {} };
        
        // Simple classification based on filename
        const lowerName = name.toLowerCase();
        if (lowerName.includes('prompt') && lowerName.endsWith('.txt')) {
          library[seqId].assets.prompt = handle;
        } else if (lowerName.endsWith('.txt')) {
          library[seqId].assets.script = handle;
        }
      }
    }
  }
  return library;
}

export default function App() {
  // 1. APP STATE: Text fields for your Prompt and Script
  const [prompt, setPrompt] = useState('');
  const [script, setScript] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [generatedContent, setGeneratedContent] = useState('');
  
  // 2. LIBRARY STATE: Remembers your local file sequences
  const [projectLibrary, setProjectLibrary] = useState<any>({});
  const [currentFolder, setCurrentFolder] = useState<FileSystemDirectoryHandle | null>(null);

  // 3. AUTO-RECOVERY: Automatically reconnects to your folder on startup
  useEffect(() => {
    const init = async () => {
      const handle = await getStoredDirectory();
      if (handle) {
        // Note: Browsers typically require user activation (click) to re-grant 
        // read/write access to a stored handle, so this might prompt or 
        // require a re-connect in some contexts.
        setCurrentFolder(handle);
        try {
            const library = await scanSequences(handle);
            setProjectLibrary(library);
        } catch (e) {
            console.error("Auto-scan failed (likely needs permission re-grant):", e);
        }
      }
    };
    init();
  }, []);

  // 4. DIRECTORY PICKER: Select your Vibe-Studio folder from your desktop
  const handleConnectFolder = async () => {
    try {
      // @ts-ignore
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await saveDirectory(handle);
      setCurrentFolder(handle);
      const library = await scanSequences(handle);
      setProjectLibrary(library);
    } catch (err) {
      console.error("Folder access denied", err);
    }
  };

  // 5. DRAG & DROP LOGIC: Recognizes "SeqX" in dropped files and auto-fills fields
  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length === 0) return;

    const fileName = droppedFiles[0].name;
    const KZ_match = fileName.match(/Seq(\d+)/i);
    
    // Fixed: match index is 1 for the first capturing group
    if (KZ_match && KZ_match[1]) {
      const seqId = KZ_match[1];
      const sequenceData = projectLibrary[seqId];
      
      if (sequenceData && sequenceData.assets) {
        // Auto-fill prompt if found
        if (sequenceData.assets.prompt) {
          const file = await sequenceData.assets.prompt.getFile();
          setPrompt(await file.text());
        }
        // Auto-fill script if found
        if (sequenceData.assets.script) {
          const file = await sequenceData.assets.script.getFile();
          setScript(await file.text());
        }
      }
    }
  };

  // 6. GENERATION LOGIC: Calls the modern Gemini API 
  const handleGenerate = async () => {
    if (!prompt) return;
    setIsLoading(true);
    setGeneratedContent('');
    
    // Uses process.env.API_KEY as required by guidelines
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          systemInstruction: "You are a creative assistant. Any generated images, videos, or visual descriptions must strictly retain an anime style handrawn aesthetic.",
        },
      });
      setGeneratedContent(response.text || '');
    } catch (err) {
      console.error("Generation failed", err);
      setGeneratedContent('Error generating content. Please check console.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div 
      className="min-h-screen p-8 font-sans text-slate-200 selection:bg-purple-500 selection:text-white"
      onDragOver={(e) => e.preventDefault()} 
      onDrop={handleFileDrop}
    >
      <header className="flex justify-between items-center mb-10 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 tracking-tight">
            Vibe Studio <span className="text-sm font-mono text-slate-500 ml-2 tracking-normal">v1.0</span>
          </h1>
          <p className="text-slate-400 mt-1 text-sm tracking-wide">Sequence-Aware Production Hub</p>
        </div>
        <button 
          onClick={handleConnectFolder}
          className={`px-6 py-3 rounded-xl transition-all font-medium border ${currentFolder ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20' : 'bg-white/5 border-white/10 hover:bg-white/10 text-white'}`}
        >
          {currentFolder ? (
            <span className="flex items-center"><i className="fas fa-folder-open mr-2"></i> {currentFolder.name}</span>
          ) : (
            <span className="flex items-center"><i className="fas fa-link mr-2"></i> Connect Project Folder</span>
          )}
        </button>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-7xl mx-auto">
        <section className="glass-panel p-1 rounded-2xl flex flex-col h-[500px]">
            <div className="bg-black/20 p-4 rounded-t-xl border-b border-white/5 flex justify-between items-center">
                <h2 className="text-sm font-bold text-orange-400 uppercase tracking-wider"><i className="fas fa-lightbulb mr-2"></i> Prompt Library</h2>
                <span className="text-xs text-slate-500">Drop 'Seq' file to autofill</span>
            </div>
            <textarea 
                value={prompt} 
                onChange={(e) => setPrompt(e.target.value)}
                className="flex-1 w-full bg-transparent p-6 resize-none focus:outline-none text-slate-300 placeholder-slate-600 font-mono text-sm"
                placeholder="// Drag a file like 'Seq01_View.jpg' here to load the associated prompt..."
            />
        </section>

        <section className="glass-panel p-1 rounded-2xl flex flex-col h-[500px]">
            <div className="bg-black/20 p-4 rounded-t-xl border-b border-white/5 flex justify-between items-center">
                <h2 className="text-sm font-bold text-green-400 uppercase tracking-wider"><i className="fas fa-scroll mr-2"></i> Sequence Script</h2>
                <span className="text-xs text-slate-500">Linked .txt asset</span>
            </div>
            <textarea 
                value={script} 
                onChange={(e) => setScript(e.target.value)}
                className="flex-1 w-full bg-transparent p-6 resize-none focus:outline-none text-slate-300 placeholder-slate-600 font-mono text-sm"
                placeholder="// Script content will appear here..."
            />
        </section>

        {/* Action Bar */}
        <div className="lg:col-span-2 flex flex-col items-center mt-4 space-y-8">
          <button 
            onClick={handleGenerate}
            disabled={isLoading}
            className={`
                group relative px-12 py-4 rounded-full text-xl font-bold transition-all transform hover:scale-105 active:scale-95 shadow-2xl
                ${isLoading ? 'bg-slate-700 text-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-orange-600 to-pink-600 text-white hover:shadow-orange-900/50'}
            `}
          >
            {isLoading ? (
                 <span className="flex items-center"><i className="fas fa-circle-notch fa-spin mr-3"></i> Generating...</span>
            ) : (
                 <span className="flex items-center"><i className="fas fa-wand-magic-sparkles mr-3"></i> Generate Sequence</span>
            )}
            {!isLoading && <div className="absolute inset-0 rounded-full bg-white/20 blur-lg opacity-0 group-hover:opacity-50 transition-opacity"></div>}
          </button>
          
          {generatedContent && (
             <div className="w-full glass-panel rounded-2xl p-8 animate-fade-in-up">
                <h3 className="text-sm font-bold text-purple-400 mb-4 uppercase tracking-wider">Output</h3>
                <div className="prose prose-invert max-w-none">
                    <p className="whitespace-pre-wrap leading-relaxed text-slate-300">{generatedContent}</p>
                </div>
             </div>
          )}
        </div>
      </main>

      <footer className="mt-20 text-center text-xs text-slate-600 font-mono uppercase tracking-widest">
        {Object.keys(projectLibrary).length > 0 
            ? <span className="text-emerald-500">{Object.keys(projectLibrary).length} Sequences Active</span> 
            : <span>No Directory Linked</span>
        }
      </footer>
    </div>
  );
}