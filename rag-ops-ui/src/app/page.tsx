"use client";

import React, { useState, useEffect, useRef } from "react";
import { Loader2, Server, Database, Bot, Settings2, Play, SearchCode, Copy, CheckCircle2 } from "lucide-react";

type Message = { role: "user" | "assistant"; content: string };
type Match = { filePath: string; symbol: string; type: string; score: string; text: string };
type Metrics = { charCount: number; estimatedTokens: number };

export default function RAGDashboard() {
  const [isOllamaOnline, setIsOllamaOnline] = useState(false);
  const [models, setModels] = useState<{name: string}[]>([]);
  
  const [selectedEmbedModel, setSelectedEmbedModel] = useState("unclemusclez/jina-embeddings-v2-base-code:latest");
  const [selectedLLM, setSelectedLLM] = useState("qwen2.5:3b");
  const [topN, setTopN] = useState(5);
  const [contextOnly, setContextOnly] = useState(false);
  
  const [query, setQuery] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentMatches, setCurrentMatches] = useState<Match[]>([]);
  const [currentMetrics, setCurrentMetrics] = useState<Metrics | null>(null);
  const [rawContext, setRawContext] = useState("");
  const [copied, setCopied] = useState(false);

  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkStatus();
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const checkStatus = async () => {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      if (data.status === "online") {
        setIsOllamaOnline(true);
        setModels(data.models);
        
        // Auto-select defaults if present
        if (!models.find(m => m.name === selectedEmbedModel) && data.models.length > 0) {
           setSelectedEmbedModel(data.models.find((m: any) => m.name.includes("embed"))?.name || data.models[0].name);
        }
        if (!models.find(m => m.name === selectedLLM) && data.models.length > 0) {
           setSelectedLLM(data.models.find((m: any) => !m.name.includes("embed"))?.name || data.models[0].name);
        }
      } else {
        setIsOllamaOnline(false);
      }
    } catch (e) {
      setIsOllamaOnline(false);
    }
  };

  const handleCopyContext = () => {
    navigator.clipboard.writeText(rawContext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isProcessing) return;

    const userQuery = query.trim();
    setQuery("");
    setMessages(prev => [...prev, { role: "user", content: userQuery }]);
    setIsProcessing(true);
    setCurrentMatches([]);
    setCurrentMetrics(null);
    setRawContext("");

    try {
      // Step 1: Get Context
      const contextRes = await fetch("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userQuery, topN, embeddingModel: selectedEmbedModel })
      });

      if (!contextRes.ok) throw new Error("Failed to retrieve context");
      const contextData = await contextRes.json();
      
      setCurrentMatches(contextData.matches);
      setCurrentMetrics(contextData.metrics);
      setRawContext(contextData.rawContext);

      if (contextOnly) {
        setMessages(prev => [...prev, { 
          role: "assistant", 
          content: "Context Generated! You can view it in the right pane or copy it."
        }]);
        setIsProcessing(false);
        return;
      }

      // Step 2: Generate LLM Response (Streaming)
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);
      
      const genRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userQuery, rawContext: contextData.rawContext, llmModel: selectedLLM })
      });

      if (!genRes.ok) throw new Error("Failed to generate response");
      
      const reader = genRes.body?.getReader();
      const decoder = new TextDecoder();
      
      if (reader) {
        let aiText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          // Ollama stream format parsing
          const lines = chunk.split('\n').filter(l => l.trim() !== '');
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.response) {
                aiText += parsed.response;
                setMessages(prev => {
                  const newMsgs = [...prev];
                  newMsgs[newMsgs.length - 1].content = aiText;
                  return newMsgs;
                });
              }
            } catch (e) { /* ignore parse error for incomplete chunks */ }
          }
        }
      }
    } catch (error: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${error.message}` }]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans">
      {/* LEFT PANE: LLM Chat Interface */}
      <div className="flex-1 flex flex-col border-r border-slate-200 bg-white">
        
        {/* Header Options */}
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 bg-slate-50 items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg text-indigo-700">
            <Bot className="w-6 h-6" />
            LM-Admin RAG Ops
          </div>
          
          <div className="flex items-center gap-4 text-sm">
             <div className="flex items-center gap-2">
                <label className="font-semibold text-slate-600">LLM:</label>
                <select 
                  value={selectedLLM} 
                  onChange={e => setSelectedLLM(e.target.value)}
                  className="bg-white border border-slate-300 rounded px-2 py-1 outline-none"
                >
                  {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
             </div>
             <div className="flex items-center gap-2">
               <input 
                 type="checkbox" 
                 id="contextOnly" 
                 checked={contextOnly} 
                 onChange={e => setContextOnly(e.target.checked)} 
                 className="rounded border-slate-300"
               />
               <label htmlFor="contextOnly" className="font-semibold text-slate-600 cursor-pointer">Context Only</label>
             </div>
          </div>
        </div>

        {/* Chat Window */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <Database className="w-16 h-16 mb-4 opacity-50" />
              <h2 className="text-xl font-semibold mb-2">Ask the Codebase</h2>
              <p>Type a natural language query below to semantically search the repo.</p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-xl p-4 shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100 border border-slate-200 text-slate-800'}`}>
                   {msg.role === 'assistant' && msg.content === '' ? (
                     <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/> Processing...</span>
                   ) : (
                     <div className="whitespace-pre-wrap">{msg.content}</div>
                   )}
                </div>
              </div>
            ))
          )}
          <div ref={endOfMessagesRef} />
        </div>

        {/* Input Form */}
        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="e.g. How does the isCoachingBeyond flag conditionally render the Umpire Upload component?"
              className="flex-1 px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              disabled={isProcessing}
            />
            <button
              type="submit"
              disabled={isProcessing || !query.trim()}
              className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition disabled:opacity-50 flex items-center gap-2 shadow-sm"
            >
              {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
              Run
            </button>
          </form>
        </div>
      </div>

      {/* RIGHT PANE: Context Inspector */}
      <div className="w-[450px] flex flex-col bg-slate-100 border-l border-slate-200 shadow-inner">
        
        {/* Status Header */}
        <div className="p-4 border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold flex items-center gap-2"><Settings2 className="w-5 h-5"/> Diagnostics</h3>
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-bold ${isOllamaOnline ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              <Server className="w-3 h-3" />
              {isOllamaOnline ? 'Ollama Online' : 'Ollama Offline'}
            </div>
          </div>
          
          <div className="space-y-2 text-sm text-slate-600">
             <div className="flex flex-col">
                <label className="font-semibold text-xs uppercase tracking-wider mb-1">Embedding Engine</label>
                <select 
                  value={selectedEmbedModel} 
                  onChange={e => setSelectedEmbedModel(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none text-xs"
                >
                  {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
             </div>
             
             <div className="flex items-center justify-between mt-3">
               <label className="font-semibold text-xs uppercase tracking-wider">Top N Chunks</label>
               <input 
                  type="range" min="1" max="15" value={topN} 
                  onChange={e => setTopN(parseInt(e.target.value))}
                  className="w-24 cursor-pointer accent-indigo-600"
               />
               <span className="font-bold text-indigo-600 w-6 text-right">{topN}</span>
             </div>
          </div>
        </div>

        {/* Payload Metrics */}
        {currentMetrics && (
          <div className="p-4 bg-indigo-50 border-b border-indigo-100">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-indigo-900 text-sm flex items-center gap-2">
                <SearchCode className="w-4 h-4"/> Payload Metrics
              </h4>
              <button 
                onClick={handleCopyContext}
                className="text-indigo-600 hover:text-indigo-800 transition flex items-center gap-1 text-xs font-semibold bg-indigo-100 px-2 py-1 rounded"
              >
                {copied ? <CheckCircle2 className="w-3 h-3"/> : <Copy className="w-3 h-3" />}
                {copied ? "Copied!" : "Copy Raw Context"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-white p-2 rounded border border-indigo-100 shadow-sm">
                <div className="text-slate-500 mb-1">Total Characters</div>
                <div className="font-bold text-lg text-indigo-700">{currentMetrics.charCount.toLocaleString()}</div>
              </div>
              <div className="bg-white p-2 rounded border border-indigo-100 shadow-sm">
                <div className="text-slate-500 mb-1">Estimated Tokens</div>
                <div className="font-bold text-lg text-indigo-700">~{currentMetrics.estimatedTokens.toLocaleString()}</div>
              </div>
            </div>
          </div>
        )}

        {/* Semantic Matches list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
           {currentMatches.length === 0 && !isProcessing && (
             <div className="text-center text-sm text-slate-400 mt-10">
               Run a query to inspect vector database matches.
             </div>
           )}
           
           {currentMatches.map((match, idx) => (
             <div key={idx} className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden text-sm">
               <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex justify-between items-center">
                 <div className="font-semibold text-slate-800 truncate pr-2" title={match.symbol}>
                   {match.symbol} <span className="font-normal text-xs text-slate-500">({match.type})</span>
                 </div>
                 <div className="bg-green-100 text-green-700 font-bold px-1.5 py-0.5 rounded text-xs">
                   {match.score}
                 </div>
               </div>
               <div className="px-3 py-2 text-xs text-slate-500 bg-slate-100 border-b border-slate-200 break-all font-mono">
                 {match.filePath}
               </div>
               <div className="p-3 max-h-48 overflow-y-auto bg-slate-900 text-green-400 font-mono text-xs whitespace-pre-wrap">
                 {match.text}
               </div>
             </div>
           ))}
        </div>
      </div>
    </div>
  );
}
