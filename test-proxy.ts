import worker from "./worker.ts";
import fs from "node:fs";

async function runTests() {
    console.log("Starting test suite for worker.ts...\n");

    if (!fs.existsSync("./accounts.json")) {
        console.error("Error: accounts.json file not found. Run 'npm run login' first.");
        process.exit(1);
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

    // 5. Model discovery endpoint
    console.log("\nExecuting Test 5: Dynamic model discovery endpoint...");
    const modelsReq = new Request("http://localhost/v1/models", {
        headers: { "Authorization": `Bearer ${TEST_KEY}` }
    });
    const modelsResp = await worker.fetch(modelsReq, env, ctx);
    const modelsData = await modelsResp.json() as any;
    const modelIds = Array.isArray(modelsData.data) ? modelsData.data.map((m: any) => m.id) : [];
    assert(
        modelsResp.status === 200 &&
        modelIds.length > 0 &&
        modelIds.includes("gemini-2.5-flash"),
        `GET /v1/models returns ${modelIds.length} models including gemini-2.5-flash`
    );

    // 6. Unary Chat Completion (Gemini 2.5 Flash)
    console.log("\nExecuting Test 6: Unary Chat Completion with Gemini 2.5 Flash...");
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

    // 7. Streaming Chat Completion (SSE)
    console.log("\nExecuting Test 7: Streaming Chat Completion (SSE)...");
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
    assert(streamChunksCount > 0, `Received ${streamChunksCount} SSE streaming chunks`);

    // 8. Claude model routing and thought signature handling
    console.log("\nExecuting Test 8: Claude model alias routing (claude-3-7-sonnet -> claude-sonnet-4-6)...");
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

    // 9. Multimodal Vision input (base64 1x1 PNG image)
    console.log("\nExecuting Test 9: Multimodal Vision input handling...");
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
    assert(visionResp.status === 200, "Vision request accepted and processed successfully");

    // 10. Account Pool Management and Cooldown Reset
    console.log("\nExecuting Test 10: Account Pool Status and Cooldown Reset API...");
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

    // Summary
    console.log("\n========================================================");
    console.log(`Test Execution Summary: ${totalPassed} / ${totalTests} assertions passed.`);
    console.log("========================================================\n");

    if (totalPassed !== totalTests) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error("Test execution encountered an unhandled exception:", err);
    process.exit(1);
});
