import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const query = body.query || '';
    const llmModel = body.llmModel || 'qwen2.5:3b';
    const embeddingModel = body.embeddingModel || 'unclemusclez/jina-embeddings-v2-base-code';
    const topN = body.topN || 5;

    const protocol = req.headers.get('x-forwarded-proto') || 'http';
    const host = req.headers.get('host');
    const baseUrl = `${protocol}://${host}`;

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const sendStatus = (msg: string) => {
          controller.enqueue(new TextEncoder().encode(`{"type":"status","message":${JSON.stringify(msg)}}\n`));
        };
        const sendToken = (text: string) => {
          controller.enqueue(new TextEncoder().encode(`{"type":"token","content":${JSON.stringify(text)}}\n`));
        };
        const sendContext = (matches: any[], rawContext: string) => {
          controller.enqueue(new TextEncoder().encode(`{"type":"context","matches":${JSON.stringify(matches)},"rawContext":${JSON.stringify(rawContext)}}\n`));
        };

        try {
          sendStatus("Agent initialized. Pondering the request...");

          let messages = [
            {
              role: "system",
              content: "You are an autonomous AI coding agent. You have access to a tool called `search_codebase` which performs a Hybrid Search (Semantic + Keyword) over the user's entire local codebase. If the search tool returns a small chunk of a file but you need to see the entire file to understand the architecture or context, you can use the `read_entire_file` tool to load the full source code. Once you have read enough code, formulate a final answer."
            }
          ];

          if (body.history && Array.isArray(body.history)) {
             for (const msg of body.history) {
                // Strip out the spinning status messages so LLM just sees text
                const cleanContent = msg.content.replace(/> 🔄 \*.*?\*\n\n/g, '').trim();
                if (cleanContent) {
                   messages.push({ role: msg.role, content: cleanContent });
                }
             }
          }

          messages.push({
             role: "user",
             content: query
          });

          const tools = [
            {
              type: "function",
              function: {
                name: "search_codebase",
                description: "Search the local codebase to find relevant code snippets.",
                parameters: {
                  type: "object",
                  properties: {
                    search_query: {
                      type: "string",
                      description: "The semantic or keyword query to search for (e.g. 'fetch users', 'getUsers endpoint', 'Auth logic')."
                    }
                  },
                  required: ["search_query"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "read_entire_file",
                description: "Read the entire contents of a specific file by its absolute path.",
                parameters: {
                  type: "object",
                  properties: {
                    file_path: {
                      type: "string",
                      description: "The absolute file path of the file to read, exactly as provided by the search_codebase tool (e.g. 'D:/LM-ADMIN/...')."
                    }
                  },
                  required: ["file_path"]
                }
              }
            }
          ];

          let isDone = false;
          let iterations = 0;
          const maxIterations = 8;
          let previousQueries = new Set<string>();

          while (!isDone && iterations < maxIterations) {
            iterations++;
            
            // Non-streaming call to let the LLM decide if it wants to use a tool
            console.log(`\n\n==================== AGENT ITERATION ${iterations} ====================`);
            console.log(`Sending Payload to Ollama (Messages Array Length: ${messages.length}):`);
            console.log(JSON.stringify(messages[messages.length - 1], null, 2));
            
            const chatRes = await fetch('http://localhost:11434/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: llmModel,
                messages,
                tools,
                stream: false
              })
            });

            if (!chatRes.ok) throw new Error("Failed to communicate with LLM");

            const chatData = await chatRes.json();
            const responseMessage = chatData.message;

            console.log(`\nOllama Responded With:`);
            console.log(JSON.stringify(responseMessage, null, 2));

            messages.push(responseMessage);

            let toolCallsToExecute = responseMessage.tool_calls || [];
            
            // Fallback for models that output tool calls as raw JSON in the content string
            if (toolCallsToExecute.length === 0 && responseMessage.content) {
               let jsonString = "";
               const jsonMatch = responseMessage.content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
               if (jsonMatch) {
                  jsonString = jsonMatch[1];
               } else if (responseMessage.content.trim().startsWith("{") && responseMessage.content.trim().endsWith("}")) {
                  jsonString = responseMessage.content.trim();
               }

               if (jsonString) {
                  try {
                     const parsed = JSON.parse(jsonString);
                     if (parsed.name && parsed.arguments) {
                        toolCallsToExecute = [{
                           function: {
                              name: parsed.name,
                              arguments: parsed.arguments
                           }
                        }];
                        // Wipe the text content so it doesn't get rendered as a final answer
                        responseMessage.content = "";
                     }
                  } catch (e) {
                     console.log("Failed to parse raw markdown JSON tool call.");
                  }
               }
            }

            if (toolCallsToExecute && toolCallsToExecute.length > 0) {
              for (const toolCall of toolCallsToExecute) {
                if (toolCall.function.name === 'search_codebase') {
                  const args = toolCall.function.arguments;
                  let sq = args.search_query;
                  if (typeof sq === 'object') {
                     sq = JSON.stringify(sq);
                  }
                  
                  if (previousQueries.has(sq)) {
                     console.log(`\nLoop Breaker Triggered! Model tried to search for "${sq}" again.`);
                     messages.push({
                        role: "tool",
                        content: `You already searched for "${sq}". You must stop searching and formulate a final answer based on the context you already have.`
                     });
                     continue;
                  }
                  previousQueries.add(sq);

                  sendStatus(`Running Hybrid Search for: "${sq}"...`);
                  
                  // Call our context API
                  const contextRes = await fetch(`${baseUrl}/api/context`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: sq, topN, embeddingModel })
                  });
                  
                  if (!contextRes.ok) {
                     messages.push({ role: "tool", content: "Search tool failed." });
                     continue;
                  }

                  const contextData = await contextRes.json();
                  sendContext(contextData.matches, contextData.rawContext);
                  
                  messages.push({
                    role: "tool",
                    content: contextData.rawContext
                  });
                  
                  console.log(`\nSearch Tool Completed. Extracted ${contextData.matches.length} chunks and appended them to the Agent's context.`);
                  sendStatus(`Found ${contextData.matches.length} matching files. Reading the code...`);
                } else if (toolCall.function.name === 'read_entire_file') {
                  const args = toolCall.function.arguments;
                  const filePath = args.file_path;
                  
                  if (previousQueries.has("read:" + filePath)) {
                     messages.push({
                        role: "tool",
                        content: `You already tried to read ${filePath}. Please formulate your answer based on what you have.`
                     });
                     continue;
                  }
                  previousQueries.add("read:" + filePath);

                  sendStatus(`Reading entire file: ${filePath.split(/[\/\\]/).pop()}...`);
                  
                  try {
                     let resolvedPath = filePath;
                     // If it's a relative path from the LM-ADMIN repo, resolve it.
                     if (!fs.existsSync(resolvedPath)) {
                        resolvedPath = path.join("D:/LM-ADMIN/lm-admin", filePath);
                     }

                     if (fs.existsSync(resolvedPath)) {
                        const fileContent = fs.readFileSync(resolvedPath, 'utf8');
                        messages.push({
                           role: "tool",
                           content: `=== FILE START (${resolvedPath}) ===\n${fileContent}\n=== FILE END ===`
                        });
                        console.log(`\nRead entire file: ${resolvedPath} (${fileContent.length} chars)`);
                     } else {
                        messages.push({
                           role: "tool",
                           content: `ERROR: File not found at path: ${resolvedPath}`
                        });
                     }
                  } catch (err: any) {
                     messages.push({
                        role: "tool",
                        content: `ERROR: Failed to read file. ${err.message}`
                     });
                  }
                }
              }
            } else {
              // No tool calls, output the final answer!
              isDone = true;
              sendStatus("Formulating final answer...");
              // The non-streaming call already generated the full text! We just send it as one big token.
              // (To make it typewriter effect, the client can animate it, or we could chunk it here, but sending as one is fine).
              sendToken(responseMessage.content);
            }
          }
          
          if (!isDone) {
             sendToken("\n\n[Agent automatically paused after 3 search iterations to prevent infinite loops.]");
          }

        } catch (e) {
           controller.enqueue(new TextEncoder().encode(`{"type":"error","message":${JSON.stringify(String(e))}}\n`));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
