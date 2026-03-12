/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  Play, 
  Pause, 
  RotateCcw, 
  ChevronRight, 
  ChevronLeft, 
  Settings2, 
  Volume2, 
  MessageSquare, 
  Sparkles,
  CheckCircle2,
  Loader2,
  Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';
import { generateShadowingScript, generateSpeech, type ShadowingScript } from './services/geminiService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Level = 'Beginner' | 'Intermediate' | 'Advanced';
type Step = 1 | 2 | 3;

export default function App() {
  const [level, setLevel] = useState<Level>('Intermediate');
  const [wordCount, setWordCount] = useState(50);
  const [topic, setTopic] = useState('');
  const [script, setScript] = useState<ShadowingScript | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isSentenceMode, setIsSentenceMode] = useState(true);
  const [selectedSentenceIndex, setSelectedSentenceIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const lastRequestIdRef = useRef<number>(0);

  // Split original text into sentences
  const sentences = script?.originalText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0) || [];

  // Cleanup Blob URLs
  useEffect(() => {
    return () => {
      if (audioUrl && audioUrl.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
      if (recordedUrl && recordedUrl.startsWith('blob:')) URL.revokeObjectURL(recordedUrl);
    };
  }, [audioUrl, recordedUrl]);

  // Update playback rate when it changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, audioUrl]);

  const handleGenerate = async () => {
    setLoading(true);
    setScript(null);
    setErrorMessage(null);
    setCurrentStep(1);
    setIsSentenceMode(true);
    setSelectedSentenceIndex(null);
    if (audioUrl && audioUrl.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
    if (recordedUrl && recordedUrl.startsWith('blob:')) URL.revokeObjectURL(recordedUrl);
    setAudioUrl(null);
    setRecordedUrl(null);
    try {
      const newScript = await generateShadowingScript(level, wordCount, topic);
      setScript(newScript);
    } catch (error) {
      console.error("Error generating script:", error);
      setErrorMessage("Failed to generate script. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePlayAudio = async (speed: 'slow' | 'natural', textOverride?: string) => {
    if (!script) return;
    
    const textToPlay = textOverride || script.originalText;
    const requestId = ++lastRequestIdRef.current;

    // If audio is already playing, stop it
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);

    setAudioLoading(true);
    setErrorMessage(null);
    try {
      const url = await generateSpeech(textToPlay, speed);
      
      // If a newer request has started, ignore this one
      if (requestId !== lastRequestIdRef.current) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        return;
      }

      // Revoke old URL if it exists
      if (audioUrl && audioUrl.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
      
      setAudioUrl(url);
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.load();
        audioRef.current.playbackRate = playbackRate;
        
        // Wrap play in a promise handler to catch common browser errors
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            // Success
            if (requestId === lastRequestIdRef.current) {
              setIsPlaying(true);
            }
          }).catch(error => {
            // AbortError is normal when we stop audio to play something else
            if (error.name === 'AbortError') return;
            
            console.error("Playback blocked or failed:", error);
            setIsPlaying(false);
            
            // If it's a permission/autoplay issue, give a helpful hint
            if (error.name === 'NotAllowedError') {
              setErrorMessage("Playback blocked. Please click the play button manually to start.");
            } else {
              setErrorMessage("Audio playback failed. Please try again.");
            }
          });
        }
      }
    } catch (error) {
      if (requestId === lastRequestIdRef.current) {
        console.error("Error generating speech:", error);
        setErrorMessage("Failed to generate audio. Please try again.");
      }
    } finally {
      if (requestId === lastRequestIdRef.current) {
        setAudioLoading(false);
      }
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Determine supported MIME type
      let mimeType = '';
      if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
        mimeType = 'audio/ogg';
      }

      const mediaRecorder = mimeType 
        ? new MediaRecorder(stream, { mimeType }) 
        : new MediaRecorder(stream);

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        const url = URL.createObjectURL(blob);
        setRecordedUrl(url);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordedUrl(null);
      setErrorMessage(null);
    } catch (error) {
      console.error("Error accessing microphone:", error);
      setErrorMessage("Could not access microphone. Please check your permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const playRecorded = () => {
    if (recordedUrl && audioRef.current) {
      const requestId = ++lastRequestIdRef.current;
      
      // Stop any current playback
      audioRef.current.pause();
      setIsPlaying(false);
      
      audioRef.current.src = recordedUrl;
      audioRef.current.load();
      audioRef.current.playbackRate = 1.0; // Recordings always 1x
      
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          if (requestId === lastRequestIdRef.current) {
            setIsPlaying(true);
          }
        }).catch(error => {
          if (error.name === 'AbortError') return;
          console.error("Recording playback failed:", error);
          setIsPlaying(false);
          setErrorMessage(error.name === 'NotAllowedError' 
            ? "Playback blocked. Please click the play button manually." 
            : "Could not play your recording. Please try again.");
        });
      }
    }
  };

  const handleSentenceClick = (idx: number) => {
    setSelectedSentenceIndex(idx);
    handlePlayAudio(currentStep === 2 ? 'slow' : 'natural', sentences[idx]);
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(console.error);
      }
      setIsPlaying(!isPlaying);
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      const handleEnded = () => setIsPlaying(false);
      audio.addEventListener('ended', handleEnded);
      return () => audio.removeEventListener('ended', handleEnded);
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-[#1A1A1A] font-sans selection:bg-emerald-100">
      <audio ref={audioRef} className="hidden" />
      
      {/* Header */}
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
              <Mic className="text-white w-5 h-5" />
            </div>
            <h1 className="font-semibold text-lg tracking-tight">ShadowEcho</h1>
          </div>
          <div className="flex items-center gap-4 text-sm font-medium text-stone-500">
            <span className="flex items-center gap-1.5">
              <Globe className="w-4 h-4" />
              EN/VN
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        {!script ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
          >
            <div className="text-center space-y-4">
              <h2 className="text-4xl font-serif italic text-stone-800">Master English Rhythm</h2>
              <p className="text-stone-500 max-w-lg mx-auto">
                Improve your pronunciation through the Shadowing Technique. 
                Choose your level and start practicing today.
              </p>
              {errorMessage && (
                <div className="bg-rose-50 text-rose-600 p-3 rounded-xl text-sm border border-rose-100 max-w-md mx-auto">
                  {errorMessage}
                </div>
              )}
            </div>

            <div className="bg-white border border-stone-200 rounded-3xl p-8 shadow-sm space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-3">
                  <label className="text-xs font-bold uppercase tracking-widest text-stone-400 flex items-center gap-2">
                    <Settings2 className="w-3 h-3" />
                    Proficiency Level
                  </label>
                  <div className="flex gap-2">
                    {(['Beginner', 'Intermediate', 'Advanced'] as Level[]).map((l) => (
                      <button
                        key={l}
                        onClick={() => setLevel(l)}
                        className={cn(
                          "flex-1 py-3 px-4 rounded-xl text-sm font-medium transition-all border",
                          level === l 
                            ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm" 
                            : "bg-stone-50 border-stone-100 text-stone-600 hover:bg-stone-100"
                        )}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-xs font-bold uppercase tracking-widest text-stone-400 flex items-center gap-2">
                    <MessageSquare className="w-3 h-3" />
                    Topic (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., Coffee, Travel, Business..."
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    className="w-full py-3 px-4 rounded-xl bg-stone-50 border border-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-widest text-stone-400 flex items-center gap-2">
                    <RotateCcw className="w-3 h-3" />
                    Script Length (Words)
                  </label>
                  <span className="text-sm font-bold text-emerald-600">{wordCount} words</span>
                </div>
                <div className="flex gap-2">
                  {[30, 50, 80, 100, 150].map((count) => (
                    <button
                      key={count}
                      onClick={() => setWordCount(count)}
                      className={cn(
                        "flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all border",
                        wordCount === count 
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700" 
                          : "bg-stone-50 border-stone-100 text-stone-500 hover:bg-stone-100"
                      )}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-semibold shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Crafting your script...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Generate Practice Script
                  </>
                )}
              </button>
            </div>
          </motion.div>
        ) : (
          <div className="space-y-8">
            {/* Progress Steps */}
            <div className="flex items-center justify-between px-4">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex items-center gap-3">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all",
                    currentStep === s 
                      ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30" 
                      : currentStep > s 
                        ? "bg-emerald-100 text-emerald-600" 
                        : "bg-stone-100 text-stone-400"
                  )}>
                    {currentStep > s ? <CheckCircle2 className="w-5 h-5" /> : s}
                  </div>
                  <span className={cn(
                    "text-xs font-bold uppercase tracking-widest hidden sm:block",
                    currentStep === s ? "text-stone-800" : "text-stone-400"
                  )}>
                    {s === 1 ? "Listen & Read" : s === 2 ? "Slow Shadowing" : "Natural Shadowing"}
                  </span>
                </div>
              ))}
            </div>

            {/* Script Card */}
            <motion.div 
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white border border-stone-200 rounded-3xl p-8 shadow-sm space-y-8"
            >
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-stone-400">
                    Practice Script
                  </h3>
                  <div className="flex flex-col items-end gap-3">
                    <div className="flex items-center gap-4">
                      {/* Speed Control */}
                      <div className="flex items-center gap-2 bg-stone-100 rounded-lg px-2 py-1">
                        <span className="text-[10px] font-bold text-stone-400">SPEED</span>
                        {[0.75, 1.0, 1.25].map((rate) => (
                          <button
                            key={rate}
                            onClick={() => setPlaybackRate(rate)}
                            className={cn(
                              "text-[10px] font-bold px-1.5 py-0.5 rounded transition-all",
                              playbackRate === rate ? "bg-white text-emerald-600 shadow-sm" : "text-stone-500 hover:text-stone-800"
                            )}
                          >
                            {rate}x
                          </button>
                        ))}
                      </div>

                      <div className="flex gap-2">
                        <button 
                          onClick={() => handlePlayAudio(currentStep === 2 ? 'slow' : 'natural', selectedSentenceIndex !== null ? sentences[selectedSentenceIndex] : undefined)}
                          disabled={audioLoading}
                          className={cn(
                            "p-2 rounded-lg transition-all disabled:opacity-50",
                            audioLoading ? "bg-stone-100 text-stone-400" : "bg-stone-50 hover:bg-stone-100 text-stone-600"
                          )}
                          title="Generate and play audio"
                        >
                          {audioLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Volume2 className="w-5 h-5" />}
                        </button>
                        {audioUrl && (
                          <button 
                            onClick={togglePlay}
                            className="p-2 bg-emerald-50 hover:bg-emerald-100 rounded-lg text-emerald-600 transition-all"
                            title={isPlaying ? "Pause" : "Play"}
                          >
                            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                          </button>
                        )}
                      </div>
                    </div>
                    {errorMessage && <span className="text-[10px] text-rose-500 font-medium">{errorMessage}</span>}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setIsSentenceMode(!isSentenceMode);
                          setSelectedSentenceIndex(null);
                        }}
                        className={cn(
                          "text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full border transition-all",
                          isSentenceMode ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-stone-200 text-stone-400 hover:border-stone-300"
                        )}
                      >
                        {isSentenceMode ? "Full Text Mode" : "Sentence Mode"}
                      </button>
                    </div>
                  </div>

                  <div className={cn(
                    "text-2xl leading-relaxed font-serif text-stone-800 bg-stone-50/50 p-8 rounded-2xl border border-stone-100 transition-all",
                    isSentenceMode && "p-4"
                  )}>
                    {!isSentenceMode ? (
                      <Markdown 
                        components={{
                          strong: ({node, ...props}) => <span className="text-emerald-700 font-bold underline decoration-emerald-200 underline-offset-4" {...props} />
                        }}
                      >
                        {script.markedText}
                      </Markdown>
                    ) : (
                      <div className="space-y-3">
                        {sentences.map((sentence, idx) => (
                          <div key={idx} className="relative group">
                            <button
                              onClick={() => handleSentenceClick(idx)}
                              className={cn(
                                "w-full text-left p-4 pr-12 rounded-xl border transition-all text-lg font-serif group relative",
                                selectedSentenceIndex === idx 
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-900 shadow-sm" 
                                  : "bg-white border-stone-100 text-stone-600 hover:border-stone-200"
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center">
                                  <span className={cn(
                                    "text-xs font-bold mr-3 transition-colors",
                                    selectedSentenceIndex === idx ? "text-emerald-400" : "text-stone-300"
                                  )}>0{idx + 1}</span>
                                  <span>{sentence}</span>
                                </div>
                                {selectedSentenceIndex === idx && isPlaying && (
                                  <div className="flex gap-0.5 items-end h-3 mr-2">
                                    <motion.div animate={{ height: [4, 12, 4] }} transition={{ repeat: Infinity, duration: 0.5 }} className="w-0.5 bg-emerald-500" />
                                    <motion.div animate={{ height: [8, 4, 8] }} transition={{ repeat: Infinity, duration: 0.6 }} className="w-0.5 bg-emerald-500" />
                                    <motion.div animate={{ height: [4, 10, 4] }} transition={{ repeat: Infinity, duration: 0.4 }} className="w-0.5 bg-emerald-500" />
                                  </div>
                                )}
                              </div>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSentenceClick(idx);
                              }}
                              className={cn(
                                "absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all z-10",
                                selectedSentenceIndex === idx ? "text-emerald-600 bg-emerald-100/50" : "text-stone-300 hover:text-emerald-600 hover:bg-emerald-50"
                              )}
                              title="Play this sentence"
                            >
                              <Volume2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-stone-400">Coach's Advice</h4>
                    <p className="text-sm text-stone-600 leading-relaxed">{script.explanation}</p>
                  </div>
                  <div className="space-y-2 border-l border-stone-100 pl-6">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-stone-400">Lời khuyên từ Coach</h4>
                    <p className="text-sm text-stone-600 leading-relaxed italic">{script.vietnameseExplanation}</p>
                  </div>
                </div>

                {/* Recording Section */}
                {(currentStep === 2 || currentStep === 3) && (
                  <div className="pt-6 border-t border-stone-100 flex flex-col items-center gap-4">
                    <div className="flex items-center gap-4">
                      {!isRecording ? (
                        <button
                          onClick={startRecording}
                          className="flex items-center gap-2 py-3 px-6 bg-rose-50 text-rose-600 rounded-xl font-semibold hover:bg-rose-100 transition-all border border-rose-100"
                        >
                          <Mic className="w-4 h-4" />
                          Record My Voice
                        </button>
                      ) : (
                        <button
                          onClick={stopRecording}
                          className="flex items-center gap-2 py-3 px-6 bg-rose-600 text-white rounded-xl font-semibold animate-pulse shadow-lg shadow-rose-600/20"
                        >
                          <div className="w-2 h-2 bg-white rounded-full" />
                          Stop Recording
                        </button>
                      )}

                      {recordedUrl && !isRecording && (
                        <button
                          onClick={playRecorded}
                          className="flex items-center gap-2 py-3 px-6 bg-stone-100 text-stone-600 rounded-xl font-semibold hover:bg-stone-200 transition-all"
                        >
                          <Play className="w-4 h-4" />
                          Listen to Myself
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-stone-400 uppercase tracking-widest">
                      {isRecording ? "Recording... Speak now!" : recordedUrl ? "Recording saved. Compare your voice with the AI!" : "Record yourself to compare with the AI."}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-8 border-t border-stone-100">
                <button
                  onClick={() => currentStep > 1 ? setCurrentStep((s) => (s - 1) as Step) : setScript(null)}
                  className="flex items-center gap-2 text-sm font-medium text-stone-500 hover:text-stone-800 transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {currentStep === 1 ? "New Topic" : "Previous Step"}
                </button>
                
                {currentStep < 3 ? (
                  <button
                    onClick={() => setCurrentStep((s) => (s + 1) as Step)}
                    className="flex items-center gap-2 py-3 px-6 bg-emerald-600 text-white rounded-xl font-semibold shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 transition-all"
                  >
                    Next Step
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <div className="flex gap-3">
                    <button
                      onClick={() => setCurrentStep(1)}
                      className="flex items-center gap-2 py-3 px-6 bg-stone-100 text-stone-600 rounded-xl font-semibold hover:bg-stone-200 transition-all"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Review
                    </button>
                    <button
                      onClick={handleGenerate}
                      className="flex items-center gap-2 py-3 px-6 bg-emerald-600 text-white rounded-xl font-semibold shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 transition-all"
                    >
                      <Sparkles className="w-4 h-4" />
                      New Script
                    </button>
                  </div>
                )}
              </div>
            </motion.div>

            {/* Legend */}
            <div className="bg-stone-100/50 rounded-2xl p-4 flex flex-wrap gap-6 justify-center text-[10px] font-bold uppercase tracking-widest text-stone-400">
              <span className="flex items-center gap-1.5"><span className="text-emerald-700 underline">Bold</span> Stressed</span>
              <span className="flex items-center gap-1.5">/ Short Pause</span>
              <span className="flex items-center gap-1.5">// End Sentence</span>
              <span className="flex items-center gap-1.5">↗ Rise</span>
              <span className="flex items-center gap-1.5">↘ Fall</span>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-6 py-12 text-center">
        <p className="text-xs text-stone-400 uppercase tracking-[0.2em]">
          Powered by Gemini AI • Crafted for Learners
        </p>
      </footer>
    </div>
  );
}
