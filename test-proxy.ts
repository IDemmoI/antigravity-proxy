import worker from "./worker.ts";
import fs from "node:fs";

async function runTests() {
    console.log("========================================================");
    console.log("   Running Live Google Cloud Code Integration Tests");
    console.log("========================================================\n");

    if (!fs.existsSync("./accounts.json")) {
        console.log("Notice: accounts.json file not found. Skipping live Google integration tests.");
        console.log("Run 'npm run login' first to configure accounts for live tests.\n");
        return;
    }

    const accountsJson = fs.readFileSync("./accounts.json", "utf-8");
    const TEST_KEY = "test-proxy-secret-key";

    const env = {
        PROXY_API_KEY: TEST_KEY,
        ACCOUNTS: accountsJson
    };

    const ctx: any = {
        waitUntil: () => {},
        passThroughOnException: () => {}
    };

    let totalPassed = 0;
    let totalTests = 0;

    function assert(condition: boolean, testName: string, details?: any) {
        totalTests++;
        if (condition) {
            totalPassed++;
            console.log(`[PASS] Test ${totalTests}: ${testName}`);
        } else {
            console.error(`[FAIL] Test ${totalTests}: ${testName}`, details || "");
            process.exitCode = 1;
        }
    }

    // Ensure accounts pool is loaded and cooldowns are clear at the start of tests
    await worker.fetch(new Request("http://localhost/v1/accounts/reset", {
        method: "POST",
        headers: { "Authorization": `Bearer ${TEST_KEY}` }
    }), env, ctx);

    // 1. Health check test
    console.log("Executing Test 1: Health check endpoint...");
    const healthReq = new Request("http://localhost/health");
    const healthResp = await worker.fetch(healthReq, env, ctx);
    const healthData = await healthResp.json() as any;
    assert(healthResp.status === 200 && healthData.status === "ok", "GET /health returns HTTP 200 OK");

    // 2. Authentication enforcement (Missing token)
    console.log("\nExecuting Test 2: Authentication enforcement (Missing Authorization header)...");
    const unauthReq = new Request("http://localhost/v1/models");
    const unauthResp = await worker.fetch(unauthReq, env, ctx);
    assert(unauthResp.status === 401, "GET /v1/models without token rejected with HTTP 401");

    // 3. Authentication enforcement (Invalid token)
    console.log("\nExecuting Test 3: Authentication enforcement (Invalid Bearer token)...");
    const invalidAuthReq = new Request("http://localhost/v1/models", {
        headers: { "Authorization": "Bearer wrong-key" }
    });
    const invalidAuthResp = await worker.fetch(invalidAuthReq, env, ctx);
    assert(invalidAuthResp.status === 401, "GET /v1/models with invalid token rejected with HTTP 401");

    // 4. CORS Preflight check
    console.log("\nExecuting Test 4: CORS preflight request...");
    const corsReq = new Request("http://localhost/v1/chat/completions", {
        method: "OPTIONS",
        headers: {
            "Origin": "http://example.com",
            "Access-Control-Request-Method": "POST"
        }
    });
    const corsResp = await worker.fetch(corsReq, env, ctx);
    assert(
        corsResp.status === 200 &&
        corsResp.headers.get("Access-Control-Allow-Origin") === "*" &&
        corsResp.headers.get("Access-Control-Allow-Methods")?.includes("POST"),
        "OPTIONS preflight returns valid CORS headers"
    );

    // 5. Dynamic model discovery endpoint (Google fetchAvailableModels + No Aliases in Discovery)
    console.log("\nExecuting Test 5: Dynamic model discovery from Google (verifying NO aliases)...");
    const modelsReq = new Request("http://localhost/v1/models", {
        headers: { "Authorization": `Bearer ${TEST_KEY}` }
    });
    const modelsResp = await worker.fetch(modelsReq, env, ctx);
    const modelsData = await modelsResp.json() as any;
    const modelIds: string[] = Array.isArray(modelsData.data) ? modelsData.data.map((m: any) => m.id) : [];

    assert(
        modelsResp.status === 200 &&
        modelIds.length > 0 &&
        modelIds.includes("gemini-2.5-flash"),
        `GET /v1/models returns ${modelIds.length} models including gemini-2.5-flash`
    );

    // CRITICAL REQUIREMENT: verify that client aliases are NOT present in discovery!
    const forbiddenAliases = ["claude-3-7-sonnet", "claude-3-5-sonnet", "dall-e-3", "flash", "opus", "sonnet", "pro"];
    const leakedAliases = modelIds.filter(id => forbiddenAliases.includes(id));
    assert(
        leakedAliases.length === 0,
        `GET /v1/models does NOT leak aliases (leaked: ${leakedAliases.join(", ") || "none"})`
    );

    // 6. Live Unary Chat Completion (Gemini 2.5 Flash)
    console.log("\nExecuting Test 6: Live Unary Chat Completion with Gemini 2.5 Flash...");
    const chatReq = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${TEST_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gemini-2.5-flash",
            messages: [
                { role: "system", content: "You are a concise technical test assistant." },
                { role: "user", content: "Respond with exactly the single word: OK" }
            ],
            temperature: 0.1,
            max_tokens: 30
        })
    });

    const chatResp = await worker.fetch(chatReq, env, ctx);
    assert(chatResp.status === 200, "POST /v1/chat/completions (unary) returned HTTP 200");
    const chatData = await chatResp.json() as any;
    const responseContent = chatData.choices?.[0]?.message?.content || "";
    assert(
        responseContent.length > 0 && chatData.usage?.total_tokens > 0,
        "Unary response contains content and valid usage metrics"
    );
    console.log(`   Model output snippet: ${responseContent.trim().replace(/\n/g, " ")}`);

    // 7. Live Unary Chat Completion with Thinking: OFF (reasoning_effort: "none")
    console.log("\nExecuting Test 7: Live Chat Completion with Thinking OFF (reasoning_effort: 'none')...");
    const thinkingOffReq = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${TEST_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gemini-2.5-flash",
            reasoning_effort: "none",
            messages: [
                { role: "user", content: "Say HELLO in one word." }
            ],
            temperature: 0.1,
            max_tokens: 30
        })
    });

    const thinkingOffResp = await worker.fetch(thinkingOffReq, env, ctx);
    assert(thinkingOffResp.status === 200, "Thinking OFF request accepted by Google and returned HTTP 200");
    const thinkingOffData = await thinkingOffResp.json() as any;
    const thinkingOffContent = thinkingOffData.choices?.[0]?.message?.content || "";
    assert(
        thinkingOffContent.length > 0,
        "Thinking OFF response contains valid output without errors"
    );
    console.log(`   Thinking OFF output snippet: ${thinkingOffContent.trim().replace(/\n/g, " ")}`);

    // 8. Streaming Chat Completion (SSE)
    console.log("\nExecuting Test 8: Live Streaming Chat Completion (SSE)...");
    const streamReq = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${TEST_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gemini-2.5-flash",
            stream: true,
            messages: [
                { role: "user", content: "Count from 1 to 3." }
            ]
        })
    });

    const streamResp = await worker.fetch(streamReq, env, ctx);
    assert(
        streamResp.status === 200 &&
        streamResp.headers.get("Content-Type")?.includes("text/event-stream"),
        "Streaming response returned HTTP 200 with text/event-stream Content-Type"
    );

    const reader = streamResp.body!.getReader();
    const decoder = new TextDecoder();
    let streamChunksCount = 0;
    let accumulatedContent = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split("\n")) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
                try {
                    const chunk = JSON.parse(line.substring(6));
                    const delta = chunk.choices[0]?.delta?.content || "";
                    accumulatedContent += delta;
                    streamChunksCount++;
                } catch {}
            }
        }
    }
    assert(streamChunksCount > 0, `Received ${streamChunksCount} SSE streaming chunks from Google`);

    // 9. Claude model alias routing (claude-3-7-sonnet -> claude-sonnet-5-5-high)
    console.log("\nExecuting Test 9: Claude model alias routing (claude-3-7-sonnet -> claude-sonnet-5-5-high)...");
    const claudeReq = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${TEST_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "claude-3-7-sonnet",
            messages: [
                { role: "user", content: "Reply with the word: PASS" }
            ],
            max_tokens: 30
        })
    });

    const claudeResp = await worker.fetch(claudeReq, env, ctx);
    assert(claudeResp.status === 200, "Claude routing returns HTTP 200 without signature validation error");
    const claudeData = await claudeResp.json() as any;
    assert(claudeData.choices?.[0]?.message?.content?.length > 0, "Claude response contains valid message payload");

    // 10. Multimodal Vision input (base64 1x1 PNG image)
    console.log("\nExecuting Test 10: Multimodal Vision input handling with Google...");
    const samplePngBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const visionReq = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${TEST_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gemini-2.5-flash",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "What color is this 1x1 image pixel?" },
                        { type: "image_url", image_url: { url: samplePngBase64 } }
                    ]
                }
            ],
            max_tokens: 30
        })
    });

    const visionResp = await worker.fetch(visionReq, env, ctx);
    assert(visionResp.status === 200, "Vision request accepted and processed successfully by Google");

    // 11. Client Error 404 Handling & Account Cooldown Protection (Fix for Review Bug #1)
    console.log("\nExecuting Test 11: Non-existent model returns 404 WITHOUT placing account on cooldown...");
    await worker.fetch(new Request("http://localhost/v1/accounts/reset", {
        method: "POST",
        headers: { "Authorization": `Bearer ${TEST_KEY}` }
    }), env, ctx);

    const notFoundReq = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${TEST_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "non-existent-gemini-model-xyz-9999",
            messages: [{ role: "user", content: "Hello" }]
        })
    });

    const notFoundResp = await worker.fetch(notFoundReq, env, ctx);
    assert(notFoundResp.status === 404, "Unknown model returns HTTP 404 Not Found");
    const notFoundData = await notFoundResp.json() as any;
    assert(
        notFoundData.error?.type === "invalid_request_error" &&
        notFoundData.error?.message?.includes("non-existent-gemini-model-xyz-9999"),
        "404 error contains descriptive invalid_request_error message"
    );

    // CRITICAL: Check account pool to ensure account was NOT placed on cooldown!
    const poolCheckReq = new Request("http://localhost/v1/accounts", {
        headers: { "Authorization": `Bearer ${TEST_KEY}` }
    });
    const poolCheckResp = await worker.fetch(poolCheckReq, env, ctx);
    const poolCheckData = await poolCheckResp.json() as any;
    const isAnyRateLimited = poolCheckData.accounts.some((a: any) => a.isRateLimited);
    assert(
        !isAnyRateLimited,
        "Account pool accounts are NOT rate-limited after a client 404 error"
    );

    // 12. Client Malformed JSON Handling (400)
    console.log("\nExecuting Test 12: Malformed JSON body handling (HTTP 400)...");
    const badJsonReq = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${TEST_KEY}`,
            "Content-Type": "application/json"
        },
        body: "{ broken json string"
    });
    const badJsonResp = await worker.fetch(badJsonReq, env, ctx);
    assert(badJsonResp.status === 400, "Malformed JSON returns HTTP 400 immediately");

    // 13. Account Pool Management and Cooldown Reset
    console.log("\nExecuting Test 13: Account Pool Status and Cooldown Reset API...");
    const accountsReq = new Request("http://localhost/v1/accounts", {
        headers: { "Authorization": `Bearer ${TEST_KEY}` }
    });
    const accountsResp = await worker.fetch(accountsReq, env, ctx);
    const accountsData = await accountsResp.json() as any;
    assert(
        accountsResp.status === 200 &&
        accountsData.totalAccounts > 0 &&
        accountsData.accounts[0].totalRequests >= 0,
        "GET /v1/accounts returns pool metrics and request statistics"
    );

    const resetReq = new Request("http://localhost/v1/accounts/reset", {
        method: "POST",
        headers: { "Authorization": `Bearer ${TEST_KEY}` }
    });
    const resetResp = await worker.fetch(resetReq, env, ctx);
    const resetData = await resetResp.json() as any;
    assert(resetResp.status === 200 && resetData.status === "ok", "POST /v1/accounts/reset resets cooldown timers");

    // 14. Live Function Calling / Tools (Google Gemini 2.5 Flash)
    console.log("\nExecuting Test 14: Live Function Calling / Tools with Gemini 2.5 Flash...");
    const weatherTool = {
        type: "function",
        function: {
            name: "get_current_weather",
            description: "Get the current weather for a given location",
            parameters: {
                type: "object",
                properties: {
                    location: {
                        type: "string",
                        description: "The city and state, e.g. Tokyo, Japan"
                    },
                    unit: {
                        type: "string",
                        enum: ["celsius", "fahrenheit"]
                    }
                },
                required: ["location"]
            }
        }
    };

    const toolCallReq = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${TEST_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gemini-2.5-flash",
            messages: [
                { role: "user", content: "What is the weather right now in Tokyo?" }
            ],
            tools: [weatherTool],
            tool_choice: "auto",
            temperature: 0.1
        })
    });

    const toolCallResp = await worker.fetch(toolCallReq, env, ctx);
    assert(toolCallResp.status === 200, "Tool calling request returned HTTP 200 OK");
    const toolCallData = await toolCallResp.json() as any;
    const choice = toolCallData.choices?.[0];
    assert(
        choice?.finish_reason === "tool_calls",
        `Unary response finish_reason is 'tool_calls' (got '${choice?.finish_reason}')`
    );
    const generatedToolCalls = choice?.message?.tool_calls;
    assert(
        Array.isArray(generatedToolCalls) && generatedToolCalls.length > 0,
        "Response contains valid OpenAI tool_calls array"
    );
    const firstCall = generatedToolCalls?.[0];
    assert(
        firstCall?.function?.name === "get_current_weather",
        `Model invoked 'get_current_weather' (got '${firstCall?.function?.name}')`
    );
    let parsedArgs: any = {};
    try {
        parsedArgs = JSON.parse(firstCall?.function?.arguments || "{}");
    } catch {}
    assert(
        typeof parsedArgs.location === "string" && parsedArgs.location.toLowerCase().includes("tokyo"),
        `Tool arguments contain location 'Tokyo': ${firstCall?.function?.arguments}`
    );

    // 15. Live Multi-turn Tool Response (with thoughtSignature validator bypass)
    console.log("\nExecuting Test 15: Multi-turn Tool Response with thoughtSignature bypass...");
    const multiTurnReq = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${TEST_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gemini-2.5-flash",
            messages: [
                { role: "user", content: "What is the weather right now in Tokyo?" },
                choice.message,
                {
                    role: "tool",
                    tool_call_id: firstCall.id,
                    name: firstCall.function.name,
                    content: JSON.stringify({ temperature: "22°C", condition: "Sunny", wind: "5 km/h" })
                }
            ],
            tools: [weatherTool]
        })
    });

    const multiTurnResp = await worker.fetch(multiTurnReq, env, ctx);
    assert(
        multiTurnResp.status === 200,
        "Multi-turn tool response accepted by Google with thoughtSignature bypass (HTTP 200)"
    );
    const multiTurnData = await multiTurnResp.json() as any;
    const multiTurnAnswer = multiTurnData.choices?.[0]?.message?.content || "";
    assert(
        multiTurnAnswer.length > 0 &&
        (multiTurnAnswer.includes("22") || multiTurnAnswer.toLowerCase().includes("sunny")),
        `Model synthesized tool result into final response: "${multiTurnAnswer.trim().substring(0, 100)}..."`
    );

    // 16. Live reasoning_content extraction
    console.log("\nExecuting Test 16: Live reasoning_content extraction (Gemini thinking)...");
    const thinkingReq = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${TEST_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gemini-2.5-flash",
            messages: [
                { role: "user", content: "Explain in 1 sentence why the sky is blue." }
            ],
            temperature: 0.7
        })
    });

    const thinkingResp = await worker.fetch(thinkingReq, env, ctx);
    assert(thinkingResp.status === 200, "Thinking completion returned HTTP 200 OK");
    const thinkingData = await thinkingResp.json() as any;
    const thinkingMessage = thinkingData.choices?.[0]?.message;
    assert(
        thinkingMessage?.content?.length > 0,
        "Response contains answer content"
    );
    // Gemini 2.5 returns thought parts by default on Google Cloud Code
    if (thinkingMessage?.reasoning_content) {
        assert(
            typeof thinkingMessage.reasoning_content === "string" && thinkingMessage.reasoning_content.length > 0,
            `reasoning_content populated correctly (${thinkingMessage.reasoning_content.length} chars)`
        );
    } else {
        console.log("   (Note: Model chose not to output separate thoughts for this prompt, but answer content is present)");
    }

    // Summary
    console.log("\n========================================================");
    console.log(`Live Google Tests Summary: ${totalPassed} / ${totalTests} assertions passed.`);
    console.log("========================================================\n");

    if (totalPassed !== totalTests) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error("Test execution encountered an unhandled exception:", err);
    process.exit(1);
});
