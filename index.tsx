import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from '@google/genai';
import JSZip from 'jszip';

// --- Types ---
interface Asset {
  filename: string;
  type: 'script' | 'image' | 'video' | 'audio';
  data: string | Blob; // Base64 or Blob
  timestamp: string;
}

interface ProjectState {
  projectName: string;
  sequenceNum: number;
  contextBank: string;
  scriptContent: string;
  geminiKey: string;
  elevenKey: string;
  assets: Asset[];
  logs: string[];
}

// --- Initial State ---
const INITIAL_STATE: ProjectState = {
  projectName: "NewProject",
  sequenceNum: 1,
  contextBank: "1990s Anime Style, handrawn aesthetic, cozy atmosphere, late afternoon lighting.",
  scriptContent: "",
  geminiKey: "", // User can override
  elevenKey: "",
  assets: [],
  logs: ["System initialized."]
};

const App = () => {
  // --- State Machine ---
  const [state, setState] = useState<ProjectState>(INITIAL_STATE);
  const [activeTab, setActiveTab] = useState<'writer' | 'art' | 'motion' | 'voice'>('writer');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [dirHandle, setDirHandle] = useState<any>(null); // FileSystemDirectoryHandle
  
  // Specific Tab States
  const [sceneIdea, setSceneIdea] = useState("A character looking out a train window.");
  const [wordCount, setWordCount] = useState(150);
  const [voices, setVoices] = useState<any[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("");
  const [selectedImageForVideo, setSelectedImageForVideo] = useState<string>("");

  // --- Helpers ---
  const log = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setState(prev => ({ ...prev, logs: [`[${timestamp}] ${msg}`, ...prev.logs] }));
  };

  const dataURItoBlob = (dataURI: string) => {
    // Convert Base64 DataURI to Blob for file writing
    const byteString = atob(dataURI.split(',')[1]);
    const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], {type: mimeString});
  };

  const addToDrive = async (filename: string, type: Asset['type'], data: string | Blob) => {
    // 1. Update React State (Memory)
    setState(prev => ({
      ...prev,
      assets: [...prev.assets, { filename, type, data, timestamp: new Date().toISOString() }]
    }));
    
    // 2. Write to Local Disk if connected
    if (dirHandle) {
        try {
            const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            
            if (typeof data === 'string' && data.startsWith('data:')) {
                // Convert DataURI to Blob
                const blob = dataURItoBlob(data);
                await writable.write(blob);
            } else {
                await writable.write(data);
            }
            
            await writable.close();
            log(`Saved to disk: ${filename}`);
        } catch (e: any) {
            log(`Failed to write to disk: ${e.message}`);
        }
    } else {
        log(`Saved to Virtual Drive: ${filename}`);
    }
  };

  const connectLocalFolder = async () => {
    try {
        // @ts-ignore - File System Access API
        const handle = await window.showDirectoryPicker();
        setDirHandle(handle);
        log(`Connected to local folder: ${handle.name}`);
    } catch (e) {
        log("Folder connection cancelled.");
    }
  };

  const getGeminiClient = () => {
    // Priority: User Input -> Env Var
    const key = state.geminiKey || process.env.API_KEY;
    if (!key) {
      alert("Please provide a Gemini API Key in the settings.");
      throw new Error("No Gemini Key");
    }
    return new GoogleGenAI({ apiKey: key });
  };

  // --- Features ---

  // 1. Writer (Gemini Flash)
  const generateScript = async () => {
    setIsLoading(true);
    setLoadingMessage("Gemini is writing...");
    try {
      const ai = getGeminiClient();
      const prompt = `
        Context/Setting: ${state.contextBank}
        Task: Write a Second-Person Perspective script based on this idea: "${sceneIdea}"
        Length: Approx ${wordCount} words.
        
        CRITICAL FORMATTING FOR TTS (Text-to-Speech):
        - Write specifically for ElevenLabs interpretation.
        - Use explicit punctuation to control pacing. 
        - Use ellipses (...) for long pauses (1-2 seconds).
        - Use hyphens (-) for short, abrupt breaks.
        - Break paragraphs naturally where the speaker should take a breath.
        - Do NOT include scene descriptions like [Sound of rain] unless they are meant to be spoken.
        - Style: Calming, descriptive, sensory-focused.
      `;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });

      if (response.text) {
        // We save the script text file to drive as well
        const scriptFilename = `${state.projectName}_${String(state.sequenceNum).padStart(2, '0')}_Script.txt`;
        await addToDrive(scriptFilename, 'script', response.text);
        
        setState(prev => ({ ...prev, scriptContent: response.text || "" }));
        log("Script generated and formatted for TTS.");
      }
    } catch (e: any) {
      log(`Error generating script: ${e.message}`);
      alert(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Art Dept (Gemini Image)
  const generateArt = async () => {
    if (!state.scriptContent) {
      alert("Please generate a script first.");
      return;
    }
    setIsLoading(true);
    setLoadingMessage("Director is visualizing scene...");
    
    try {
      const ai = getGeminiClient();

      // Step 1: Director Mode (Script -> Prompt)
      const directorPrompt = `
        Read this script: "${state.scriptContent}"
        Context: ${state.contextBank}
        Task: Create 1 highly detailed visual prompt that captures the essence of this scene. 
        Output ONLY the prompt text, nothing else.
      `;
      
      const directorResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: directorPrompt,
      });
      
      const visualPrompt = directorResponse.text?.trim() + ", 1990s anime style, hand drawn aesthetic, high definition";
      log(`Visual Prompt: ${visualPrompt}`);
      setLoadingMessage("Artist is painting...");

      // Step 2: Generation
      const imageResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
            parts: [{ text: visualPrompt }]
        },
        config: {
            // responseMimeType is not supported for nano banana models
        }
      });

      // Extract image
      let foundImage = false;
      const candidates = imageResponse.candidates;
      if (candidates && candidates[0].content.parts) {
          for (const part of candidates[0].content.parts) {
              if (part.inlineData) {
                  const base64Data = part.inlineData.data;
                  const filename = `${state.projectName}_${String(state.sequenceNum).padStart(2, '0')}_Keyframe.png`;
                  await addToDrive(filename, 'image', `data:image/png;base64,${base64Data}`);
                  foundImage = true;
              }
          }
      }

      if (!foundImage) throw new Error("No image data received.");

    } catch (e: any) {
      log(`Art Dept Error: ${e.message}`);
      alert(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Motion Lab (Veo)
  const generateVideo = async () => {
    if (!selectedImageForVideo) {
      alert("Please select a Keyframe from the drive.");
      return;
    }
    setIsLoading(true);
    setLoadingMessage("Veo is rendering (this may take a minute)...");

    try {
      const ai = getGeminiClient();
      
      // Get base64 data stripped of header
      const asset = state.assets.find(a => a.filename === selectedImageForVideo);
      if (!asset) throw new Error("Asset not found");
      
      const base64Data = (asset.data as string).split(',')[1];

      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: `Cinematic movement, ${state.contextBank}`,
        image: {
            imageBytes: base64Data,
            mimeType: 'image/png'
        },
        config: {
            numberOfVideos: 1,
            aspectRatio: '16:9',
            resolution: '720p'
        }
      });

      // Polling
      while (!operation.done) {
        log(`Veo Status: ${operation.metadata?.state || 'Processing'}...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
      }

      const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!videoUri) throw new Error("No video URI returned");

      // Fetch video bytes
      const fetchUrl = `${videoUri}&key=${state.geminiKey || process.env.API_KEY}`;
      const res = await fetch(fetchUrl);
      const blob = await res.blob();
      
      const filename = `${state.projectName}_${String(state.sequenceNum).padStart(2, '0')}_Motion.mp4`;
      
      // Convert blob to base64 for storage consistency in our virtual drive logic
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
          await addToDrive(filename, 'video', reader.result as string);
          setIsLoading(false);
      };

    } catch (e: any) {
        log(`Motion Error: ${e.message}`);
        setIsLoading(false);
        alert(e.message);
    }
  };

  // 4. Voice Lab (ElevenLabs)
  const fetchVoices = async () => {
    if (!state.elevenKey) {
        alert("Enter ElevenLabs API Key in settings first.");
        return;
    }
    try {
        const res = await fetch("https://api.elevenlabs.io/v1/voices", {
            headers: { "xi-api-key": state.elevenKey }
        });
        const data = await res.json();
        setVoices(data.voices);
        log(`Fetched ${data.voices.length} voices.`);
    } catch (e) {
        log("Failed to fetch voices");
    }
  };

  const generateVoice = async () => {
    if (!state.elevenKey || !selectedVoice || !state.scriptContent) {
        alert("Missing Key, Voice Selection, or Script.");
        return;
    }
    setIsLoading(true);
    setLoadingMessage("Synthesizing Audio (v2.5 Turbo)...");

    try {
        // Using Turbo v2.5 which is very fast and high quality
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}`, {
            method: 'POST',
            headers: {
                "xi-api-key": state.elevenKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                text: state.scriptContent,
                model_id: "eleven_turbo_v2_5", 
                voice_settings: { stability: 0.5, similarity_boost: 0.75 }
            })
        });

        if (!res.ok) throw new Error(await res.text());

        const blob = await res.blob();
        const filename = `${state.projectName}_${String(state.sequenceNum).padStart(2, '0')}_VO.mp3`;

        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
            await addToDrive(filename, 'audio', reader.result as string);
            
            // Auto-increment sequence after full workflow potentially done
            setState(prev => ({ ...prev, sequenceNum: prev.sequenceNum + 1 }));
            log("Sequence complete. Incrementing index.");
            setIsLoading(false);
        };

    } catch (e: any) {
        log(`Voice Error: ${e.message}`);
        setIsLoading(false);
        alert(e.message);
    }
  };

  // --- Persistence ---
  const saveProjectState = () => {
    const dataStr = JSON.stringify(state, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.projectName}_State.json`;
    a.click();
    log("Project state saved.");
  };

  const loadProjectState = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const loadedState = JSON.parse(event.target?.result as string);
            setState(loadedState);
            log("Project state loaded.");
        } catch (err) {
            alert("Failed to parse state file.");
        }
    };
    reader.readAsText(file);
  };

  const downloadZip = async () => {
     const zip = new JSZip();
     const folder = zip.folder(state.projectName);

     // Add assets
     state.assets.forEach(asset => {
         // data is data:image/png;base64,....
         const base64Data = (asset.data as string).split(',')[1];
         folder?.file(asset.filename, base64Data, { base64: true });
     });

     // Add script logs
     folder?.file("production_log.txt", state.logs.join('\n'));

     const content = await zip.generateAsync({ type: "blob" });
     const url = URL.createObjectURL(content);
     const a = document.createElement('a');
     a.href = url;
     a.download = `${state.projectName}_Export.zip`;
     a.click();
  };

  // --- Render ---
  return (
    <div className="flex h-screen overflow-hidden font-sans text-slate-200">
      
      {/* Sidebar */}
      <div className="w-80 bg-slate-900 border-r border-slate-700 flex flex-col p-4 space-y-6 overflow-y-auto">
        <div>
          <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
            <i className="fas fa-film mr-2"></i>Vibe Studio
          </h1>
          <p className="text-xs text-slate-500 mt-1">All-In-One Production Suite</p>
        </div>

        {/* API Keys */}
        <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400 uppercase">API Configuration</label>
            <input 
                type="password" 
                placeholder="Gemini API Key (Optional if Env Set)"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:border-purple-500 outline-none"
                value={state.geminiKey}
                onChange={(e) => setState({...state, geminiKey: e.target.value})}
            />
             <input 
                type="password" 
                placeholder="ElevenLabs API Key"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:border-purple-500 outline-none"
                value={state.elevenKey}
                onChange={(e) => setState({...state, elevenKey: e.target.value})}
            />
        </div>

        {/* Project Settings */}
        <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400 uppercase">Project Settings</label>
            <input 
                type="text" 
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
                value={state.projectName}
                onChange={(e) => setState({...state, projectName: e.target.value})}
            />
             <div className="flex items-center space-x-2">
                 <span className="text-sm text-slate-400">Sequence #</span>
                 <input 
                    type="number" 
                    className="w-20 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
                    value={state.sequenceNum}
                    onChange={(e) => setState({...state, sequenceNum: parseInt(e.target.value)})}
                />
             </div>
        </div>

        {/* File System */}
        <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400 uppercase">File System</label>
            
            <button 
                onClick={connectLocalFolder}
                className={`w-full text-xs py-2 rounded font-bold border ${dirHandle ? 'bg-emerald-900 border-emerald-600 text-emerald-300' : 'bg-slate-800 border-slate-600 hover:bg-slate-700'}`}
            >
                <i className={`fas ${dirHandle ? 'fa-folder-open' : 'fa-folder'} mr-2`}></i> 
                {dirHandle ? `Connected: ${dirHandle.name}` : 'Connect Local Folder'}
            </button>
            
            <button onClick={downloadZip} className="w-full bg-purple-600 hover:bg-purple-500 text-white text-xs py-2 rounded font-bold shadow-lg shadow-purple-900/20">
                <i className="fas fa-file-archive mr-2"></i> Download Project ZIP
            </button>
        </div>

        {/* State Machine */}
        <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400 uppercase">State Machine</label>
            <div className="flex space-x-2">
                <button onClick={saveProjectState} className="flex-1 bg-slate-800 hover:bg-slate-700 text-xs py-2 rounded border border-slate-600">
                    <i className="fas fa-save mr-1"></i> Save JSON
                </button>
                <label className="flex-1 bg-slate-800 hover:bg-slate-700 text-xs py-2 rounded border border-slate-600 text-center cursor-pointer">
                    <i className="fas fa-folder-open mr-1"></i> Load JSON
                    <input type="file" className="hidden" accept=".json" onChange={loadProjectState} />
                </label>
            </div>
        </div>

        {/* Context Bank */}
        <div className="flex-1 flex flex-col min-h-0">
             <label className="text-xs font-semibold text-slate-400 uppercase mb-2">Context Bank (Story World)</label>
             <textarea 
                className="flex-1 w-full bg-slate-800 border border-slate-700 rounded p-3 text-sm resize-none focus:border-purple-500 outline-none text-slate-300"
                value={state.contextBank}
                onChange={(e) => setState({...state, contextBank: e.target.value})}
             />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col bg-slate-900 relative">
          
        {/* Loading Overlay */}
        {isLoading && (
            <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur flex flex-col items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-purple-500 mb-4"></div>
                <p className="text-purple-300 animate-pulse">{loadingMessage}</p>
            </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-slate-700 bg-slate-900/50">
            {['writer', 'art', 'motion', 'voice'].map((tab) => (
                <button
                    key={tab}
                    onClick={() => setActiveTab(tab as any)}
                    className={`px-6 py-4 text-sm font-medium transition-colors border-b-2 ${
                        activeTab === tab 
                        ? 'border-purple-500 text-purple-400 bg-slate-800/50' 
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                >
                    {tab === 'writer' && <><i className="fas fa-pen-nib mr-2"></i> The Writer</>}
                    {tab === 'art' && <><i className="fas fa-palette mr-2"></i> Art Dept</>}
                    {tab === 'motion' && <><i className="fas fa-video mr-2"></i> Motion Lab</>}
                    {tab === 'voice' && <><i className="fas fa-microphone mr-2"></i> Voice Lab</>}
                </button>
            ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8">
            
            {/* WRITER TAB */}
            {activeTab === 'writer' && (
                <div className="max-w-4xl mx-auto space-y-6">
                    <div className="glass-panel p-6 rounded-xl">
                        <h2 className="text-xl font-bold mb-4 text-purple-300">Script Generation</h2>
                        <div className="grid grid-cols-4 gap-4 mb-4">
                            <div className="col-span-3">
                                <label className="block text-xs text-slate-400 mb-1">Scene Idea</label>
                                <input 
                                    type="text" 
                                    className="w-full bg-slate-900 border border-slate-700 rounded p-2"
                                    value={sceneIdea}
                                    onChange={(e) => setSceneIdea(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Word Count: {wordCount}</label>
                                <input 
                                    type="range" 
                                    min="50" max="500" 
                                    className="w-full accent-purple-500"
                                    value={wordCount}
                                    onChange={(e) => setWordCount(parseInt(e.target.value))}
                                />
                            </div>
                        </div>
                        <button 
                            onClick={generateScript}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded shadow-lg transition-all"
                        >
                            <i className="fas fa-magic mr-2"></i> Generate Script
                        </button>
                    </div>

                    <div className="glass-panel p-6 rounded-xl h-96 flex flex-col">
                        <h3 className="text-sm font-bold text-slate-400 mb-2">Script Editor (Optimized for TTS)</h3>
                        <textarea 
                            className="flex-1 bg-slate-900 border border-slate-700 rounded p-4 font-mono text-sm leading-relaxed focus:border-purple-500 outline-none"
                            value={state.scriptContent}
                            onChange={(e) => setState({...state, scriptContent: e.target.value})}
                        />
                    </div>
                </div>
            )}

            {/* ART TAB */}
            {activeTab === 'art' && (
                <div className="max-w-6xl mx-auto">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-purple-300">Visual Development</h2>
                        <button 
                            onClick={generateArt}
                            className="bg-pink-600 hover:bg-pink-500 text-white px-6 py-2 rounded-full shadow-lg transition-all font-bold"
                        >
                            <i className="fas fa-paint-brush mr-2"></i> Analyze & Generate
                        </button>
                    </div>

                    {/* Gallery */}
                    <div className="grid grid-cols-3 gap-6">
                        {state.assets.filter(a => a.type === 'image').length === 0 && (
                            <div className="col-span-3 text-center py-20 text-slate-500 border-2 border-dashed border-slate-700 rounded-xl">
                                No images generated yet. Run the Art Dept!
                            </div>
                        )}
                        {state.assets.filter(a => a.type === 'image').map((asset, idx) => (
                            <div key={idx} className="group relative glass-panel rounded-xl overflow-hidden aspect-video">
                                <img src={asset.data as string} className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <p className="text-xs font-mono bg-black/80 p-2 rounded">{asset.filename}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* MOTION TAB */}
            {activeTab === 'motion' && (
                <div className="max-w-4xl mx-auto space-y-6">
                     <div className="glass-panel p-6 rounded-xl">
                        <h2 className="text-xl font-bold mb-4 text-purple-300">Veo Video Generation</h2>
                        
                        <div className="mb-6">
                            <label className="block text-sm text-slate-400 mb-2">Select Keyframe from Drive</label>
                            <div className="flex gap-4 overflow-x-auto pb-4">
                                {state.assets.filter(a => a.type === 'image').map((asset) => (
                                    <div 
                                        key={asset.filename}
                                        onClick={() => setSelectedImageForVideo(asset.filename)}
                                        className={`flex-shrink-0 w-40 cursor-pointer border-2 rounded-lg overflow-hidden ${selectedImageForVideo === asset.filename ? 'border-purple-500 ring-2 ring-purple-500/50' : 'border-transparent opacity-50 hover:opacity-100'}`}
                                    >
                                        <img src={asset.data as string} className="w-full h-24 object-cover" />
                                        <p className="text-[10px] p-1 truncate bg-slate-800">{asset.filename}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <button 
                            onClick={generateVideo}
                            disabled={!selectedImageForVideo}
                            className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all ${
                                selectedImageForVideo 
                                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white' 
                                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                            }`}
                        >
                            <i className="fas fa-video mr-2"></i> Action! (Generate Video)
                        </button>
                     </div>

                     <div className="space-y-4">
                        <h3 className="text-lg font-bold text-slate-400">Rushes (Generated Videos)</h3>
                        {state.assets.filter(a => a.type === 'video').map((asset, idx) => (
                             <div key={idx} className="glass-panel p-4 rounded-xl">
                                <p className="text-xs text-slate-400 mb-2">{asset.filename}</p>
                                <video controls src={asset.data as string} className="w-full rounded bg-black" />
                             </div>
                        ))}
                     </div>
                </div>
            )}

            {/* VOICE TAB */}
            {activeTab === 'voice' && (
                <div className="max-w-4xl mx-auto space-y-6">
                     <div className="glass-panel p-6 rounded-xl">
                        <div className="flex justify-between items-center mb-6">
                             <h2 className="text-xl font-bold text-purple-300">Voice Synthesis</h2>
                             <button onClick={fetchVoices} className="text-xs bg-slate-700 px-3 py-1 rounded hover:bg-slate-600">
                                 <i className="fas fa-sync mr-1"></i> Fetch Voices
                             </button>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-6 mb-6">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Select Voice</label>
                                <select 
                                    className="w-full bg-slate-900 border border-slate-700 rounded p-2"
                                    value={selectedVoice}
                                    onChange={(e) => setSelectedVoice(e.target.value)}
                                >
                                    <option value="">-- Choose a Voice --</option>
                                    {voices.map(v => (
                                        <option key={v.voice_id} value={v.voice_id}>{v.name} ({v.category})</option>
                                    ))}
                                </select>
                            </div>
                            <div className="bg-slate-800/50 p-3 rounded border border-slate-700">
                                <p className="text-xs text-slate-400 uppercase">Cost Estimate</p>
                                <p className="text-xl font-mono text-emerald-400">{state.scriptContent.length} chars</p>
                            </div>
                        </div>

                        <button 
                            onClick={generateVoice}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white w-full py-3 rounded-lg font-bold shadow-lg"
                        >
                            <i className="fas fa-microphone-lines mr-2"></i> Synthesize Audio
                        </button>
                     </div>

                     <div className="space-y-2">
                        <h3 className="text-sm font-bold text-slate-400">Audio Files</h3>
                        {state.assets.filter(a => a.type === 'audio').map((asset, idx) => (
                             <div key={idx} className="glass-panel p-3 rounded flex items-center justify-between">
                                <span className="text-sm font-mono text-purple-200">{asset.filename}</span>
                                <audio controls src={asset.data as string} className="h-8" />
                             </div>
                        ))}
                     </div>
                </div>
            )}
        </div>

        {/* Footer Log */}
        <div className="h-32 bg-slate-950 border-t border-slate-800 p-2 font-mono text-xs overflow-y-auto">
            {state.logs.map((l, i) => (
                <div key={i} className="text-slate-500 mb-1 border-b border-slate-900 pb-1">{l}</div>
            ))}
        </div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
