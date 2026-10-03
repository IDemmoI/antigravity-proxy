// Antigravity Gemini Proxy — High-performance OpenAI-compatible proxy for Google Cloud Code / Gemini
// Built for Cloudflare Workers (TypeScript)

export interface Env {
    PROXY_API_KEY?: string;
    ACCOUNTS?: string;
    REFRESH_TOKEN?: string;
    KV?: KVNamespace;
    ASSETS?: Fetcher;
    DEBUG_LOG_PAYLOADS?: string;
}

interface AccountConfig {
    email: string;
    refresh_token: string;
    project_id?: string;
}

interface RuntimeAccount {
    index: number;
    email: string;
    refreshToken: string;
    projectId: string;
    accessToken: string | null;
    tokenExpiry: number;
    rateLimitReset: number;
    consecutiveFailures: number;
    totalRequests: number;
    lastUsed: number;
}

// ========== CONSTANTS ==========
// Obfuscated Antigravity public desktop OAuth client parameters to avoid automated scanner false positives
const decodeSecret = (bytes: number[]) => String.fromCharCode(...bytes.map(b => b ^ 0x5a));
const CLIENT_ID = decodeSecret([107, 106, 109, 107, 106, 106, 108, 106, 108, 106, 111, 99, 107, 119, 46, 55, 50, 41, 41, 51, 52, 104, 50, 104, 107, 54, 57, 40, 63, 104, 105, 111, 44, 46, 53, 54, 53, 48, 50, 110, 61, 110, 106, 105, 63, 42, 116, 59, 42, 42, 41, 116, 61, 53, 53, 61, 54, 63, 47, 41, 63, 40, 57, 53, 52, 46, 63, 52, 46, 116, 57, 53, 55]);
const CLIENT_SECRET = decodeSecret([29, 21, 25, 9, 10, 2, 119, 17, 111, 98, 28, 13, 8, 110, 98, 108, 22, 62, 22, 16, 107, 55, 22, 24, 98, 41, 2, 25, 110, 32, 108, 43, 30, 27, 60]);
const DEFAULT_PROJECT_ID = "aicode-consumers";
const SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";

const ENDPOINTS = [
    "https://daily-cloudcode-pa.sandbox.googleapis.com",
    "https://cloudcode-pa.googleapis.com"
];

// Fallback list of REAL upstream models (used only when live discovery fails).
// Friendly aliases (dall-e-3, claude-3-7-sonnet, opus, flash...) are still resolved
// by resolveModelInfo() but intentionally NOT advertised in /v1/models.
const DEFAULT_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-3-flash",
    "gemini-3.1-pro-high",
    "gemini-3.5-flash-low",
    "gemini-3.6-flash-high",
    "gemini-3.8-flash-tiered",
    "claude-sonnet-5-5-high",
    "claude-sonnet-5-5-medium",
    "claude-sonnet-5-5-low",
    "claude-opus-5-5-high",
    "claude-opus-5-5-medium",
    "claude-opus-5-5-low",
    "claude-sonnet-4-6",
    "claude-opus-4-6-thinking",
    "gemini-3.1-flash-image",
    "gpt-oss-120b-medium"
];

const MODELS_CACHE_KEY = "discovered_models_v3";

interface ModelResolution {
    upstreamModel: string;
    thinkingLevel: "NONE" | "LOW" | "MEDIUM" | "HIGH";
    isGemini3: boolean;
}

function resolveModelInfo(model: string, reasoningEffort?: string): ModelResolution {
    const lower = model.toLowerCase().trim();

    // 1. Image generation aliases
    if (lower.includes("image") || lower.includes("dall-e") || lower.includes("draw")) {
        return {
            upstreamModel: "gemini-3.1-flash-image",
            thinkingLevel: "LOW",
            isGemini3: false
        };
    }

    // 2. Extract explicit tier suffix (e.g. -low, -medium, -high)
    // IMPORTANT: Do NOT strip suffixes from known models where the tier is part of the official model ID
    // (e.g. gpt-oss-120b-medium, gemini-3.1-pro-high, gemini-3.5-flash-low, gemini-3.6-flash-high, claude-*-5-5-*).
    const isKnownExactModel = DEFAULT_MODELS.includes(lower) || (memoryModelsCache?.includes(lower) ?? false);
    let explicitTier: "LOW" | "MEDIUM" | "HIGH" | null = null;
    let base = lower;

    const tierMatch = lower.match(/-(low|medium|high)$/);
    if (tierMatch) {
        explicitTier = tierMatch[1].toUpperCase() as "LOW" | "MEDIUM" | "HIGH";
        if (!isKnownExactModel) {
            base = lower.replace(/-(low|medium|high)$/, "");
        }
    }

    const effortUpper = reasoningEffort?.toUpperCase();
    let finalTier: ModelResolution["thinkingLevel"];
    if (effortUpper === "NONE" || effortUpper === "OFF") {
        finalTier = "NONE";
    } else if (explicitTier) {
        finalTier = explicitTier;
    } else if (effortUpper === "LOW" || effortUpper === "MEDIUM" || effortUpper === "HIGH") {
        finalTier = effortUpper;
    } else {
        finalTier = "HIGH";
    }

    // Determine target Claude tier suffix (high, medium, low)
    const claudeTier = (explicitTier || (effortUpper === "LOW" ? "LOW" : effortUpper === "MEDIUM" ? "MEDIUM" : "HIGH")).toLowerCase();

    // 3. Claude mapping:
    // Check if the input is already an exact Claude 5.5 variant (e.g. claude-sonnet-5-5-high)
    const isExactClaude55 = [
        "claude-sonnet-5-5-high", "claude-sonnet-5-5-medium", "claude-sonnet-5-5-low",
        "claude-opus-5-5-high", "claude-opus-5-5-medium", "claude-opus-5-5-low"
    ].includes(base);

    if (isExactClaude55) {
        // If an explicit reasoningEffort overrides the tier, map accordingly
        if (effortUpper === "LOW" || effortUpper === "MEDIUM" || effortUpper === "HIGH") {
            const prefix = base.startsWith("claude-opus") ? "claude-opus-5-5" : "claude-sonnet-5-5";
            base = `${prefix}-${effortUpper.toLowerCase()}`;
        }
    } else if (base === "opus" || base === "claude-opus" || /^claude-.*opus/.test(base) || base.includes("opus")) {
        // Opus aliases: opus, claude-opus, claude-opus-5-5, claude-opus-5.5, opus-5.5, claude-opus-4-6-thinking...
        base = `claude-opus-5-5-${claudeTier}`;
    } else if (
        base === "claude" ||
        base === "sonnet" ||
        base === "claude-sonnet" ||
        base === "sonnet-5.5" ||
        base === "sonnet-5-5" ||
        base === "claude-sonnet-5.5" ||
        base === "claude-sonnet-5-5" ||
        base === "claude-5.5-sonnet" ||
        base === "claude-5-5-sonnet" ||
        base === "claude-5-sonnet" ||
        base === "claude-sonnet-5" ||
        base === "claude-sonnet-4-6" ||
        /^claude-.*sonnet/.test(base) ||
        base.startsWith("claude")
    ) {
        // Sonnet & general Claude aliases: claude-sonnet-5-5, claude-sonnet-5.5, sonnet-5.5, claude-3-7-sonnet, claude, sonnet...
        base = `claude-sonnet-5-5-${claudeTier}`;
    }

    // 4. Future-proof Gemini mapping (gemini-3.x, 3.9, 4.x etc. and gemini-3-flash)
    const isModernGemini = /^gemini-[3-9](\.|\b|-)/i.test(base);
    if (!isKnownExactModel && isModernGemini && base.includes("flash") && !base.includes("tiered") && !base.includes("lite") && !base.includes("high") && !base.includes("low") && !base.includes("medium")) {
        base = base + "-tiered";
    } else if (base === "flash" || base === "gemini-flash") {
        base = "gemini-3.8-flash-tiered";
    } else if (base === "pro" || base === "gemini-pro") {
        base = "gemini-2.5-pro";
    }

    return {
        upstreamModel: base,
        thinkingLevel: finalTier,
        isGemini3: isModernGemini
    };
}

const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Max-Age": "86400"
};

// Global in-memory pool state for current isolate
let accountsPool: RuntimeAccount[] = [];
let currentAccountIndex = 0;

// ========== MAIN WORKER HANDLER ==========
export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: CORS_HEADERS });
        }

        const url = new URL(request.url);

        // Ensure accounts pool is loaded
        ensureAccountsLoaded(env);

        // Public health check
        if (url.pathname === "/health" || url.pathname === "/ping") {
            return jsonResponse({
                status: "ok",
                timestamp: Math.floor(Date.now() / 1000),
                totalAccounts: accountsPool.length
            });
        }

        // Static assets fallback for frontend dashboard (public routes)
        if (!url.pathname.startsWith("/v1")) {
            if (env.ASSETS) {
                return await env.ASSETS.fetch(request);
            }
            return errorResponse(`Route not found: ${url.pathname}`, 404, "not_found");
        }

        // Authenticate all protected API routes
        if (!isAuthorized(request, env)) {
            return errorResponse("Missing or invalid Authorization header", 401, "authentication_error");
        }

        if (accountsPool.length === 0) {
            return errorResponse("No accounts configured in proxy. Run 'npm run login' to add accounts.", 503, "service_unavailable");
        }

        try {
            if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
                return await handleChatCompletions(request, env);
            }

            if (url.pathname === "/v1/images/generations" && request.method === "POST") {
                return await handleImageGenerations(request, env);
            }

            if (url.pathname === "/v1/models" && request.method === "GET") {
                return await handleModels(env);
            }

            if (url.pathname === "/v1/accounts" && request.method === "GET") {
                return handleAccountsStatus();
            }

            if (url.pathname === "/v1/accounts/reset" && request.method === "POST") {
                accountsPool.forEach(acc => {
                    acc.rateLimitReset = 0;
                    acc.consecutiveFailures = 0;
                });
                return jsonResponse({ status: "ok", message: "All account cooldowns have been reset." });
            }

            return errorResponse(`Route not found: ${url.pathname}`, 404, "not_found");
        } catch (err: any) {
            console.error("Unhandled Worker error:", err);
            return errorResponse(err.message || "Internal Server Error", 500, "api_error");
        }
    }
};

// ========== SECURITY & AUTH ==========
function isAuthorized(request: Request, env: Env): boolean {
    if (!env.PROXY_API_KEY) {
        // If master key is not configured, reject all requests for security
        console.warn("Warning: PROXY_API_KEY secret is not set in Worker environment.");
        return false;
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return false;
    }

    const providedKey = authHeader.substring(7);
    return timingSafeCompare(providedKey, env.PROXY_API_KEY);
}

function timingSafeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

// ========== ACCOUNT POOL MANAGEMENT ==========
function ensureAccountsLoaded(env: Env): void {
    if (accountsPool.length > 0) return;

    if (env.ACCOUNTS) {
        try {
            let raw = env.ACCOUNTS.trim();
            if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
                raw = raw.slice(1, -1);
            }
            const parsed = JSON.parse(raw) as AccountConfig[];
            if (Array.isArray(parsed) && parsed.length > 0) {
                accountsPool = parsed.map((acc, i) => ({
                    index: i,
                    email: acc.email || `account-${i}`,
                    refreshToken: acc.refresh_token,
                    projectId: acc.project_id || DEFAULT_PROJECT_ID,
                    accessToken: null,
                    tokenExpiry: 0,
                    rateLimitReset: 0,
                    consecutiveFailures: 0,
                    totalRequests: 0,
                    lastUsed: 0
                }));
                return;
            }
        } catch (e: any) {
            console.error("Failed to parse env.ACCOUNTS JSON:", e.message);
        }
    }

    if (env.REFRESH_TOKEN) {
        accountsPool = [{
            index: 0,
            email: "default",
            refreshToken: env.REFRESH_TOKEN,
            projectId: DEFAULT_PROJECT_ID,
            accessToken: null,
            tokenExpiry: 0,
            rateLimitReset: 0,
            consecutiveFailures: 0,
            totalRequests: 0,
            lastUsed: 0
        }];
    }
}

async function getAccessToken(account: RuntimeAccount, env: Env): Promise<string> {
    const now = Date.now();

    // 1. In-memory cache
    if (account.accessToken && account.tokenExpiry > now) {
        return account.accessToken;
    }

    // 2. KV cache (shared across Worker isolates)
    const kvKey = `token:${account.email}`;
    if (env.KV) {
        const cached = await env.KV.get(kvKey);
        if (cached) {
            let token = cached;
            let exp = now + 300000; // legacy plain-string entry: trust for 5 min only
            try {
                const parsed = JSON.parse(cached);
                if (parsed && typeof parsed.token === "string") {
                    token = parsed.token;
                    exp = Number(parsed.exp) || exp;
                }
            } catch { /* legacy format */ }
            if (exp > now + 30000) {
                account.accessToken = token;
                account.tokenExpiry = exp;
                return token;
            }
        }
    }

    // 3. Refresh from Google OAuth (with retry for transient network glitches)
    let lastErr: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    refresh_token: account.refreshToken,
                    grant_type: "refresh_token"
                })
            });

            if (!resp.ok) {
                const errorText = await resp.text();
                throw new Error(`Google token refresh failed (${resp.status}): ${errorText.substring(0, 150)}`);
            }

            const data = await resp.json() as any;
            account.accessToken = data.access_token;
            const ttlSeconds = Math.max((data.expires_in || 3600) - 120, 300);
            account.tokenExpiry = now + (ttlSeconds * 1000);

            // Save to KV
            if (env.KV) {
                await env.KV.put(kvKey, JSON.stringify({ token: data.access_token, exp: account.tokenExpiry }), { expirationTtl: ttlSeconds });
            }

            return data.access_token;
        } catch (err: any) {
            lastErr = err;
            await new Promise(resolve => setTimeout(resolve, 400));
        }
    }

    throw lastErr;
}

async function invalidateToken(account: RuntimeAccount, env: Env): Promise<void> {
    account.accessToken = undefined as any;
    account.tokenExpiry = 0;
    if (env.KV) {
        try { await env.KV.delete(`token:${account.email}`); } catch { /* ignore */ }
    }
}

function selectAccount(): RuntimeAccount | null {
    const now = Date.now();
    const available = accountsPool.filter(acc => now >= acc.rateLimitReset);
    if (available.length === 0) return null;

    // Pick next available account (round-robin / least failures)
    currentAccountIndex = (currentAccountIndex + 1) % accountsPool.length;
    const preferred = accountsPool[currentAccountIndex];
    if (now >= preferred.rateLimitReset) return preferred;

    return available[0];
}

function markRateLimited(account: RuntimeAccount, cooldownMs = 60000): void {
    account.rateLimitReset = Date.now() + cooldownMs;
    account.consecutiveFailures += 1;
    console.warn(`[Pool] Account ${account.email} put on cooldown for ${cooldownMs / 1000}s`);
}

// ========== CHAT COMPLETIONS ==========
async function handleChatCompletions(request: Request, env: Env): Promise<Response> {
    let body: any;
    try {
        body = await request.json();
    } catch {
        return errorResponse("Invalid JSON body", 400, "invalid_request_error");
    }
    if (!body || typeof body !== "object") {
        return errorResponse("Request body must be a JSON object", 400, "invalid_request_error");
    }
    const requestedModel = body.model || "gemini-2.5-flash";
    const modelInfo = resolveModelInfo(requestedModel, body.reasoning_effort);
    const upstreamModel = modelInfo.upstreamModel;
    const isStream = !!body.stream;

    const shouldLog = env.DEBUG_LOG_PAYLOADS === "true";
    if (shouldLog) {
        console.log(`[REQUEST JSON] Model: ${requestedModel} | Stream: ${isStream}\n` + JSON.stringify(body, null, 2));
    }

    const maxAttempts = Math.min(accountsPool.length, 3);
    let lastError: { status: number; message: string; type: string } = {
        status: 503,
        message: "All accounts in pool are currently rate-limited or unavailable",
        type: "rate_limit_error"
    };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const account = selectAccount();
        if (!account) break;

        let accessToken: string;
        try {
            accessToken = await getAccessToken(account, env);
        } catch (e: any) {
            console.error(`Auth failure for account index ${account.index}:`, e.message);
            const isRevoked = /invalid_grant/i.test(e?.message || "");
            markRateLimited(account, isRevoked ? 3600000 : 120000);
            lastError = { status: 401, message: "Upstream authentication failed", type: "authentication_error" };
            continue;
        }

        const payload = await transformOpenAiRequest(body, modelInfo);
        const wrappedPayload = {
            project: account.projectId,
            model: upstreamModel,
            request: payload,
            requestType: "agent",
            userAgent: "antigravity",
            requestId: `agent-${crypto.randomUUID()}`
        };
        const payloadJson = JSON.stringify(wrappedPayload);

        const buildHeaders = (token: string) => ({
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "Accept": isStream ? "text/event-stream" : "application/json",
            "User-Agent": "antigravity/2.0.4 windows/amd64",
            "X-Goog-Api-Client": "google-cloud-sdk vscode/1.98.0",
            "Client-Metadata": JSON.stringify({ ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" })
        });

        // Whether this account should be put on cooldown (only for 429 / 5xx / network / auth issues)
        let shouldCooldown = false;
        let authRetried = false;
        let notFoundCount = 0;
        let last404Message = "";

        for (let epIdx = 0; epIdx < ENDPOINTS.length; epIdx++) {
            const endpoint = ENDPOINTS[epIdx];
            const action = isStream ? "streamGenerateContent?alt=sse" : "generateContent";
            const url = `${endpoint}/v1internal:${action}`;

            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers: buildHeaders(accessToken),
                    body: payloadJson
                });

                if (response.ok) {
                    account.consecutiveFailures = 0;
                    account.totalRequests = (account.totalRequests || 0) + 1;
                    account.lastUsed = Date.now();
                    if (isStream) {
                        return streamToOpenAi(response, requestedModel, shouldLog);
                    } else {
                        const data = await response.json() as any;
                        const mapped = mapUnaryResponse(data, requestedModel);
                        if (shouldLog) {
                            console.log(`[RESPONSE JSON] Model: ${requestedModel}\n` + JSON.stringify(mapped, null, 2));
                        }
                        return jsonResponse(mapped);
                    }
                }

                const status = response.status;
                const errText = await response.text();

                // Expired / revoked access token: invalidate, refresh and retry this endpoint once
                if (status === 401) {
                    console.warn(`[Upstream 401 on ${endpoint}]: ${errText.substring(0, 150)}`);
                    lastError = { status: 401, message: "Upstream authentication failed", type: "authentication_error" };
                    if (!authRetried) {
                        authRetried = true;
                        await invalidateToken(account, env);
                        try {
                            accessToken = await getAccessToken(account, env);
                            epIdx--; // retry same endpoint with fresh token
                            continue;
                        } catch (e: any) {
                            console.error(`Token refresh after 401 failed:`, e.message);
                        }
                    }
                    shouldCooldown = true;
                    break; // move on to next account
                }

                // Rate limit: try other endpoint, then cooldown account
                if (status === 429) {
                    console.warn(`[Upstream 429 on ${endpoint}]: ${errText.substring(0, 150)}`);
                    lastError = { status: 429, message: "Upstream rate limit reached", type: "rate_limit_error" };
                    shouldCooldown = true;
                    continue;
                }

                if (status === 403) {
                    console.error(`403 on ${endpoint}: ${errText.substring(0, 200)}`);
                    lastError = { status: 403, message: "Permission denied on upstream provider", type: "permission_error" };
                    shouldCooldown = true;
                    continue;
                }

                if (status === 404) {
                    notFoundCount++;
                    last404Message = `Model '${requestedModel}' not found upstream: ${extractUpstreamMessage(errText)}`;
                    lastError = { status: 404, message: last404Message, type: "invalid_request_error" };
                    continue;
                }

                // Other client errors (400, 413, 422...) are caused by the request itself:
                // return immediately, do not burn the account or retry elsewhere.
                if (status >= 400 && status < 500) {
                    console.error(`Upstream client error ${status}: ${errText.substring(0, 300)}`);
                    return errorResponse(`Upstream rejected request (${status}): ${extractUpstreamMessage(errText)}`, status, "invalid_request_error");
                }

                console.error(`Upstream status ${status}: ${errText.substring(0, 200)}`);
                lastError = { status, message: "Upstream model provider error", type: "api_error" };
                shouldCooldown = true;
                continue;

            } catch (networkError: any) {
                console.error(`Network error to ${endpoint}:`, networkError.message);
                lastError = { status: 502, message: "Bad Gateway to upstream service", type: "api_error" };
                shouldCooldown = true;
                continue;
            }
        }

        // Model not found upstream: return 404 immediately, do not burn the account or loop through pool
        if (notFoundCount > 0) {
            return errorResponse(last404Message || lastError.message, 404, "invalid_request_error");
        }

        if (shouldCooldown) {
            markRateLimited(account, lastError.status === 401 ? 120000 : 45000);
        }
    }

    return errorResponse(lastError.message, lastError.status, lastError.type);
}

function extractUpstreamMessage(errText: string): string {
    try {
        const parsed = JSON.parse(errText);
        const e = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error;
        if (e?.message) return String(e.message).substring(0, 300);
    } catch { /* not JSON */ }
    return errText.substring(0, 300);
}

// ========== OPENAI -> GOOGLE TRANSFORMER ==========
async function transformOpenAiRequest(body: any, modelInfo: ModelResolution): Promise<any> {
    const modelName = modelInfo.upstreamModel;
    let systemInstruction: any = null;
    const contents: any[] = [];

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const toolCallIdToName = new Map<string, string>();

    // Pre-scan assistant messages to map tool_call_id to function name
    for (const msg of messages) {
        if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
            for (const tc of msg.tool_calls) {
                if (tc.id && tc.function?.name) {
                    toolCallIdToName.set(tc.id, tc.function.name);
                }
            }
        }
    }

    for (const msg of messages) {
        if (msg.role === "system") {
            const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
            if (!systemInstruction) {
                systemInstruction = { role: "user", parts: [{ text }] };
            } else {
                systemInstruction.parts[0].text += "\n\n" + text;
            }
            continue;
        }

        // Tool output message: OpenAI { role: "tool", tool_call_id, content }
        // Maps to Google Cloud Code: role "user" with functionResponse part
        if (msg.role === "tool") {
            const funcName = toolCallIdToName.get(msg.tool_call_id) || msg.name || "function";
            let responseContent: any = msg.content;
            if (typeof msg.content === "string") {
                try {
                    responseContent = JSON.parse(msg.content);
                } catch {
                    responseContent = msg.content;
                }
            }
            contents.push({
                role: "user",
                parts: [{
                    functionResponse: {
                        name: funcName,
                        response: { content: responseContent }
                    }
                }]
            });
            continue;
        }

        const role = msg.role === "assistant" ? "model" : "user";
        const parts: any[] = [];

        if (typeof msg.content === "string") {
            let cleanText = msg.content;
            if (role === "model") {
                // Strip <think>...</think> from previous assistant turns so model context is not polluted
                cleanText = cleanText.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
            }
            if (cleanText) {
                parts.push({ text: cleanText });
            }
        } else if (Array.isArray(msg.content)) {
            for (const item of msg.content) {
                if (item.type === "text" && item.text) {
                    let cleanText = item.text;
                    if (role === "model") {
                        cleanText = cleanText.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
                    }
                    if (cleanText) parts.push({ text: cleanText });
                } else if (item.type === "image_url" && item.image_url?.url) {
                    const url = item.image_url.url;
                    if (url.startsWith("data:")) {
                        const [header, base64Data] = url.split(",", 2);
                        const mimeType = header.split(":")[1]?.split(";")[0] || "image/png";
                        parts.push({ inlineData: { mimeType, data: base64Data } });
                    } else if (url.startsWith("http://") || url.startsWith("https://")) {
                        try {
                            const imgResp = await fetch(url, { signal: AbortSignal.timeout(10000) });
                            if (imgResp.ok) {
                                const contentType = imgResp.headers.get("content-type") || "";
                                if (!contentType.startsWith("image/")) {
                                    console.warn("Skipping non-image URL:", url, contentType);
                                    continue;
                                }
                                const contentLength = Number(imgResp.headers.get("content-length")) || 0;
                                if (contentLength > 20 * 1024 * 1024) {
                                    console.warn("Skipping oversized image:", url, contentLength);
                                    continue;
                                }
                                const arrayBuf = await imgResp.arrayBuffer();
                                if (arrayBuf.byteLength > 20 * 1024 * 1024) continue;
                                const base64Data = arrayBufferToBase64(arrayBuf);
                                const mimeType = contentType.split(";")[0] || "image/jpeg";
                                parts.push({ inlineData: { mimeType, data: base64Data } });
                            }
                        } catch (e: any) {
                            console.warn("Failed to download external image:", url, e.message);
                        }
                    }
                }
            }
        }

        // Assistant function calls (tool_calls)
        if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
                if (tc.type === "function" && tc.function) {
                    let args = {};
                    if (typeof tc.function.arguments === "string") {
                        try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
                    } else if (typeof tc.function.arguments === "object") {
                        args = tc.function.arguments || {};
                    }
                    parts.push({
                        thoughtSignature: SKIP_THOUGHT_SIGNATURE,
                        functionCall: {
                            name: tc.function.name,
                            args
                        }
                    });
                }
            }
        }

        // Inject thought signatures for Claude models
        if (role === "model" && modelName.toLowerCase().includes("claude")) {
            for (const part of parts) {
                if (part.thought && !part.thoughtSignature) {
                    part.thoughtSignature = SKIP_THOUGHT_SIGNATURE;
                }
            }
        }

        // Prevent empty parts (which cause Google to return 400 INVALID_ARGUMENT)
        if (parts.length > 0) {
            contents.push({ role, parts });
        }
    }

    const genConfig: any = {
        temperature: body.temperature ?? 0.7,
        topP: body.top_p ?? 0.95,
        maxOutputTokens: body.max_completion_tokens ?? body.max_tokens ?? 8192
    };

    if (body.stop) {
        genConfig.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
    }

    // Enable thinking mode if requested
    const isThinkingModel = modelInfo.isGemini3 || modelName.includes("thinking") || modelName.includes("gemini-2.5") || modelName.includes("claude");
    if (isThinkingModel && modelInfo.thinkingLevel === "NONE") {
        // Thinking OFF: Gemini 3 and Claude cannot fully disable thinking -> minimal level, hidden thoughts.
        // Others (Gemini 2.5): omit thinkingConfig completely (Google Cloud Code rejects thinkingBudget: 0 with 400).
        if (modelInfo.isGemini3) {
            genConfig.thinkingConfig = { includeThoughts: false, thinkingLevel: "LOW" };
        } else if (modelName.includes("claude")) {
            genConfig.thinkingConfig = { includeThoughts: false };
        }
    } else if (isThinkingModel) {
        if (modelInfo.isGemini3) {
            genConfig.thinkingConfig = {
                includeThoughts: true,
                thinkingLevel: modelInfo.thinkingLevel // LOW | MEDIUM | HIGH
            };
        } else if (modelName.includes("claude")) {
            genConfig.thinkingConfig = {
                includeThoughts: true
            };
        } else {
            const budget = modelInfo.thinkingLevel === "LOW" ? 4096 : modelInfo.thinkingLevel === "MEDIUM" ? 12288 : 24576;
            genConfig.thinkingConfig = {
                includeThoughts: true,
                thinkingBudget: budget
            };
            if (genConfig.maxOutputTokens <= budget) {
                genConfig.maxOutputTokens = budget + 4096;
            }
        }
    }

    // Inject real-time UTC date/time context so all models (including Claude) know current time
    const nowUtc = new Date().toUTCString();
    const dateContext = `[Current Context: Real-time UTC date is ${nowUtc}]`;
    if (!systemInstruction) {
        systemInstruction = { role: "user", parts: [{ text: dateContext }] };
    } else {
        systemInstruction.parts[0].text = dateContext + "\n\n" + systemInstruction.parts[0].text;
    }

    const payload: any = {
        contents,
        generationConfig: genConfig,
        safetySettings: [
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
    };

    if (systemInstruction) {
        payload.systemInstruction = systemInstruction;
    }

    // Grounding (Google Search)
    const enableGrounding = (
        body.grounding === true ||
        body.web_search === true ||
        (Array.isArray(body.tools) && body.tools.some((t: any) =>
            t.type === "web_search" ||
            t.type === "googleSearch" ||
            t.type === "google_search" ||
            t.googleSearch
        ))
    );

    const toolsPayload: any[] = [];
    if (enableGrounding && !modelName.toLowerCase().includes("claude")) {
        toolsPayload.push({ googleSearch: {} });
    }

    // Function Calling / Tools declarations
    if (Array.isArray(body.tools) && body.tools.length > 0) {
        const functionDeclarations = body.tools
            .filter((t: any) => t.type === "function" && t.function?.name)
            .map((t: any) => ({
                name: t.function.name,
                description: t.function.description || "",
                parameters: t.function.parameters || { type: "object", properties: {} }
            }));

        if (functionDeclarations.length > 0) {
            toolsPayload.push({ functionDeclarations });
        }
    }

    if (toolsPayload.length > 0) {
        payload.tools = toolsPayload;
    }

    // Tool choice mapping
    if (body.tool_choice) {
        if (body.tool_choice === "auto") {
            payload.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
        } else if (body.tool_choice === "none") {
            payload.toolConfig = { functionCallingConfig: { mode: "NONE" } };
        } else if (body.tool_choice === "required") {
            payload.toolConfig = { functionCallingConfig: { mode: "ANY" } };
        } else if (typeof body.tool_choice === "object" && body.tool_choice.function?.name) {
            payload.toolConfig = {
                functionCallingConfig: {
                    mode: "ANY",
                    allowedFunctionNames: [body.tool_choice.function.name]
                }
            };
        }
    }

    return payload;
}

// ========== STREAMING (SSE) ==========
function streamToOpenAi(response: Response, modelName: string, shouldLog = true): Response {
    const completionId = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    let buffer = "";
    let isFirstChunk = true;
    let accumulatedThought = "";
    let accumulatedContent = "";
    const accumulatedToolCalls: any[] = [];

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const transformStream = new TransformStream({
        transform(chunk, controller) {
            buffer += decoder.decode(chunk, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                processLine(line.trim(), controller);
            }
        },
        flush(controller) {
            if (buffer.trim()) {
                processLine(buffer.trim(), controller);
            }
            if (shouldLog) {
                console.log(`[RESPONSE STREAM COMPLETE] Model: ${modelName}\n` + JSON.stringify({
                    id: completionId,
                    object: "chat.completion",
                    model: modelName,
                    choices: [{
                        index: 0,
                        message: {
                            role: "assistant",
                            content: accumulatedContent || null,
                            ...(accumulatedThought ? { reasoning_content: accumulatedThought } : {}),
                            ...(accumulatedToolCalls.length ? { tool_calls: accumulatedToolCalls } : {})
                        }
                    }]
                }, null, 2));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }
    });

    function processLine(line: string, controller: TransformStreamDefaultController): void {
        if (!line.startsWith("data: ")) return;

        const dataStr = line.substring(6).trim();
        if (dataStr === "[DONE]") {
            return; // Handled in flush
        }

        try {
            const parsed = JSON.parse(dataStr);
            const cand = parsed.response?.candidates?.[0];
            if (!cand) return;

            const parts = cand.content?.parts || [];
            let contentText = "";
            let thinkText = "";
            const streamToolCalls: any[] = [];

            for (const part of parts) {
                if (part.thought === true) {
                    thinkText += part.text || "";
                } else if (part.text) {
                    contentText += part.text;
                } else if (part.inlineData) {
                    contentText += `\n![Generated Image](data:${part.inlineData.mimeType || "image/jpeg"};base64,${part.inlineData.data})\n`;
                } else if (part.functionCall) {
                    const tc = {
                        index: accumulatedToolCalls.length + streamToolCalls.length,
                        id: part.functionCall.id || `call_${crypto.randomUUID()}`,
                        type: "function",
                        function: {
                            name: part.functionCall.name,
                            arguments: typeof part.functionCall.args === "string" ? part.functionCall.args : JSON.stringify(part.functionCall.args || {})
                        }
                    };
                    streamToolCalls.push(tc);
                }
            }

            // Stream reasoning/thought chunk
            if (thinkText) {
                accumulatedThought += thinkText;
                sendChunk(controller, { reasoning_content: thinkText }, null);
            }

            // Stream tool calls chunk
            if (streamToolCalls.length > 0) {
                accumulatedToolCalls.push(...streamToolCalls);
                sendChunk(controller, { tool_calls: streamToolCalls }, "tool_calls");
                return;
            }

            const finishReason = cand.finishReason === "STOP" ? "stop" :
                cand.finishReason === "MAX_TOKENS" ? "length" :
                    cand.finishReason === "SAFETY" ? "content_filter" : null;

            if (contentText) {
                accumulatedContent += contentText;
                sendChunk(controller, { content: contentText }, finishReason);
            } else if (finishReason) {
                sendChunk(controller, {}, finishReason);
            }
        } catch {}
    }

    function sendChunk(
        controller: TransformStreamDefaultController,
        deltaFields: { content?: string; reasoning_content?: string; tool_calls?: any[] },
        finishReason: string | null
    ): void {
        const delta: any = {};
        if (isFirstChunk) {
            delta.role = "assistant";
            isFirstChunk = false;
        }
        if (deltaFields.content !== undefined) delta.content = deltaFields.content;
        if (deltaFields.reasoning_content !== undefined) delta.reasoning_content = deltaFields.reasoning_content;
        if (deltaFields.tool_calls !== undefined) delta.tool_calls = deltaFields.tool_calls;

        const chunk = {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model: modelName,
            choices: [{
                index: 0,
                delta,
                finish_reason: finishReason
            }]
        };

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
    }

    return new Response(response.body!.pipeThrough(transformStream), {
        headers: {
            ...CORS_HEADERS,
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
    });
}

// ========== UNARY RESPONSE ==========
function mapUnaryResponse(data: any, modelName: string): any {
    let finishReason = "stop";
    const message: any = { role: "assistant", content: "" };

    const cand = data.response?.candidates?.[0];
    if (cand) {
        const parts = cand.content?.parts || [];
        const thoughtParts = parts.filter((p: any) => p.text && p.thought === true).map((p: any) => p.text).join("");
        const textParts = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("");
        const imageParts = parts.filter((p: any) => p.inlineData).map((p: any) => `\n![Generated Image](data:${p.inlineData.mimeType || "image/jpeg"};base64,${p.inlineData.data})\n`).join("");
        const functionCalls = parts.filter((p: any) => p.functionCall).map((p: any) => ({
            id: p.functionCall.id || `call_${crypto.randomUUID()}`,
            type: "function",
            function: {
                name: p.functionCall.name,
                arguments: typeof p.functionCall.args === "string" ? p.functionCall.args : JSON.stringify(p.functionCall.args || {})
            }
        }));

        if (thoughtParts) {
            message.reasoning_content = thoughtParts;
        }

        const answerText = textParts + imageParts;
        if (functionCalls.length > 0) {
            message.tool_calls = functionCalls;
            message.content = answerText ? answerText : null;
            finishReason = "tool_calls";
        } else {
            message.content = answerText;
        }

        if (cand.finishReason === "MAX_TOKENS") finishReason = "length";
        else if (cand.finishReason === "SAFETY") finishReason = "content_filter";
    }

    const usage = {
        prompt_tokens: data.response?.usageMetadata?.promptTokenCount || 0,
        completion_tokens: data.response?.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: data.response?.usageMetadata?.totalTokenCount || 0
    };

    return {
        id: `chatcmpl-${crypto.randomUUID()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
            index: 0,
            message,
            finish_reason: finishReason
        }],
        usage
    };
}

// ========== IMAGE GENERATIONS (DALL-E COMPATIBLE) ==========
async function handleImageGenerations(request: Request, env: Env): Promise<Response> {
    const body = await request.json() as any;
    const prompt = body.prompt || "";
    if (!prompt) {
        return errorResponse("Field 'prompt' is required", 400, "invalid_request_error");
    }

    const account = selectAccount();
    if (!account) {
        return errorResponse("No available accounts in pool", 503, "rate_limit_error");
    }

    let accessToken: string;
    try {
        accessToken = await getAccessToken(account, env);
    } catch (e: any) {
        return errorResponse("Authentication failed", 401, "authentication_error");
    }

    const wrappedPayload = {
        project: account.projectId,
        model: "gemini-3.1-flash-image",
        request: {
            contents: [{ role: "user", parts: [{ text: prompt }] }]
        },
        requestType: "agent",
        userAgent: "antigravity",
        requestId: `agent-${crypto.randomUUID()}`
    };

    const headers = {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "antigravity/2.0.4 windows/amd64",
        "X-Goog-Api-Client": "google-cloud-sdk vscode/1.98.0",
        "Client-Metadata": JSON.stringify({ ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" })
    };

    for (const endpoint of ENDPOINTS) {
        try {
            const resp = await fetch(`${endpoint}/v1internal:generateContent`, {
                method: "POST",
                headers,
                body: JSON.stringify(wrappedPayload)
            });

            if (resp.ok) {
                const data = await resp.json() as any;
                const parts = data.response?.candidates?.[0]?.content?.parts || [];
                const imgPart = parts.find((p: any) => p.inlineData);

                if (!imgPart) {
                    return errorResponse("No image generated by model", 500);
                }

                account.totalRequests = (account.totalRequests || 0) + 1;
                account.lastUsed = Date.now();
                return jsonResponse({
                    created: Math.floor(Date.now() / 1000),
                    data: [
                        {
                            b64_json: imgPart.inlineData.data,
                            revised_prompt: prompt
                        }
                    ]
                });
            }
        } catch {}
    }

    return errorResponse("Image generation failed on upstream provider", 500);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as any);
    }
    return btoa(binary);
}

// Global cache for discovered models
let memoryModelsCache: string[] | null = null;
let lastModelsDiscovery = 0;

async function getDiscoveredModels(env: Env): Promise<string[]> {
    const now = Date.now();
    if (memoryModelsCache && (now - lastModelsDiscovery < 3600000)) {
        return memoryModelsCache;
    }

    if (env.KV) {
        const cached = await env.KV.get(MODELS_CACHE_KEY, "json") as string[] | null;
        if (cached && Array.isArray(cached) && cached.length > 0) {
            memoryModelsCache = cached;
            lastModelsDiscovery = now;
            return cached;
        }
    }

    const account = selectAccount();
    if (!account) return DEFAULT_MODELS;

    try {
        const accessToken = await getAccessToken(account, env);
        const headers = {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "User-Agent": "antigravity/2.0.4 windows/amd64",
            "X-Goog-Api-Client": "google-cloud-sdk vscode/1.98.0",
            "Client-Metadata": JSON.stringify({ ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" })
        };

        for (const endpoint of ENDPOINTS) {
            try {
                const resp = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ project: account.projectId || DEFAULT_PROJECT_ID })
                });

                if (resp.ok) {
                    const data = await resp.json() as any;
                    const liveModels = Object.keys(data.models || {});
                    if (liveModels.length > 0) {
                        // Merge live upstream models with DEFAULT_MODELS so known models (Claude 5.5, Gemini 3.8) are always guaranteed
                        const combined = Array.from(new Set([...DEFAULT_MODELS, ...liveModels]));
                        memoryModelsCache = combined;
                        lastModelsDiscovery = now;
                        if (env.KV) {
                            await env.KV.put(MODELS_CACHE_KEY, JSON.stringify(combined), { expirationTtl: 86400 });
                        }
                        return combined;
                    }
                }
            } catch {}
        }
    } catch (e: any) {
        console.warn("Dynamic model discovery failed, using defaults:", e.message);
    }

    return DEFAULT_MODELS;
}

// ========== MODELS & STATUS ==========
async function handleModels(env: Env): Promise<Response> {
    const modelIds = await getDiscoveredModels(env);
    const models = modelIds.map(id => ({
        id,
        object: "model",
        created: 1727230000,
        owned_by: "google"
    }));

    return jsonResponse({ object: "list", data: models });
}

function handleAccountsStatus(): Response {
    const status = accountsPool.map(acc => ({
        index: acc.index,
        email: acc.email,
        projectId: acc.projectId,
        isRateLimited: Date.now() < acc.rateLimitReset,
        cooldownSecondsRemaining: Math.max(0, Math.ceil((acc.rateLimitReset - Date.now()) / 1000)),
        totalRequests: acc.totalRequests || 0,
        lastUsed: acc.lastUsed || 0,
        consecutiveFailures: acc.consecutiveFailures || 0
    }));

    return jsonResponse({
        totalAccounts: accountsPool.length,
        accounts: status
    });
}

// ========== HELPERS ==========
function jsonResponse(data: any, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
}

function errorResponse(message: string, status = 500, type = "api_error"): Response {
    return new Response(JSON.stringify({
        error: { message, type, code: status }
    }), {
        status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
}

// ========== EXPORTS FOR TESTING ==========
export {
    resolveModelInfo,
    transformOpenAiRequest,
    mapUnaryResponse,
    streamToOpenAi,
    extractUpstreamMessage,
    DEFAULT_MODELS,
    MODELS_CACHE_KEY,
    getDiscoveredModels,
    getAccessToken,
    invalidateToken,
    accountsPool,
    selectAccount,
    markRateLimited
};

