import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Fuse from 'fuse.js';

// Cache embeddings in memory to prevent reading 35MB file on every request
let cachedEmbeddings: any[] = [];
let cachedIndex: any[] = [];
let cachedFuse: Fuse<any> | null = null;

function getCosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}



export async function POST(req: Request) {
  try {
    const body = await req.json();
    const query = body.query || '';
    const topN = body.topN || 5;
    const embeddingModel = body.embeddingModel || 'unclemusclez/jina-embeddings-v2-base-code';

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    // 1. Get query embedding from Ollama
    const embedRes = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: embeddingModel, prompt: query })
    });

    if (!embedRes.ok) {
      return NextResponse.json({ error: 'Failed to generate embedding from Ollama' }, { status: 500 });
    }

    const embedData = await embedRes.json();
    const queryEmbedding = embedData.embedding;

    if (!queryEmbedding) {
      return NextResponse.json({ error: 'No embedding returned' }, { status: 500 });
    }

    // 2. Load database (cached)
    if (cachedEmbeddings.length === 0) {
      const dbPath = path.join(process.cwd(), '../repo-embeddings.json');
      if (!fs.existsSync(dbPath)) {
        return NextResponse.json({ error: 'repo-embeddings.json not found. Run EmbedAgent first.' }, { status: 404 });
      }
      const rawData = fs.readFileSync(dbPath, 'utf8');
      const db = JSON.parse(rawData);
      cachedEmbeddings = Array.isArray(db) ? db : (db.embeddings || []);
      
      cachedFuse = new Fuse(cachedEmbeddings, {
         keys: ['symbol', 'text'],
         includeScore: true,
         threshold: 0.5, // 0.0 is exact match, 1.0 is anything
         ignoreLocation: true
      });
    }

    // 3. Compute similarities (Hybrid Search: Vector + Fuzzy Keyword)
    let fuseScores = new Float32Array(cachedEmbeddings.length);
    if (cachedFuse && query) {
      const results = cachedFuse.search(query);
      for (const res of results) {
        // Fuse score: 0 is perfect match, 1 is mismatch
        // We invert it so higher is better
        const score = res.score !== undefined ? (1 - res.score) : 0;
        fuseScores[res.refIndex] = score; 
      }
    }

    const scoredItems = [];
    for (let i = 0; i < cachedEmbeddings.length; i++) {
      const item = cachedEmbeddings[i];
      let vectorScore = 0;
      if (item.embedding && item.embedding.length === queryEmbedding.length) {
        vectorScore = getCosineSimilarity(queryEmbedding, item.embedding);
      }
      const keywordScore = fuseScores[i];
      scoredItems.push({ ...item, vectorScore, keywordScore });
    }

    // 4. Normalize and Blend (70% Semantic, 30% Keyword)
    const maxVector = Math.max(...scoredItems.map(i => i.vectorScore), 0.0001);
    const maxKeyword = Math.max(...scoredItems.map(i => i.keywordScore), 0.0001);

    const finalResults = scoredItems.map(item => {
      const normalizedVector = Math.max(0, item.vectorScore) / maxVector;
      const normalizedKeyword = item.keywordScore / maxKeyword;
      // Alpha blending
      const finalScore = (0.7 * normalizedVector) + (0.3 * normalizedKeyword);
      return { ...item, score: finalScore };
    });

    finalResults.sort((a, b) => b.score - a.score);
    const topResults = finalResults.slice(0, topN);

    // 5. Build raw context string (to calculate exact token metrics)
    let rawContext = `=========================================\nCONTEXT PACKAGE GENERATED\nQuery: "${query}"\n=========================================\n\n`;
    const cleanedResults = topResults.map(r => {
      const displayScore = r.score.toFixed(4);
      rawContext += `Relevant File: ${r.path}\nSemantic Match: ${r.symbol} (${r.type}) | Score: ${displayScore}\n\n${r.text}\n\n`;
      return {
        filePath: r.path,
        symbol: r.symbol,
        type: r.type,
        score: displayScore,
        text: r.text
      };
    });

    const charCount = rawContext.length;
    const estimatedTokens = Math.ceil(charCount / 4);

    return NextResponse.json({
      matches: cleanedResults,
      rawContext,
      metrics: {
        charCount,
        estimatedTokens
      }
    });

  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
