import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Cache embeddings in memory to prevent reading 35MB file on every request
let cachedEmbeddings: any[] = [];
let cachedIndex: any[] = [];

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

function calculateKeywordScore(query: string, text: string): number {
  // Extract words longer than 2 characters
  const queryTerms = query.toLowerCase().split(/\W+/).filter(t => t.length > 2);
  if (queryTerms.length === 0) return 0;
  
  const textLower = text.toLowerCase();
  let score = 0;
  
  for (const term of queryTerms) {
    let count = 0;
    let idx = textLower.indexOf(term);
    while (idx !== -1) {
      count++;
      idx = textLower.indexOf(term, idx + term.length);
    }
    // Cap at 5 matches per term to prevent spamming
    score += Math.min(count, 5);
  }
  return score;
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
    }

    // 3. Compute similarities (Hybrid Search: Vector + Keyword)
    const scoredItems = [];
    for (const item of cachedEmbeddings) {
      let vectorScore = 0;
      if (item.embedding && item.embedding.length === queryEmbedding.length) {
        vectorScore = getCosineSimilarity(queryEmbedding, item.embedding);
      }
      const keywordScore = calculateKeywordScore(query, item.text);
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
