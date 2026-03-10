import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, 
  Send, 
  Copy, 
  Check, 
  Image as ImageIcon, 
  Clapperboard, 
  Loader2,
  ChevronRight,
  RefreshCw,
  Upload,
  X,
  Palette,
  User,
  Sun,
  Moon,
  Key,
  Download,
  Play
} from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { generateScriptAndShots, generateImage, ScriptLine, GenerationOptions } from './services/gemini';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ShotWithImage {
  idea: string;
  prompt: string;
  imageUrl: string | null;
  isLoading: boolean;
}

interface ScriptLineWithImages extends ScriptLine {
  shotsWithImages: ShotWithImage[];
}

interface HistoryItem {
  id: string;
  timestamp: number;
  input: string;
  styles: string[];
  orientation: "16:9" | "9:16" | "1:1";
  scriptLines: ScriptLineWithImages[];
  characterRef: string | null;
  styleRef: string | null;
}

const STYLES = [
  "Hyperrealistic Cinematic",
  "Minimalist & Clean",
  "Motion Graphics (2D/3D)",
  "2D Illustration",
  "3D Render (Unreal Engine 5)",
  "Cinematic Anime",
  "Cyberpunk Neon",
  "Vintage Film (Kodak 35mm)",
  "Dark Fantasy",
  "Abstract & Surreal"
];

const ORIENTATIONS = [
  { label: "Landscape", value: "16:9" as const },
  { label: "Portrait", value: "9:16" as const },
  { label: "Square", value: "1:1" as const }
];

const resizeImage = (base64Str: string, maxWidth = 512, maxHeight = 512): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = (e) => reject(e);
  });
};

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 text-center">
          <div className="max-w-md p-8 rounded-2xl bg-red-500/10 border border-red-500/20">
            <h2 className="text-2xl font-display mb-4">Something went wrong</h2>
            <p className="text-sm opacity-60 mb-6">The application encountered an unexpected error. Please try refreshing the page.</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-3 rounded-full bg-red-500 text-white font-medium hover:bg-red-600 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [input, setInput] = useState('');
  const [selectedStyles, setSelectedStyles] = useState<string[]>([STYLES[0]]);
  const [selectedOrientation, setSelectedOrientation] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [characterRef, setCharacterRef] = useState<string | null>(null);
  const [styleRef, setStyleRef] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [scriptLines, setScriptLines] = useState<ScriptLineWithImages[]>([]);
  const [copied, setCopied] = useState(false);
  const [ideasCopied, setIdeasCopied] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generateProgress, setGenerateProgress] = useState({ current: 0, total: 0 });
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('whisk_history');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Failed to load history", e);
      return [];
    }
  });

  const toggleStyle = (style: string) => {
    setSelectedStyles(prev => {
      if (prev.includes(style)) {
        if (prev.length === 1) return prev; // Keep at least one
        return prev.filter(s => s !== style);
      }
      return [...prev, style];
    });
  };
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('whisk_theme');
    return (saved as 'light' | 'dark') || 'light';
  });
  
  const resultsRef = useRef<HTMLDivElement>(null);

  const characterInputRef = useRef<HTMLInputElement>(null);
  const styleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saveHistory = (data: HistoryItem[]) => {
      try {
        localStorage.setItem('whisk_history', JSON.stringify(data));
      } catch (e) {
        if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
          console.warn('LocalStorage quota exceeded, pruning history...');
          if (data.length > 1) {
            // Prune the history state itself to stay in sync with what we can store
            // We remove the oldest item (last in the array)
            const pruned = data.slice(0, -1);
            setHistory(pruned);
          } else if (data.length === 1) {
            // If even one item is too big, try to clear its images to save space
            const item = data[0];
            const clearedItem = { 
              ...item, 
              characterRef: null, 
              styleRef: null,
              scriptLines: item.scriptLines.map(line => ({
                ...line,
                shotsWithImages: line.shotsWithImages.map(shot => ({ ...shot, imageUrl: null }))
              }))
            };
            setHistory([clearedItem]);
          }
        } else {
          console.error('Failed to save history', e);
        }
      }
    };
    saveHistory(history);
  }, [history]);

  useEffect(() => {
    localStorage.setItem('whisk_theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'character' | 'style') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result as string;
      try {
        const resized = await resizeImage(base64);
        if (type === 'character') setCharacterRef(resized);
        else setStyleRef(resized);
      } catch (err) {
        console.error("Failed to resize image", err);
        // Fallback to original if resize fails, but it might be large
        if (type === 'character') setCharacterRef(base64);
        else setStyleRef(base64);
      }
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const checkApiKey = async () => {
      try {
        const aistudio = (window as any).aistudio;
        if (aistudio && typeof aistudio.hasSelectedApiKey === 'function') {
          const hasKey = await aistudio.hasSelectedApiKey();
          setHasApiKey(!!hasKey);
        }
      } catch (e) {
        console.error("Failed to check API key", e);
      }
    };
    checkApiKey();
  }, []);

  const handleOpenKeySelection = async () => {
    try {
      const aistudio = (window as any).aistudio;
      if (aistudio && typeof aistudio.openSelectKey === 'function') {
        await aistudio.openSelectKey();
        setHasApiKey(true);
        setError(null);
      } else {
        setError("API key selection is not available in this environment.");
      }
    } catch (e) {
      console.error("Failed to open key selection", e);
      setError("Failed to open API key selection dialog.");
    }
  };

  const handleGenerate = async () => {
    if (!input.trim()) return;
    
    setIsGenerating(true);
    setScriptLines([]);
    setError(null);
    
    const options: GenerationOptions = {
      styles: selectedStyles,
      orientation: selectedOrientation,
      characterRef: characterRef || undefined,
      styleRef: styleRef || undefined
    };

    try {
      const result = await generateScriptAndShots(input, options);
      const initialLines: ScriptLineWithImages[] = result.map(line => ({
        ...line,
        shotsWithImages: line.shots.map(shot => ({
          idea: shot.idea,
          prompt: shot.prompt,
          imageUrl: null,
          isLoading: false
        }))
      }));
      
      setScriptLines(initialLines);
      
      // Save to history
      const newItem: HistoryItem = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        input,
        styles: selectedStyles,
        orientation: selectedOrientation,
        scriptLines: initialLines,
        characterRef,
        styleRef
      };
      setHistory(prev => [newItem, ...prev].slice(0, 10)); // Keep last 10 to save space
      
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);

    } catch (err: any) {
      console.error("Generation failed", err);
      const errorMessage = err?.message || String(err);
      if (errorMessage.includes("429") || errorMessage.includes("RESOURCE_EXHAUSTED")) {
        setError("API quota exceeded. Please select a paid API key to continue.");
      } else if (errorMessage.includes("Requested entity was not found")) {
        setError("API key configuration error. Please re-select your API key.");
        await handleOpenKeySelection();
      } else {
        setError("Generation failed. Please try again.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const loadFromHistory = (item: HistoryItem) => {
    setInput(item.input);
    // Handle legacy single style history items
    const historyStyles = (item as any).style ? [(item as any).style] : (item as any).styles || [STYLES[0]];
    setSelectedStyles(historyStyles);
    setSelectedOrientation(item.orientation);
    setScriptLines(item.scriptLines);
    setCharacterRef(item.characterRef);
    setStyleRef(item.styleRef);
    setIsHistoryOpen(false);
    
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const deleteFromHistory = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const generateShotImage = async (lineIndex: number, shotIndex: number) => {
    const line = scriptLines[lineIndex];
    const shot = line.shotsWithImages[shotIndex];
    
    if (shot.isLoading) return;

    const newLines = [...scriptLines];
    newLines[lineIndex].shotsWithImages[shotIndex].isLoading = true;
    setScriptLines(newLines);

    const options: GenerationOptions = {
      styles: selectedStyles,
      orientation: selectedOrientation,
      characterRef: characterRef || undefined,
      styleRef: styleRef || undefined
    };

    try {
      const imageUrl = await generateImage(shot.prompt, options);
      const updatedLines = [...scriptLines];
      updatedLines[lineIndex].shotsWithImages[shotIndex].imageUrl = imageUrl;
      updatedLines[lineIndex].shotsWithImages[shotIndex].isLoading = false;
      setScriptLines(updatedLines);
    } catch (err: any) {
      console.error("Image generation failed", err);
      const errorMessage = err?.message || String(err);
      if (errorMessage.includes("429") || errorMessage.includes("RESOURCE_EXHAUSTED")) {
        setError("API quota exceeded. Please select a paid API key.");
      }
      const updatedLines = [...scriptLines];
      updatedLines[lineIndex].shotsWithImages[shotIndex].isLoading = false;
      setScriptLines(updatedLines);
    }
  };

  const [narrationCopied, setNarrationCopied] = useState(false);

  const copyToClipboard = async (text: string, successCallback?: () => void) => {
    try {
      await navigator.clipboard.writeText(text);
      if (successCallback) successCallback();
    } catch (err) {
      console.error("Failed to copy to clipboard", err);
      setError("Failed to copy to clipboard. Please ensure the site has permission.");
    }
  };

  const copyAllPrompts = async () => {
    const allPrompts = scriptLines
      .flatMap(line => line.shotsWithImages.map(s => s.prompt))
      .join('\n\n');
    
    await copyToClipboard(allPrompts, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const copyAllIdeas = async () => {
    const allIdeas = scriptLines
      .flatMap(line => line.shotsWithImages.map(s => s.idea))
      .join('\n\n');
    
    await copyToClipboard(allIdeas, () => {
      setIdeasCopied(true);
      setTimeout(() => setIdeasCopied(false), 2000);
    });
  };

  const generateAllImages = async () => {
    if (isGeneratingAll) return;
    
    try {
      const totalShots = scriptLines.reduce((acc, line) => acc + line.shotsWithImages.length, 0);
      setGenerateProgress({ current: 0, total: totalShots });
      setIsGeneratingAll(true);

      let currentCount = 0;
      for (let i = 0; i < scriptLines.length; i++) {
        for (let j = 0; j < scriptLines[i].shotsWithImages.length; j++) {
          if (!scriptLines[i].shotsWithImages[j].imageUrl) {
            await generateShotImage(i, j);
          }
          currentCount++;
          setGenerateProgress({ current: currentCount, total: totalShots });
        }
      }
    } catch (err) {
      console.error("Generate all failed", err);
      setError("An error occurred while generating images. Some shots may be missing.");
    } finally {
      setIsGeneratingAll(false);
    }
  };

  const downloadAllImages = async () => {
    try {
      const zip = new JSZip();
      const folder = zip.folder("storyboard_images");
      
      let hasImages = false;
      scriptLines.forEach((line, lineIdx) => {
        line.shotsWithImages.forEach((shot, shotIdx) => {
          if (shot.imageUrl) {
            hasImages = true;
            const base64Data = shot.imageUrl.split(',')[1];
            folder?.file(`line_${lineIdx + 1}_shot_${shotIdx + 1}.png`, base64Data, { base64: true });
          }
        });
      });

      if (!hasImages) {
        setError("No images generated yet to download.");
        return;
      }

      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, "storyboard_images.zip");
    } catch (err) {
      console.error("Failed to download images", err);
      setError("Failed to create zip file for download.");
    }
  };

  const copyNarration = async () => {
    const narration = scriptLines.map(line => line.text).join('\n\n');
    await copyToClipboard(narration, () => {
      setNarrationCopied(true);
      setTimeout(() => setNarrationCopied(false), 2000);
    });
  };

  return (
    <div className="min-h-screen pb-20 flex">
      {/* Main Content */}
      <div className="flex-1">
        {/* Header with History Toggle */}
        <header className="px-6 pt-20 pb-12 max-w-7xl mx-auto flex justify-between items-start">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-4"
          >
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest opacity-50">
              <Clapperboard size={14} />
              <span>Cinematic AI Workflow</span>
            </div>
            <h1 className="text-5xl sm:text-7xl md:text-8xl font-display font-medium tracking-tight leading-[0.9]">
              Whisk <br />
              <span className="italic opacity-40">Shot Generator</span>
            </h1>
            <p className="max-w-xl text-base md:text-lg opacity-70 mt-4">
              Transform topics or scripts into cinematic shot lists. Generate high-fidelity prompts for Google Whisk AI and preview them instantly.
            </p>
          </motion.div>
          
          <div className="flex gap-2">
            <button 
              onClick={handleOpenKeySelection}
              className={cn(
                "p-4 rounded-full bg-[var(--panel)] border shadow-lg hover:bg-[var(--bg)] transition-all group",
                hasApiKey ? "border-[var(--border)]" : "border-amber-500/50 text-amber-500"
              )}
              title="API Key Settings"
            >
              <Key size={20} />
            </button>
            <button 
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="p-4 rounded-full bg-[var(--panel)] border border-[var(--border)] shadow-lg hover:bg-[var(--bg)] transition-all group"
              title={theme === 'light' ? "Switch to Dark Mode" : "Switch to Light Mode"}
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <button 
              onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              className="p-4 rounded-full bg-[var(--panel)] border border-[var(--border)] shadow-lg hover:bg-[var(--bg)] transition-all group"
              title="Project History"
            >
              <RefreshCw size={20} className={cn("transition-transform duration-500", isHistoryOpen && "rotate-180")} />
            </button>
          </div>
        </header>

      {/* Input & Options Section */}
      <section className="px-4 sm:px-6 max-w-7xl mx-auto mb-20">
        <div className="glass-panel p-5 sm:p-8 shadow-2xl shadow-black/5">
          <div className="flex flex-col gap-8 md:gap-10">
            {/* Main Input */}
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-mono uppercase tracking-widest opacity-50">Input Script or Topic</label>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Enter a topic (e.g., 'A lonely robot' !6 minutes long!) or paste your script here..."
                className="w-full h-32 sm:h-40 bg-transparent border-b border-[var(--border)] focus:border-[var(--fg)] outline-none transition-colors resize-none text-lg sm:text-xl font-display placeholder:opacity-20"
              />
              {error && (
                <div className="mt-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-mono flex items-center justify-between">
                  <span>{error}</span>
                  {error.includes("quota") && (
                    <button 
                      onClick={handleOpenKeySelection}
                      className="px-3 py-1 rounded-full bg-red-500 text-white text-[10px] hover:bg-red-600 transition-colors"
                    >
                      Select Key
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-10">
              {/* Style & Orientation */}
              <div className="flex flex-col gap-8">
                {/* Style Selection */}
                <div className="flex flex-col gap-4">
                  <label className="text-[11px] font-mono uppercase tracking-widest opacity-50 flex items-center gap-2">
                    <Palette size={12} />
                    Visual Style
                  </label>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {STYLES.map(style => (
                      <button
                        key={style}
                        onClick={() => toggleStyle(style)}
                        className={cn(
                          "px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-[10px] sm:text-xs font-medium transition-all border",
                          selectedStyles.includes(style) 
                            ? "bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]" 
                            : "bg-transparent text-[var(--fg)]/60 border-[var(--border)] hover:border-[var(--fg)]/30"
                        )}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Orientation Selection */}
                <div className="flex flex-col gap-4">
                  <label className="text-[11px] font-mono uppercase tracking-widest opacity-50 flex items-center gap-2">
                    <Clapperboard size={12} />
                    Orientation
                  </label>
                  <div className="flex gap-2">
                    {ORIENTATIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setSelectedOrientation(opt.value)}
                        className={cn(
                          "flex-1 px-4 py-3 rounded-xl text-xs font-medium transition-all border flex flex-col items-center gap-2",
                          selectedOrientation === opt.value 
                            ? "bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]" 
                            : "bg-transparent text-[var(--fg)]/60 border-[var(--border)] hover:border-[var(--fg)]/30"
                        )}
                      >
                        <div className={cn(
                          "border-2 border-current rounded-sm",
                          opt.value === "16:9" ? "w-6 h-4" : opt.value === "9:16" ? "w-4 h-6" : "w-5 h-5"
                        )} />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Reference Uploads */}
              <div className="flex flex-col gap-4">
                <label className="text-[11px] font-mono uppercase tracking-widest opacity-50 flex items-center gap-2">
                  <Upload size={12} />
                  Reference Images (Optional)
                </label>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  {/* Character Ref */}
                  <div className="relative group">
                    <input 
                      type="file" 
                      ref={characterInputRef} 
                      onChange={(e) => handleFileUpload(e, 'character')} 
                      className="hidden" 
                      accept="image/*"
                    />
                    <div 
                      onClick={() => characterInputRef.current?.click()}
                      className={cn(
                        "aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-all overflow-hidden",
                        characterRef ? "border-solid border-[var(--fg)]" : "border-[var(--border)] hover:border-[var(--fg)]/30"
                      )}
                    >
                      {characterRef ? (
                        <>
                          <img src={characterRef} className="w-full h-full object-cover" />
                          <button 
                            onClick={(e) => { e.stopPropagation(); setCharacterRef(null); }}
                            className="absolute top-2 right-2 p-1 bg-white/80 rounded-full shadow-sm"
                          >
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <>
                          <User size={20} className="opacity-20" />
                          <span className="text-[9px] sm:text-[10px] font-mono uppercase opacity-40">Character</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Style Ref */}
                  <div className="relative group">
                    <input 
                      type="file" 
                      ref={styleInputRef} 
                      onChange={(e) => handleFileUpload(e, 'style')} 
                      className="hidden" 
                      accept="image/*"
                    />
                    <div 
                      onClick={() => styleInputRef.current?.click()}
                      className={cn(
                        "aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-all overflow-hidden",
                        styleRef ? "border-solid border-[var(--fg)]" : "border-[var(--border)] hover:border-[var(--fg)]/30"
                      )}
                    >
                      {styleRef ? (
                        <>
                          <img src={styleRef} className="w-full h-full object-cover" />
                          <button 
                            onClick={(e) => { e.stopPropagation(); setStyleRef(null); }}
                            className="absolute top-2 right-2 p-1 bg-white/80 rounded-full shadow-sm"
                          >
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <>
                          <Palette size={20} className="opacity-20" />
                          <span className="text-[9px] sm:text-[10px] font-mono uppercase opacity-40">Style</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-6 border-t border-[var(--border)]">
              <div className="flex items-center gap-4 text-[10px] sm:text-xs font-mono opacity-40">
                <span>{input.length} characters</span>
                <span>•</span>
                <span>{selectedStyles.join(' + ')}</span>
                <span>•</span>
                <span>{selectedOrientation}</span>
              </div>
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !input.trim()}
                className={cn(
                  "w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] font-medium transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:hover:scale-100",
                  isGenerating && "cursor-wait"
                )}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    <span>Analyzing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    <span>Generate shot ideas and prompts</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Results Section */}
      <div ref={resultsRef}>
        <AnimatePresence>
          {scriptLines.length > 0 && (
            <motion.section
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="px-4 sm:px-6 max-w-7xl mx-auto"
            >
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 mb-12">
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-mono uppercase tracking-widest opacity-50">Production Output</span>
                  <h2 className="text-3xl sm:text-4xl font-display italic">Storyboard & Prompts</h2>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                  <button
                    onClick={generateAllImages}
                    disabled={isGeneratingAll}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-full border border-[var(--border)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] transition-all group disabled:opacity-50"
                  >
                    {isGeneratingAll ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-sm font-medium">{generateProgress.current}/{generateProgress.total}</span>
                      </>
                    ) : (
                      <>
                        <Play size={16} className="group-hover:scale-110 transition-transform" />
                        <span className="text-sm font-medium">Generate All</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={downloadAllImages}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-full border border-[var(--border)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] transition-all group"
                  >
                    <Download size={16} className="group-hover:scale-110 transition-transform" />
                    <span className="text-sm font-medium">Download All</span>
                  </button>
                  <button
                    onClick={copyNarration}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-full border border-[var(--border)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] transition-all group"
                  >
                    {narrationCopied ? <Check size={16} /> : <Send size={16} className="group-hover:scale-110 transition-transform" />}
                    <span className="text-sm font-medium">Copy Narration</span>
                  </button>
                  <button
                    onClick={copyAllIdeas}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-full border border-[var(--border)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] transition-all group"
                  >
                    {ideasCopied ? <Check size={16} /> : <Sparkles size={16} className="group-hover:scale-110 transition-transform" />}
                    <span className="text-sm font-medium">Copy All Ideas</span>
                  </button>
                  <button
                    onClick={copyAllPrompts}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-full border border-[var(--border)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] transition-all group"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} className="group-hover:scale-110 transition-transform" />}
                    <span className="text-sm font-medium">Copy All Prompts</span>
                  </button>
                </div>
              </div>

              <div className="space-y-16 sm:space-y-24">
                {scriptLines.map((line, lineIdx) => (
                  <motion.div 
                    key={lineIdx}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12"
                  >
                    {/* Script Line */}
                    <div className="lg:col-span-4 flex flex-col gap-4">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl sm:text-4xl font-display font-bold opacity-10">{(lineIdx + 1).toString().padStart(2, '0')}</span>
                        <div className="h-[1px] flex-1 bg-[var(--border)]" />
                      </div>
                      <div className="flex flex-col gap-4">
                        <p className="text-xl sm:text-2xl font-display leading-relaxed">
                          {line.text}
                        </p>
                        {line.directorNote && (
                          <div className="p-4 rounded-xl bg-[var(--accent)]/5 border border-[var(--accent)]/10">
                            <div className="flex items-center gap-2 mb-2 text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                              <Clapperboard size={12} />
                              <span>Director's Vision</span>
                            </div>
                            <p className="text-xs opacity-60 leading-relaxed italic">
                              {line.directorNote}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Shots */}
                    <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                      {line.shotsWithImages.map((shot, shotIdx) => (
                        <div key={shotIdx} className="flex flex-col gap-4 group">
                          <div className={cn(
                            "relative bg-[var(--fg)]/5 rounded-xl overflow-hidden border border-[var(--border)]",
                            selectedOrientation === "16:9" ? "aspect-video" : selectedOrientation === "9:16" ? "aspect-[9/16]" : "aspect-square"
                          )}>
                            {shot.imageUrl ? (
                              <img 
                                src={shot.imageUrl} 
                                alt={shot.prompt}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-4 sm:p-6 text-center">
                                {shot.isLoading ? (
                                  <Loader2 className="animate-spin opacity-20" size={32} />
                                ) : (
                                  <>
                                    <ImageIcon className="opacity-10" size={32} />
                                    <button 
                                      onClick={() => generateShotImage(lineIdx, shotIdx)}
                                      className="text-[10px] font-mono uppercase tracking-widest opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 rounded-full"
                                    >
                                      Generate Preview
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          
                          <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] font-bold">Scene Idea {shotIdx + 1}</span>
                                <button 
                                  onClick={() => copyToClipboard(shot.idea)}
                                  className="opacity-40 sm:opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Copy Idea"
                                >
                                  <Copy size={12} className="hover:opacity-100" />
                                </button>
                              </div>
                              <p className="text-xs sm:text-sm font-medium leading-relaxed italic opacity-90">
                                {shot.idea}
                              </p>
                            </div>

                            <div className="flex flex-col gap-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-mono uppercase tracking-widest opacity-40">Prompt</span>
                                <button 
                                  onClick={() => copyToClipboard(shot.prompt)}
                                  className="opacity-40 sm:opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Copy Prompt"
                                >
                                  <Copy size={12} className="hover:opacity-100" />
                                </button>
                              </div>
                              <p className="text-[10px] sm:text-xs opacity-60 leading-relaxed font-mono break-words">
                                {shot.prompt}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>

        {/* Footer */}
        <footer className="mt-40 px-6 py-12 border-t border-[var(--border)] max-w-7xl mx-auto flex justify-between items-center text-[10px] font-mono uppercase tracking-[0.2em] opacity-30">
          <span>Whisk Shot Generator v1.0</span>
          <span>Powered by Gemini 3.1 Pro & 2.5 Flash</span>
        </footer>
      </div>

      {/* History Sidebar */}
      <AnimatePresence>
        {isHistoryOpen && (
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 20 }}
            className="fixed top-0 right-0 w-80 h-full bg-[var(--panel)] backdrop-blur-xl border-l border-[var(--border)] z-50 shadow-2xl flex flex-col"
          >
            <div className="p-6 border-b border-[var(--border)] flex justify-between items-center">
              <div className="flex flex-col">
                <h3 className="text-sm font-mono uppercase tracking-widest font-bold">Project History</h3>
                <span className="text-[9px] opacity-40 font-mono">Max 10 items</span>
              </div>
              <div className="flex items-center gap-2">
                {history.length > 0 && (
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => {
                        const btn = document.getElementById('clear-history-btn');
                        if (btn?.getAttribute('data-confirm') === 'true') {
                          setHistory([]);
                          btn.setAttribute('data-confirm', 'false');
                          btn.classList.remove('text-red-600', 'bg-red-500/20');
                        } else {
                          btn?.setAttribute('data-confirm', 'true');
                          btn?.classList.add('text-red-600', 'bg-red-500/20');
                          setTimeout(() => {
                            btn?.setAttribute('data-confirm', 'false');
                            btn?.classList.remove('text-red-600', 'bg-red-500/20');
                          }, 3000);
                        }
                      }}
                      id="clear-history-btn"
                      data-confirm="false"
                      className="p-2 text-red-500 hover:bg-red-500/10 rounded-full transition-all flex items-center gap-1"
                      title="Clear All History"
                    >
                      <RefreshCw size={16} />
                    </button>
                  </div>
                )}
                <button onClick={() => setIsHistoryOpen(false)} className="opacity-50 hover:opacity-100">
                  <X size={20} />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {history.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-20 text-center p-8">
                  <Clapperboard size={48} className="mb-4" />
                  <p className="text-xs font-mono uppercase">No projects yet</p>
                </div>
              ) : (
                history.map((item) => (
                  <div 
                    key={item.id}
                    onClick={() => loadFromHistory(item)}
                    className="group relative p-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--fg)]/20 cursor-pointer transition-all shadow-sm hover:shadow-md"
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between items-start">
                        <span className="text-[10px] font-mono opacity-40">
                          {new Date(item.timestamp).toLocaleDateString()}
                        </span>
                        <button 
                          onClick={(e) => deleteFromHistory(e, item.id)}
                          className="opacity-0 group-hover:opacity-40 hover:opacity-100 transition-opacity"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <p className="text-sm font-display font-medium line-clamp-2 leading-tight">
                        {item.input}
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        <span className="text-[9px] font-mono uppercase bg-[var(--fg)]/5 px-2 py-0.5 rounded">
                          {item.styles?.[0]?.split(' ')[0] || "Style"}
                          {item.styles?.length > 1 && ` +${item.styles.length - 1}`}
                        </span>
                        <span className="text-[9px] font-mono uppercase bg-[var(--fg)]/5 px-2 py-0.5 rounded">
                          {item.orientation}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
