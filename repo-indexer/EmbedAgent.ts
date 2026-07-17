import fs from 'fs';
import path from 'path';

interface EmbeddingEntry {
  path: string;
  symbol: string;
  type: 'component' | 'function' | 'hook' | 'type' | 'route';
  text: string;
  model: string;
  embedding: number[];
}

const INDEX_PATH = path.join(process.cwd(), 'repo-index.json');
const EMBEDDINGS_PATH = path.join(process.cwd(), 'repo-embeddings.json');
const OLLAMA_URL = 'http://localhost:11434/api/embeddings';
const MODEL = 'unclemusclez/jina-embeddings-v2-base-code';

async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt: text })
    });
    
    if (!response.ok) {
       console.error(`Ollama returned status ${response.status}`);
       return null;
    }
    
    const data = await response.json();
    return data.embedding || null;
  } catch (e) {
    console.error('Error connecting to Ollama. Is it running?', e);
    return null;
  }
}

async function main() {
  console.log(`\n\x1b[36m🚀 Starting Semantic Embedding Agent\x1b[0m\n`);
  
  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`\x1b[31mError: repo-index.json not found. Run the indexer first.\x1b[0m`);
    process.exit(1);
  }

  // Verify Ollama connection
  console.log(`Checking connection to Ollama at ${OLLAMA_URL}...`);
  const testEmbed = await generateEmbedding("test");
  if (!testEmbed) {
    console.error(`\x1b[31mFailed to connect to Ollama. Make sure you ran 'ollama serve' or the app is open.\x1b[0m`);
    process.exit(1);
  }
  console.log(`\x1b[32mSuccessfully connected to Ollama (${MODEL})\x1b[0m\n`);

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  
  let existingEmbeddings: EmbeddingEntry[] = [];
  if (fs.existsSync(EMBEDDINGS_PATH)) {
     existingEmbeddings = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'));
     console.log(`Loaded ${existingEmbeddings.length} existing embeddings.`);
  }

  // Create a fast lookup Map to reuse existing vectors and prune deleted ones
  const existingTextMap = new Map(existingEmbeddings.map(e => [e.text, e]));
  const newEmbeddings: EmbeddingEntry[] = [];
  
  let newlyGenerated = 0;
  const files = Object.entries(index.files);
  const totalFiles = files.length;

  for (let i = 0; i < totalFiles; i++) {
    const [filePath, metadata]: [string, any] = files[i];
    
    // Build imports text
    const imports = metadata.importedNames && metadata.importedNames.length > 0 
      ? metadata.importedNames.join(', ') 
      : 'None';
    
    const chunksToEmbed: { type: string, symbol: string, text: string }[] = [];

    // Route
    if (metadata.nextjs && metadata.nextjs.route) {
       chunksToEmbed.push({
          type: 'route',
          symbol: metadata.nextjs.route,
          text: `Route: ${metadata.nextjs.route}. Path: ${filePath}. Type: ${metadata.nextjs.type}. Imports: ${imports}.`
       });
    }

    const buildRichText = (typeLabel: string, item: any, extraCalls: string = '') => {
      const isStr = typeof item === 'string';
      const name = isStr ? item : item.name;
      const code = !isStr && item.code ? `\nCode:\n${item.code.substring(0, 2000)}` : '';
      const docs = !isStr && item.jsDocs ? `\nDocs:\n${item.jsDocs}` : '';
      return `${typeLabel}: ${name}. Path: ${filePath}. Imports: ${imports}.${extraCalls}${docs}${code}`;
    };

    // Components
    if (metadata.components) {
      for (const comp of metadata.components) {
         const symbol = typeof comp === 'string' ? comp : comp.name;
         chunksToEmbed.push({
            type: 'component',
            symbol,
            text: buildRichText('Component', comp)
         });
      }
    }

    // Hooks
    if (metadata.hooks) {
      for (const hook of metadata.hooks) {
         const symbol = typeof hook === 'string' ? hook : hook.name;
         chunksToEmbed.push({
            type: 'hook',
            symbol,
            text: buildRichText('Hook', hook)
         });
      }
    }

    // Functions
    if (metadata.functions) {
      for (const fn of metadata.functions) {
         const symbol = typeof fn === 'string' ? fn : fn.name;
         const callsObj = metadata.functionCalls?.find((c: any) => c.functionName === symbol);
         const callsText = callsObj && callsObj.calls.length > 0 ? ` Calls: ${callsObj.calls.join(', ')}.` : '';
         chunksToEmbed.push({
            type: 'function',
            symbol,
            text: buildRichText('Function', fn, callsText)
         });
      }
    }

    // Types
    if (metadata.types) {
      for (const type of metadata.types) {
         chunksToEmbed.push({
            type: 'type',
            symbol: type,
            text: `Type: ${type}. Path: ${filePath}.`
         });
      }
    }

    // Process Chunks
    for (const chunk of chunksToEmbed) {
       if (existingTextMap.has(chunk.text)) {
         newEmbeddings.push(existingTextMap.get(chunk.text)!);
         continue; // Reuse existing embedding and skip generation
       }

       process.stdout.write(`Embedding [${chunk.type}] ${chunk.symbol} (${filePath})... `);
       const vector = await generateEmbedding(chunk.text);
       
       if (vector) {
         newEmbeddings.push({
            path: filePath,
            symbol: chunk.symbol,
            type: chunk.type as any,
            text: chunk.text,
            model: MODEL,
            embedding: vector
         });
         existingTextMap.set(chunk.text, newEmbeddings[newEmbeddings.length - 1]);
         newlyGenerated++;
         process.stdout.write(`\x1b[32mOK\x1b[0m\n`);
         
         // Save periodically to avoid losing progress
         if (newlyGenerated % 50 === 0) {
            fs.writeFileSync(EMBEDDINGS_PATH, JSON.stringify(newEmbeddings, null, 2));
         }
       } else {
         process.stdout.write(`\x1b[31mFAILED\x1b[0m\n`);
       }
    }
  }

  // Final save
  if (newlyGenerated > 0) {
    fs.writeFileSync(EMBEDDINGS_PATH, JSON.stringify(newEmbeddings, null, 2));
    console.log(`\n\x1b[32m✅ Successfully generated and saved ${newlyGenerated} new embeddings to repo-embeddings.json!\x1b[0m\n`);
  } else {
    console.log(`\n\x1b[33mNo new symbols to embed. Database is up to date.\x1b[0m\n`);
  }
}

main().catch(console.error);
