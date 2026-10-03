# Antigravity AI Proxy

High-performance, secure, and production-grade OpenAI-compatible proxy interface for Google Cloud Code (Antigravity) API endpoints. Includes an integrated web chat interface, account pool management dashboard, and automated Cloudflare deployment tooling.

---

## Quick Deploy (From Scratch)

Follow this simple step-by-step guide to get your proxy running in less than 3 minutes, even if you are on a fresh computer with no development tools installed.

---

### Step 1: Install Node.js & npm

Node.js comes bundled with `npm`. If you don't have it installed yet:

* **Windows**:
  * Download the installer from the official website: [nodejs.org](https://nodejs.org/) (choose LTS).
  * Or install directly via PowerShell:
    ```powershell
    winget install OpenJS.NodeJS.LTS
    ```

* **macOS**:
  * Run in Terminal:
    ```bash
    brew install node
    ```
  * Or download the package from [nodejs.org](https://nodejs.org/).

* **Linux (Ubuntu / Debian)**:
  ```bash
  sudo apt update && sudo apt install -y nodejs npm
  ```

After installing, open a new terminal window and verify that both are ready:
```bash
node -v
npm -v
```

---

### Step 2: Run the Quick Deploy Commands

Open your terminal inside this project's folder and run:

```bash
# 1. Install required dependencies
npm install

# 2. Log in with your Google account (opens browser)
npm run login

# 3. Deploy everything to Cloudflare Workers
npm run deploy
```

*(Note for Python users: If you prefer Python or don't have Node for the login step, you can run `python login.py` instead of `npm run login`.)*

---

### Step 3: What to Expect During Deployment

1. **Google Login (`npm run login`)**:
   * Your browser will automatically open Google's authorization page.
   * Sign in and approve access.
   * The script saves your tokens locally to `accounts.json` (kept secure on your machine, never committed to git).
   * *Optional:* Run `npm run login` again to add more accounts for automatic quota pooling and round-robin rotation.

2. **Cloudflare Deployment (`npm run deploy`)**:
   * The script checks if you are logged in to Cloudflare. If not, it opens your browser to log in (or create a free Cloudflare account).
   * It prompts you: **"Enter your desired Master API Key"**. Type any password or secret key you want to protect your proxy with (or press Enter to generate a secure random key).
   * The script automatically creates the Cloudflare KV cache storage, uploads your encrypted secrets, and publishes the Worker backend and Web UI.
   * When finished, it prints your live production URLs:
     * **Web Chat & Dashboard**: `https://<your-worker-name>.workers.dev`
     * **OpenAI API Base URL**: `https://<your-worker-name>.workers.dev/v1`

---

### Step 4: Start Using Your Proxy

* **Use the Web Chat**: Open `https://<your-worker-name>.workers.dev` in any browser, click **API Key** in the top bar, enter the Master API Key you chose in Step 3, and start chatting with Gemini 3.8 or Claude!
* **Connect to Cursor / Cline / Roo-Code / OpenWebUI**:
  * **Provider / Format**: OpenAI Compatible
  * **Base URL**: `https://<your-worker-name>.workers.dev/v1`
  * **API Key**: `<Your Master API Key>`
  * **Model**: `gemini-3.8-flash-tiered` or `claude-sonnet-5-5-high`

---

## Architectural Overview

This project bridges external OpenAI-compatible clients (such as Cursor, Cline, OpenWebUI, LibreChat, and official SDKs) with Google internal Cloud Code infrastructure.

```
+--------------------------------------------------------------------------------+
|                             External Clients                                  |
|         Cursor / Cline / NextChat / LibreChat / Python & Node SDKs             |
+--------------------------------------------------------------------------------+
                                       | (OpenAI API Format / HTTPS)
                                       v
+--------------------------------------------------------------------------------+
|                         Cloudflare Global Network                              |
|                                                                                |
|   +--------------------------+       +-------------------------------------+   |
|   |   Static Assets Edge     |       |         Worker Runtime              |   |
|   |   (/, /style.css, etc.)  |       |   (/v1/chat/completions, /models)   |   |
|   |   Web Chat & Dashboard   |       |   - Authorization (Bearer Token)    |   |
|   +--------------------------+       |   - Round-Robin Account Pool        |   |
|                                      |   - Cooldown Management (HTTP 429)  |   |
|                                      |   - Dynamic Model Discovery         |   |
|                                      |   - Protocol Transformation (OpenAI)|   |
|                                      +-------------------------------------+   |
|                                                         |                      |
|                                              Cloudflare KV Cache               |
|                                              (Tokens & Models)                 |
+--------------------------------------------------------------------------------+
                                       | (Internal Google RPC)
                                       v
+--------------------------------------------------------------------------------+
|                        Google Cloud Code Infrastructure                        |
|             (Gemini 2.5/3.x, Claude Sonnet 5.5, Claude Opus 5.5, Vision)     |
+--------------------------------------------------------------------------------+
```

### Key Technical Capabilities

1. **Protocol Transformation**:
   * Complete mapping from OpenAI `/v1/chat/completions` (both unary JSON and Server-Sent Events SSE streaming) to Google's internal `generateContent` and `streamGenerateContent` RPC protocols.
   * OpenAI image generation endpoint (`/v1/images/generations`) backed by `gemini-3.1-flash-image`.
2. **Account Pool & Quota Management**:
   * Multi-account rotation with automatic round-robin scheduling.
   * Proactive rate limit isolation: when an account encounters an upstream HTTP 429 or quota exhaustion, it is temporarily placed on cooldown while traffic routes to remaining active credentials.
3. **Reasoning & Thinking Models**:
   * Full compatibility with reasoning models (Deep Thinking). Real-time `<think>` tag extraction and streaming.
   * Automatic mapping of `reasoning_effort` (`low`, `medium`, `high`) to upstream `thinkingLevel` specifications.
   * Thought signature bypass injection (`skip_thought_signature_validator`) to prevent Claude multi-turn conversation validation failures.
4. **Dynamic Model Discovery**:
   * Queries Google Cloud Code endpoints dynamically via `POST /v1internal:fetchAvailableModels`.
   * Automatically discovers and serves newly deployed models (e.g., `gemini-3.8-flash-tiered`, `gemini-3.9-flash-tiered`, `claude-sonnet-5-5-high`, `claude-opus-5-5-high`) without manual updates or redeployments.
5. **Decoupled Frontend**:
   * Modern, responsive web application located in `./public`.
   * Zero server-side templating or inline HTML strings in the Worker codebase.
   * Delivered directly via Cloudflare Workers Static Assets with global edge caching.
6. **Google Search Grounding & Real-Time Context**:
   * Native Google Search Grounding for Gemini models (`grounding: true` or `web_search: true` in request body, or via the Web UI Search toggle).
   * Real-time UTC date and time context automatically injected into the system prompt, ensuring all models (including Claude) are aware of the exact current date and year.

---

## Directory Structure

```
.
├── worker.ts          # Core Cloudflare Worker: routing, auth, protocol translation
├── login.ts           # Local OAuth PKCE CLI: authenticates Google accounts safely
├── deploy.ts          # Automated deployment orchestrator for Cloudflare Workers
├── test-proxy.ts      # Automated end-to-end test suite
├── wrangler.toml      # Cloudflare Workers configuration file
├── package.json       # Project manifest and scripts
├── .dev.vars          # Local development secrets (git-ignored)
├── accounts.json      # Local store of Google refresh tokens (git-ignored)
└── public/            # Static Web UI and Pool Dashboard
    ├── index.html     # Semantic HTML5 layout
    ├── style.css      # Dual-theme design system (Light and Dark)
    └── app.js         # Client-side streaming engine and management UI
```

---

## Prerequisites

* **Node.js**: Version 24.0.0 or higher (supports native TypeScript execution).
* **Cloudflare Account**: For production deployment.
* **Google Account**: Personal account (free tier or Google One AI Pro) or Google Workspace account.

---

## Step 1: Account Authorization

Authentication is handled via a secure local PKCE (Proof Key for Code Exchange) OAuth flow on `localhost:51121`.

Execute the authorization script:

```bash
npm run login
```

1. The script will automatically launch your default browser and redirect you to Google's OAuth consent screen.
2. Sign in and grant access.
3. Upon approval, the loopback server captures the authorization code, exchanges it for a permanent `refresh_token`, resolves your assigned Google Cloud project (`aicode-consumers`), and writes the record to `accounts.json`.

> **Note on Multi-Account Rotation**: To configure multiple accounts for quota pooling, execute `npm run login` again for each additional Google account. All credentials will be saved in `accounts.json` and rotated automatically.

---

## Step 2: Local Development & Verification

### Running the Test Suite

Execute the automated test suite to verify connectivity, schema compliance, model resolution, and streaming:

```bash
npm test
```

The test runner evaluates:
* Health endpoint status (`GET /health`).
* Authentication barriers (`401 Unauthorized` enforcement).
* CORS preflight response headers.
* Dynamic model discovery (`GET /v1/models`).
* Unary chat completion with usage metric validation.
* Server-Sent Events (SSE) streaming with `<think>` tag extraction.
* Claude model routing and thought signature verification.
* Multimodal Vision (base64 image payload processing).
* Account pool metrics and cooldown reset controls.

### Starting the Local Development Server

Run the local development server with live static asset binding:

```bash
npm run dev
```

Navigate to `http://localhost:8787` in your browser to access the Web Chat and Account Pool Dashboard.

---

## Step 3: Automated Cloudflare Deployment

The automated deployment script handles authentication verification, KV namespace provisioning, secret synchronization, and asset compilation in a single workflow.

Run the deployment command:

```bash
npm run deploy
```

### Automation Sequence:

1. **Authentication Check**: Validates active Cloudflare authentication via `wrangler whoami`. If unauthenticated, it initiates `wrangler login` in your browser.
2. **Account Parsing**: Reads `accounts.json` and verifies active credential structures.
3. **Master Key Generation**: Extracts `PROXY_API_KEY` from `.dev.vars` or generates a cryptographically secure 256-bit random master key.
4. **KV Namespace Provisioning**: Verifies if a KV namespace binding is present in `wrangler.toml`. If missing, it provisions one via Cloudflare API and injects the binding into `wrangler.toml`.
5. **Bulk Secret Upload**: Transmits `PROXY_API_KEY` and `ACCOUNTS` non-interactively using `wrangler secret bulk`.
6. **Edge Publication**: Compiles TypeScript and publishes all static assets in `./public` along with the Worker bundle.
7. **Post-Deployment Health Check**: Performs an automated live query against the deployed endpoint and prints connection parameters.

---

## Step 4: Manual Deployment via Cloudflare Dashboard (GUI)

If you prefer not to use the automated CLI script, you can deploy and configure the proxy entirely through the Cloudflare web dashboard:

### 1. Create a Worker

1. Navigate to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. In the left navigation menu, select **Compute (Workers) > Workers & Pages**.
3. Click **Create application**, then select **Create Worker**.
4. Set the Worker name (e.g., `antigravity-proxy`) and click **Deploy**.

### 2. Upload Code and Static Assets

Because the project uses TypeScript and Static Assets, compile the bundle or deploy via Git:

* **Option A (Recommended with Git)**: Connect your repository to **Workers & Pages > Create application > Pages/Workers Git integration**. Specify the build command as `npx wrangler deploy`.
* **Option B (Direct CLI publish from local machine)**:
  ```bash
  npx wrangler deploy
  ```

### 3. Configure Secrets and Environment Variables

1. In the Cloudflare Dashboard, open your deployed Worker (`antigravity-proxy`).
2. Go to **Settings > Variables and Secrets**.
3. Under **Secrets**, add the following two required entries:
   * **`PROXY_API_KEY`**: Click **Add**, set name to `PROXY_API_KEY`, enter your secret master key, and click **Encrypt**.
   * **`ACCOUNTS`**: Click **Add**, set name to `ACCOUNTS`, paste the entire stringified content of your local `accounts.json` file (e.g., `[{"email":"user@gmail.com","refresh_token":"1//...","project_id":"aicode-consumers"}]`), and click **Encrypt**.

### 4. Configure KV Namespace Binding (Recommended)

1. In the Cloudflare Dashboard, navigate to **Storage & Databases > KV**.
2. Click **Create a namespace** and name it `antigravity-cache`.
3. Return to **Compute (Workers) > Workers & Pages > antigravity-proxy > Settings > Bindings**.
4. Click **Add binding** and select **KV Namespace**.
5. Set **Variable name** to `KV`.
6. Select the `antigravity-cache` namespace created in step 2.
7. Click **Save and deploy**.

---

## API Reference

All requests to `/v1/*` require an HTTP header:
`Authorization: Bearer <PROXY_API_KEY>`

### 1. Health Check
* **Endpoint**: `GET /health`
* **Access**: Public
* **Response**:
```json
{
  "status": "ok",
  "timestamp": 1790308421,
  "totalAccounts": 2
}
```

### 2. Model Discovery
* **Endpoint**: `GET /v1/models`
* **Access**: Protected
* **Response**:
```json
{
  "object": "list",
  "data": [
    { "id": "gemini-2.5-flash", "object": "model", "created": 1727230000, "owned_by": "google" },
    { "id": "gemini-3.8-flash-tiered", "object": "model", "created": 1727230000, "owned_by": "google" },
    { "id": "claude-sonnet-4-6", "object": "model", "created": 1727230000, "owned_by": "google" },
    { "id": "claude-opus-4-6-thinking", "object": "model", "created": 1727230000, "owned_by": "google" }
  ]
}
```

### 3. Chat Completions
* **Endpoint**: `POST /v1/chat/completions`
* **Access**: Protected
* **Payload Structure**:
```json
{
  "model": "gemini-3.8-flash-tiered",
  "stream": true,
  "reasoning_effort": "high",
  "messages": [
    { "role": "system", "content": "You are a senior systems engineer." },
    { "role": "user", "content": "Explain lock-free ring buffers." }
  ]
}
```

### 4. Image Generation
* **Endpoint**: `POST /v1/images/generations`
* **Access**: Protected
* **Payload Structure**:
```json
{
  "prompt": "Architectural schematic diagram of a distributed key-value store, blueprint style",
  "model": "gemini-3.1-flash-image",
  "size": "1024x1024"
}
```

### 5. Account Pool Management
* **Endpoint**: `GET /v1/accounts`
* **Access**: Protected
* **Response**:
```json
{
  "totalAccounts": 2,
  "accounts": [
    {
      "index": 0,
      "email": "primary@gmail.com",
      "projectId": "aicode-consumers",
      "isRateLimited": false,
      "cooldownSecondsRemaining": 0,
      "totalRequests": 142,
      "lastUsed": 1790308420000,
      "consecutiveFailures": 0
    }
  ]
}
```

* **Endpoint**: `POST /v1/accounts/reset`
* **Access**: Protected
* **Action**: Clears active rate limit and failure cooldown counters across all registered credentials.

---

## Client Configurations

### 1. Cline / Cursor / Roo-Code
Configure within IDE settings:
* **API Provider**: `OpenAI Compatible`
* **Base URL**: `https://<your-worker-subdomain>.workers.dev/v1`
* **API Key**: `<YOUR_PROXY_API_KEY>`
* **Model ID**: `gemini-3.8-flash-tiered` or `claude-sonnet-5-5-high` (supports aliases `claude`, `sonnet`, `claude-sonnet-5.5`, `opus`, etc.)

### 2. NextChat / LibreChat / OpenWebUI
* **API Host / Endpoint**: `https://<your-worker-subdomain>.workers.dev/v1`
* **API Key**: `<YOUR_PROXY_API_KEY>`

### 3. Official OpenAI Python SDK

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://<your-worker-subdomain>.workers.dev/v1",
    api_key="<YOUR_PROXY_API_KEY>"
)

response = client.chat.completions.create(
    model="gemini-3.8-flash-tiered",
    messages=[
        {"role": "user", "content": "Outline the Raft consensus protocol."}
    ],
    stream=True
)

for chunk in response:
    content = chunk.choices[0].delta.content or ""
    print(content, end="", flush=True)
```

### 4. Official OpenAI Node.js SDK

```typescript
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "https://<your-worker-subdomain>.workers.dev/v1",
  apiKey: "<YOUR_PROXY_API_KEY>",
});

async function main() {
  const stream = await openai.chat.completions.create({
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "Provide a TypeScript type for a deep partial object." }],
    stream: true,
  });

  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || "");
  }
}

main();
```

---

## Security Considerations

1. **Authentication Barrier**: Requests to protected routes without a valid `Authorization: Bearer <PROXY_API_KEY>` header are rejected with `401 Unauthorized` using a constant-time comparison algorithm (`timingSafeCompare`) to prevent timing side-channel attacks.
2. **Secret Encryption**: Google refresh tokens are stored encrypted inside Cloudflare Workers environment secrets (`ACCOUNTS`) or KV. They are never transmitted to client browsers.
3. **Cross-Origin Resource Sharing (CORS)**: Preflight `OPTIONS` requests are handled explicitly with customizable origin controls.
4. **Local Credentials**: The `accounts.json` and `.dev.vars` files contain sensitive credentials and are explicitly excluded from version control via `.gitignore`.
