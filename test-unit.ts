import {
    resolveModelInfo,
    transformOpenAiRequest,
    mapUnaryResponse,
    streamToOpenAi,
    extractUpstreamMessage,
    DEFAULT_MODELS,
    MODELS_CACHE_KEY
} from "./worker.ts";
import worker from "./worker.ts";

let totalPassed = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, details?: any) {
    totalTests++;
    if (condition) {
        totalPassed++;
        console.log(`[PASS] Test ${totalTests}: ${testName}`);
    } else {
        console.error(`[FAIL] Test ${totalTests}: ${testName}`, details !== undefined ? details : "");
        process.exitCode = 1;
    }
}

async function runUnitTests() {
    console.log("========================================================");
    console.log("  Running Unit Tests for Antigravity Proxy (Pure Logic)");
    console.log("========================================================\n");

    // ---------------------------------------------------------
    // GROUP 1: resolveModelInfo & Alias Routing & Suffix Handling
    // ---------------------------------------------------------
    console.log("--- Group 1: Model Resolution & Suffix Handling ---");

    // 1.1 Claude Aliases & 5.5 Mapping
    const claude1 = resolveModelInfo("claude-3-7-sonnet");
    assert(claude1.upstreamModel === "claude-sonnet-5-5-high", "Alias claude-3-7-sonnet maps to claude-sonnet-5-5-high");

    const claude2 = resolveModelInfo("claude-3-5-sonnet");
    assert(claude2.upstreamModel === "claude-sonnet-5-5-high", "Alias claude-3-5-sonnet maps to claude-sonnet-5-5-high");

    const claude3 = resolveModelInfo("opus");
    assert(claude3.upstreamModel === "claude-opus-5-5-high", "Alias opus maps to claude-opus-5-5-high");

    const claude4 = resolveModelInfo("claude-sonnet-5-5");
    assert(claude4.upstreamModel === "claude-sonnet-5-5-high", "claude-sonnet-5-5 maps to claude-sonnet-5-5-high");

    const claude5 = resolveModelInfo("claude-sonnet-5.5");
    assert(claude5.upstreamModel === "claude-sonnet-5-5-high", "claude-sonnet-5.5 maps to claude-sonnet-5-5-high");

    const claude6 = resolveModelInfo("sonnet-5.5");
    assert(claude6.upstreamModel === "claude-sonnet-5-5-high", "sonnet-5.5 maps to claude-sonnet-5-5-high");

    const claude7 = resolveModelInfo("claude");
    assert(claude7.upstreamModel === "claude-sonnet-5-5-high", "Alias claude maps to claude-sonnet-5-5-high");

    const claude8 = resolveModelInfo("sonnet");
    assert(claude8.upstreamModel === "claude-sonnet-5-5-high", "Alias sonnet maps to claude-sonnet-5-5-high");

    const claudeLow = resolveModelInfo("claude-sonnet-5-5", "low");
    assert(claudeLow.upstreamModel === "claude-sonnet-5-5-low", "claude-sonnet-5-5 with reasoning_effort 'low' maps to claude-sonnet-5-5-low");

    const claudeMedExact = resolveModelInfo("claude-sonnet-5-5-medium");
    assert(claudeMedExact.upstreamModel === "claude-sonnet-5-5-medium", "Exact claude-sonnet-5-5-medium is preserved");

    const opusLowExact = resolveModelInfo("claude-opus-5-5-low");
    assert(opusLowExact.upstreamModel === "claude-opus-5-5-low", "Exact claude-opus-5-5-low is preserved");

    // 1.2 Gemini Aliases
    const gemini1 = resolveModelInfo("flash");
    assert(gemini1.upstreamModel === "gemini-3.8-flash-tiered", "Alias flash maps to gemini-3.8-flash-tiered");

    const gemini2 = resolveModelInfo("pro");
    assert(gemini2.upstreamModel === "gemini-2.5-pro", "Alias pro maps to gemini-2.5-pro");

    // 1.3 Exact Model Suffix Preservation (Fix for Bug #9)
    const gptOss = resolveModelInfo("gpt-oss-120b-medium");
    assert(gptOss.upstreamModel === "gpt-oss-120b-medium", "Exact model gpt-oss-120b-medium does NOT lose -medium suffix");

    const proHigh = resolveModelInfo("gemini-3.1-pro-high");
    assert(proHigh.upstreamModel === "gemini-3.1-pro-high", "Exact model gemini-3.1-pro-high does NOT lose -high suffix");

    const g3Flash = resolveModelInfo("gemini-3-flash");
    assert(g3Flash.upstreamModel === "gemini-3-flash" && g3Flash.isGemini3 === true, "gemini-3-flash preserves model ID and is recognized as Gemini 3");

    const aliasWithTier = resolveModelInfo("flash-high");
    assert(aliasWithTier.upstreamModel === "gemini-3.8-flash-tiered" && aliasWithTier.thinkingLevel === "HIGH", "flash-high resolves to gemini-3.8-flash-tiered with HIGH tier");

    // 1.4 Image Generation Aliases
    const img1 = resolveModelInfo("dall-e-3");
    assert(img1.upstreamModel === "gemini-3.1-flash-image", "Alias dall-e-3 maps to gemini-3.1-flash-image");

    const img2 = resolveModelInfo("draw-a-cat");
    assert(img2.upstreamModel === "gemini-3.1-flash-image", "Alias with 'draw' maps to gemini-3.1-flash-image");

    // 1.5 Reasoning Effort & Thinking Levels
    const thNone = resolveModelInfo("gemini-2.5-flash", "none");
    assert(thNone.thinkingLevel === "NONE", "reasoning_effort: 'none' sets thinkingLevel to NONE");

    const thOff = resolveModelInfo("gemini-2.5-flash", "off");
    assert(thOff.thinkingLevel === "NONE", "reasoning_effort: 'off' sets thinkingLevel to NONE");

    const thOverride = resolveModelInfo("gemini-3.1-pro-high", "none");
    assert(thOverride.thinkingLevel === "NONE", "reasoning_effort: 'none' overrides -high suffix to NONE");

    const thLow = resolveModelInfo("gemini-2.5-flash", "low");
    assert(thLow.thinkingLevel === "LOW", "reasoning_effort: 'low' sets thinkingLevel to LOW");

    const thMed = resolveModelInfo("gemini-2.5-flash", "medium");
    assert(thMed.thinkingLevel === "MEDIUM", "reasoning_effort: 'medium' sets thinkingLevel to MEDIUM");

    const thHigh = resolveModelInfo("gemini-2.5-flash", "high");
    assert(thHigh.thinkingLevel === "HIGH", "reasoning_effort: 'high' sets thinkingLevel to HIGH");

    const thDefault = resolveModelInfo("gemini-2.5-flash");
    assert(thDefault.thinkingLevel === "HIGH", "Default reasoning effort resolves to HIGH");

    // ---------------------------------------------------------
    // GROUP 2: DEFAULT_MODELS Discovery & Discovery Cache Key
    // ---------------------------------------------------------
    console.log("\n--- Group 2: Discovery Sanity & Cache Key ---");

    const forbiddenAliases = ["claude-3-7-sonnet", "claude-3-5-sonnet", "dall-e-3", "flash", "opus", "sonnet", "pro", "claude"];
    const foundAliases = DEFAULT_MODELS.filter(m => forbiddenAliases.includes(m));
    assert(foundAliases.length === 0, "DEFAULT_MODELS contains NO aliases (found: " + foundAliases.join(", ") + ")");

    assert(DEFAULT_MODELS.includes("gemini-2.5-flash"), "DEFAULT_MODELS contains real gemini-2.5-flash");
    assert(DEFAULT_MODELS.includes("claude-sonnet-5-5-high"), "DEFAULT_MODELS contains real claude-sonnet-5-5-high");
    assert(DEFAULT_MODELS.includes("claude-opus-5-5-high"), "DEFAULT_MODELS contains real claude-opus-5-5-high");
    assert(DEFAULT_MODELS.includes("gemini-3.1-flash-image"), "DEFAULT_MODELS contains real gemini-3.1-flash-image");
    assert(MODELS_CACHE_KEY === "discovered_models_v3", "MODELS_CACHE_KEY is updated to discovered_models_v3 to bypass stale KV");

    // ---------------------------------------------------------
    // GROUP 3: transformOpenAiRequest Transformer & Tools
    // ---------------------------------------------------------
    console.log("\n--- Group 3: OpenAI -> Google Payload Transformer & Tools ---");

    // 3.1 Thinking OFF on Gemini 3
    const g3Info = resolveModelInfo("gemini-3.8-flash-tiered", "none");
    const g3Transformed = await transformOpenAiRequest({
        messages: [{ role: "user", content: "Hello" }]
    }, g3Info);
    assert(
        g3Transformed.generationConfig?.thinkingConfig?.includeThoughts === false &&
        g3Transformed.generationConfig?.thinkingConfig?.thinkingLevel === "LOW",
        "Gemini 3 with thinking NONE produces includeThoughts=false, thinkingLevel=LOW"
    );

    // 3.2 Thinking OFF on Gemini 2.5 Flash (omitted to avoid Google 400)
    const g25Info = resolveModelInfo("gemini-2.5-flash", "none");
    const g25Transformed = await transformOpenAiRequest({
        messages: [{ role: "user", content: "Hello" }]
    }, g25Info);
    assert(
        g25Transformed.generationConfig?.thinkingConfig === undefined,
        "Gemini 2.5 Flash with thinking NONE omits thinkingConfig completely (to avoid Google 400)"
    );

    // 3.3 Thinking ON (HIGH) on Gemini 2.5 Pro
    const g25ProInfo = resolveModelInfo("gemini-2.5-pro", "high");
    const g25ProTransformed = await transformOpenAiRequest({
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1000
    }, g25ProInfo);
    assert(
        g25ProTransformed.generationConfig?.thinkingConfig?.includeThoughts === true &&
        g25ProTransformed.generationConfig?.thinkingConfig?.thinkingBudget === 24576,
        "Gemini 2.5 Pro with thinking HIGH sets thinkingBudget=24576"
    );
    assert(
        g25ProTransformed.generationConfig?.maxOutputTokens > 24576,
        "maxOutputTokens expanded when smaller than thinkingBudget"
    );

    // 3.4 Tools / Function Calling Declarations & tool_choice
    const toolsPayload = await transformOpenAiRequest({
        messages: [{ role: "user", content: "Check weather in Berlin" }],
        tools: [{
            type: "function",
            function: {
                name: "get_weather",
                description: "Get weather for city",
                parameters: {
                    type: "object",
                    properties: { location: { type: "string" } },
                    required: ["location"]
                }
            }
        }],
        tool_choice: "auto"
    }, resolveModelInfo("gemini-2.5-flash"));

    const fnDecls = toolsPayload.tools?.[0]?.functionDeclarations;
    assert(
        Array.isArray(fnDecls) && fnDecls[0]?.name === "get_weather",
        "tools correctly transformed into Google functionDeclarations"
    );
    assert(
        toolsPayload.toolConfig?.functionCallingConfig?.mode === "AUTO",
        "tool_choice 'auto' correctly transformed into functionCallingConfig mode AUTO"
    );

    // 3.5 Multi-turn Tool Call & Tool Response with Thought Signature
    const multiTurnPayload = await transformOpenAiRequest({
        messages: [
            { role: "user", content: "What is the weather?" },
            {
                role: "assistant",
                content: null,
                tool_calls: [{
                    id: "call_abc123",
                    type: "function",
                    function: { name: "get_weather", arguments: "{\"location\":\"Berlin\"}" }
                }]
            },
            {
                role: "tool",
                tool_call_id: "call_abc123",
                content: "{\"temperature\":\"18C\"}"
            }
        ]
    }, resolveModelInfo("gemini-2.5-flash"));

    const modelTurn = multiTurnPayload.contents?.[1];
    const userTurn = multiTurnPayload.contents?.[2];

    assert(
        modelTurn?.role === "model" &&
        modelTurn?.parts?.[0]?.thoughtSignature === "skip_thought_signature_validator" &&
        modelTurn?.parts?.[0]?.functionCall?.name === "get_weather" &&
        modelTurn?.parts?.[0]?.functionCall?.args?.location === "Berlin",
        "Assistant tool_calls mapped to functionCall with thoughtSignature"
    );

    assert(
        userTurn?.role === "user" &&
        userTurn?.parts?.[0]?.functionResponse?.name === "get_weather" &&
        userTurn?.parts?.[0]?.functionResponse?.response?.content?.temperature === "18C",
        "Tool response mapped to user functionResponse with matching function name"
    );

    // 3.6 Stripping <think>...</think> from previous assistant messages
    const strippedPayload = await transformOpenAiRequest({
        messages: [
            { role: "user", content: "Q1" },
            { role: "assistant", content: "<think>internal thoughts</think>Final answer" },
            { role: "user", content: "Q2" }
        ]
    }, resolveModelInfo("gemini-2.5-flash"));
    const assistantContent = strippedPayload.contents?.[1]?.parts?.[0]?.text;
    assert(
        assistantContent === "Final answer",
        "<think> tags stripped from previous assistant history"
    );

    // 3.7 Multimodal Image Base64 Data URL Parsing
    const samplePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const visionTransformed = await transformOpenAiRequest({
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: "Look at this" },
                    { type: "image_url", image_url: { url: samplePng } }
                ]
            }
        ]
    }, resolveModelInfo("gemini-2.5-flash"));
    const visionParts = visionTransformed.contents?.[0]?.parts || [];
    assert(
        visionParts.length === 2 &&
        visionParts[1]?.inlineData?.mimeType === "image/png" &&
        visionParts[1]?.inlineData?.data?.length > 10,
        "Multimodal base64 image converted to inlineData with correct mimeType"
    );

    // ---------------------------------------------------------
    // GROUP 4: mapUnaryResponse Transformer
    // ---------------------------------------------------------
    console.log("\n--- Group 4: Google -> OpenAI Response Mapper ---");

    const sampleGoogleResp = {
        response: {
            candidates: [
                {
                    content: {
                        parts: [
                            { text: "Thinking step 1", thought: true },
                            { text: "Actual answer text." }
                        ]
                    },
                    finishReason: "STOP"
                }
            ],
            usageMetadata: {
                promptTokenCount: 15,
                candidatesTokenCount: 25,
                totalTokenCount: 40
            }
        }
    };

    const mapped = mapUnaryResponse(sampleGoogleResp, "gemini-2.5-flash");
    assert(mapped.object === "chat.completion", "Mapped response object is chat.completion");
    assert(mapped.choices?.[0]?.message?.reasoning_content === "Thinking step 1", "Thoughts mapped to message.reasoning_content");
    assert(mapped.choices?.[0]?.message?.content === "Actual answer text.", "Answer mapped cleanly to message.content");
    assert(mapped.choices?.[0]?.finish_reason === "stop", "finishReason STOP mapped to stop");
    assert(mapped.usage?.prompt_tokens === 15 && mapped.usage?.total_tokens === 40, "Usage metadata mapped accurately");

    // 4.2 Tool calls in Unary response
    const toolGoogleResp = {
        response: {
            candidates: [
                {
                    content: {
                        parts: [
                            {
                                functionCall: {
                                    name: "get_weather",
                                    args: { location: "Tokyo" },
                                    id: "call_tokyo_123"
                                }
                            }
                        ]
                    },
                    finishReason: "STOP"
                }
            ]
        }
    };
    const mappedTool = mapUnaryResponse(toolGoogleResp, "gemini-2.5-flash");
    assert(
        mappedTool.choices?.[0]?.finish_reason === "tool_calls" &&
        mappedTool.choices?.[0]?.message?.tool_calls?.[0]?.function?.name === "get_weather" &&
        mappedTool.choices?.[0]?.message?.content === null,
        "Google functionCall mapped to OpenAI message.tool_calls with finish_reason tool_calls"
    );

    // 4.3 Max Tokens finish reason
    const maxTokenResp = {
        response: {
            candidates: [{ content: { parts: [{ text: "Truncated..." }] }, finishReason: "MAX_TOKENS" }]
        }
    };
    const mappedMax = mapUnaryResponse(maxTokenResp, "gemini-2.5-flash");
    assert(mappedMax.choices?.[0]?.finish_reason === "length", "finishReason MAX_TOKENS mapped to length");

    // ---------------------------------------------------------
    // GROUP 5: Upstream Error Message Extraction
    // ---------------------------------------------------------
    console.log("\n--- Group 5: Upstream Error Parser ---");

    const jsonError = JSON.stringify([{ error: { message: "Requested model not supported" } }]);
    assert(extractUpstreamMessage(jsonError) === "Requested model not supported", "Extracts error message from JSON array");

    const jsonObjectError = JSON.stringify({ error: { message: "Quota exceeded" } });
    assert(extractUpstreamMessage(jsonObjectError) === "Quota exceeded", "Extracts error message from JSON object");

    const rawError = "502 Bad Gateway from cloudcode proxy";
    assert(extractUpstreamMessage(rawError) === rawError, "Returns raw text if not JSON");

    // ---------------------------------------------------------
    // GROUP 6: Request Body Validation (No Cooldown Bug #1 Check)
    // ---------------------------------------------------------
    console.log("\n--- Group 6: Request Validation in Worker ---");

    const dummyEnv: any = {
        PROXY_API_KEY: "test-secret",
        ACCOUNTS: JSON.stringify([{
            email: "test@example.com",
            refresh_token: "dummy",
            project_id: "test-proj"
        }])
    };
    const dummyCtx: any = { waitUntil: () => {}, passThroughOnException: () => {} };

    // 6.1 Malformed JSON in body
    const malformedReq = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": "Bearer test-secret",
            "Content-Type": "application/json"
        },
        body: "{ bad json invalid"
    });
    const malformedResp = await worker.fetch(malformedReq, dummyEnv, dummyCtx);
    assert(malformedResp.status === 400, "Malformed JSON body returns HTTP 400 immediately");
    const malformedData = await malformedResp.json() as any;
    assert(malformedData.error?.type === "invalid_request_error", "Returns invalid_request_error type on malformed body");

    // 6.2 Non-object body
    const nonObjectReq = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": "Bearer test-secret",
            "Content-Type": "application/json"
        },
        body: JSON.stringify("string instead of object")
    });
    const nonObjectResp = await worker.fetch(nonObjectReq, dummyEnv, dummyCtx);
    assert(nonObjectResp.status === 400, "Non-object body returns HTTP 400 immediately");

    // ---------------------------------------------------------
    // GROUP 7: Streaming SSE Parser (streamToOpenAi)
    // ---------------------------------------------------------
    console.log("\n--- Group 7: SSE Stream Transformer & Tool Streaming ---");

    const fakeGoogleSseData = [
        `data: {"response":{"candidates":[{"content":{"parts":[{"text":"Thinking...","thought":true}]}}]}}\n\n`,
        `data: {"response":{"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_weather","args":{"city":"Oslo"}}}]}}]}}\n\n`,
        `data: [DONE]\n\n`
    ].join("");

    const mockResponse = new Response(new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(fakeGoogleSseData));
            controller.close();
        }
    }), {
        headers: { "Content-Type": "text/event-stream" }
    });

    const sseOpenAiResp = streamToOpenAi(mockResponse, "gemini-2.5-flash", false);
    assert(sseOpenAiResp.headers.get("Content-Type")?.includes("text/event-stream"), "SSE Response has text/event-stream Content-Type");

    const sseReader = sseOpenAiResp.body!.getReader();
    const sseDecoder = new TextDecoder();
    let sseAccumulated = "";
    while (true) {
        const { done, value } = await sseReader.read();
        if (done) break;
        sseAccumulated += sseDecoder.decode(value, { stream: true });
    }

    assert(sseAccumulated.includes("chat.completion.chunk"), "SSE output contains chat.completion.chunk objects");
    assert(sseAccumulated.includes("reasoning_content"), "SSE output streams reasoning_content field");
    assert(sseAccumulated.includes("tool_calls") && sseAccumulated.includes("get_weather"), "SSE output streams tool_calls");
    assert(sseAccumulated.includes("data: [DONE]"), "SSE output terminates with data: [DONE]");

    // ---------------------------------------------------------
    // SUMMARY
    // ---------------------------------------------------------
    console.log("\n========================================================");
    console.log(`Unit Test Summary: ${totalPassed} / ${totalTests} assertions passed.`);
    console.log("========================================================\n");

    if (totalPassed !== totalTests) {
        process.exit(1);
    }
}

runUnitTests().catch(err => {
    console.error("Fatal error in unit tests:", err);
    process.exit(1);
});
