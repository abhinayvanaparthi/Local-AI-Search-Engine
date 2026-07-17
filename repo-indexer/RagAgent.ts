import { ContextBuilderSkill } from './ContextBuilderSkill';
import { PromptBuilder } from './PromptBuilder';

async function main() {
  const args = process.argv.slice(2);
  let query = '';
  let model = 'qwen2.5:3b'; // Default to a tiny fast model

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) {
      model = args[i + 1];
      i++;
    } else if (!args[i].startsWith('--')) {
      query = args[i];
    }
  }

  if (!query) {
    console.error("\x1b[31mError: Please provide a natural language query.\x1b[0m");
    console.error("Usage: npx tsx tools/repo-indexer/RagAgent.ts \"How do event cards work?\"");
    process.exit(1);
  }

  console.log(`\x1b[36mInitializing RAG Agent...\x1b[0m`);
  console.log(`\x1b[36mBuilding Context Package for: "${query}"\x1b[0m`);
  
  const builder = new ContextBuilderSkill();
  let contextPackage = "";
  try {
     contextPackage = await builder.buildContext(query, 10, 8000, 1);
  } catch(e) {
     console.error("\x1b[31mError building context:\x1b[0m", e);
     process.exit(1);
  }

  const prompt = PromptBuilder.buildStrictRagPrompt(query, contextPackage);
  
  console.log(`\x1b[32mContext built successfully. Streaming LLM response (${model})...\x1b[0m\n`);
  console.log(`=========================================\n`);

  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: true
      })
    });

    if (!response.ok) {
       console.error(`\x1b[31mOllama Error: ${response.status}\x1b[0m`);
       return;
    }

    if (!response.body) return;

    // Stream handling
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.trim() !== '');
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          process.stdout.write(json.response);
        } catch(e) {
          // ignore parsing errors on fragmented chunks
        }
      }
    }
    console.log(`\n\n=========================================\n`);
  } catch(e) {
     console.error("\x1b[31mFailed to connect to Ollama.\x1b[0m");
     console.error(`Make sure your server is running and the model is pulled!`);
     console.error(`Run: ollama pull ${model}`);
  }
}

main().catch(console.error);
