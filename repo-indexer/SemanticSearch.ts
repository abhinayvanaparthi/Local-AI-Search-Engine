import fs from 'fs';
import path from 'path';
import readline from 'readline';

interface EmbeddingEntry {
  path: string;
  symbol: string;
  type: string;
  text: string;
  model: string;
  embedding: number[];
}

const EMBEDDINGS_PATH = path.join(process.cwd(), 'repo-embeddings.json');
const OLLAMA_URL = 'http://localhost:11434/api/embeddings';
const MODEL = 'nomic-embed-text';

function cosineSimilarity(vecA: number[], vecB: number[]): number {
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

async function getQueryEmbedding(query: string): Promise<number[] | null> {
  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt: query })
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.embedding || null;
  } catch (e) {
    console.error('\x1b[31mError connecting to Ollama API. Ensure it is running!\x1b[0m');
    return null;
  }
}

async function search(query: string, embeddings: EmbeddingEntry[], topN: number) {
  process.stdout.write(`\x1b[36mGenerating embedding for query...\x1b[0m `);
  const queryVec = await getQueryEmbedding(query);
  if (!queryVec) {
    console.log(`\x1b[31mFAILED\x1b[0m`);
    return;
  }
  console.log(`\x1b[32mDONE\x1b[0m`);

  const results = embeddings.map(entry => {
    return {
      score: cosineSimilarity(queryVec, entry.embedding),
      symbol: entry.symbol,
      type: entry.type,
      path: entry.path
    };
  });

  // Sort descending by score
  results.sort((a, b) => b.score - a.score);
  
  const topResults = results.slice(0, topN);

  console.log(`\n\x1b[33m🔍 Top ${topN} Results for: "${query}"\x1b[0m`);
  console.log(`--------------------------------------------------`);
  topResults.forEach(r => {
    const scoreStr = r.score.toFixed(4);
    console.log(`Score: \x1b[32m${scoreStr}\x1b[0m | [\x1b[36m${r.type}\x1b[0m] \x1b[35m${r.symbol}\x1b[0m (\x1b[90m${r.path}\x1b[0m)`);
  });
  console.log(`--------------------------------------------------\n`);
}

async function main() {
  const args = process.argv.slice(2);
  let query = '';
  let topN = 10;

  // Simple arg parser
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--top' && args[i + 1]) {
      topN = parseInt(args[i + 1], 10);
      i++;
    } else if (!args[i].startsWith('--')) {
      query = args[i];
    }
  }

  if (!fs.existsSync(EMBEDDINGS_PATH)) {
    console.error(`\x1b[31mError: repo-embeddings.json not found. Run the EmbedAgent first.\x1b[0m`);
    process.exit(1);
  }

  console.log(`\x1b[36mLoading database into memory...\x1b[0m`);
  const embeddings: EmbeddingEntry[] = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'));
  console.log(`\x1b[32mLoaded ${embeddings.length} vectors instantly.\x1b[0m\n`);

  if (query) {
    // One-off search
    await search(query, embeddings, topN);
  } else {
    // Interactive REPL Mode
    console.log(`\x1b[33mEntering Interactive Semantic Search Mode.\x1b[0m`);
    console.log(`Type your query below, or type 'exit' to quit.\n`);
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const prompt = () => {
      rl.question('\x1b[36mSearch Query > \x1b[0m', async (input) => {
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          rl.close();
          return;
        }
        if (input.trim()) {
           await search(input, embeddings, topN);
        }
        prompt();
      });
    };
    prompt();
  }
}

main().catch(console.error);
