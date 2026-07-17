import { ContextBuilderSkill } from './ContextBuilderSkill';

async function main() {
  const args = process.argv.slice(2);
  let query = '';
  let topN = 10;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--top' && args[i + 1]) {
      topN = parseInt(args[i + 1], 10);
      i++;
    } else if (!args[i].startsWith('--')) {
      query = args[i];
    }
  }

  if (!query) {
    console.error("\x1b[31mError: Please provide a natural language query.\x1b[0m");
    console.error("Usage: npx tsx tools/repo-indexer/ContextBuilderAgent.ts \"How do event cards work?\"");
    process.exit(1);
  }

  console.log(`\x1b[36mInitializing Context Builder...\x1b[0m`);
  console.log(`\x1b[36mRunning Semantic Search for: "${query}" (Top ${topN})\x1b[0m\n`);
  
  const builder = new ContextBuilderSkill();
  
  try {
     const contextPackage = await builder.buildContext(query, topN);
     
     // Calculate Token Metrics
     const charCount = contextPackage.length;
     const estimatedTokens = Math.ceil(charCount / 4);
     
     console.log(`\n\x1b[33m=========================================\x1b[0m`);
     console.log(`\x1b[33m📊 PAYLOAD METRICS:\x1b[0m`);
     console.log(`\x1b[33mTotal Characters: ${charCount}\x1b[0m`);
     console.log(`\x1b[33mEstimated Tokens: ~${estimatedTokens}\x1b[0m`);
     console.log(`\x1b[33m=========================================\x1b[0m\n`);
     
     console.log(contextPackage);
  } catch(e) {
     console.error("\x1b[31mError building context:\x1b[0m", e);
  }
}

main().catch(console.error);
