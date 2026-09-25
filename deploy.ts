// Antigravity AI — Automated Cloudflare Deployment Script
// Runs via: npm run deploy (Node.js v24+ native TypeScript)

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline/promises";

const ROOT_DIR = process.cwd();
const ACCOUNTS_FILE = path.join(ROOT_DIR, "accounts.json");
const DEV_VARS_FILE = path.join(ROOT_DIR, ".dev.vars");
const WRANGLER_FILE = path.join(ROOT_DIR, "wrangler.toml");

async function main() {
    console.log("\n========================================================");
    console.log("   Antigravity Proxy — Automated Cloudflare Deployment");
    console.log("========================================================\n");

    // --- STEP 1: Verify Cloudflare Authentication ---
    console.log("[1/6] Checking Cloudflare authentication status...");
    let isLoggedIn = false;
    try {
        const whoami = execSync("npx wrangler whoami", { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
        if (whoami.includes("You are logged in") || whoami.includes("Account Name") || whoami.includes("Account ID")) {
            isLoggedIn = true;
            console.log("   [OK] Cloudflare authentication verified.");
        }
    } catch {}

    if (!isLoggedIn) {
        console.log("\nNotice: You are not currently authenticated with Cloudflare.");
        console.log("Launching browser for Cloudflare OAuth login...\n");
        const loginProc = spawnSync("npx", ["wrangler", "login"], { stdio: "inherit", shell: true });
        if (loginProc.status !== 0) {
            console.error("\nError: Cloudflare login was cancelled or failed. Run 'npx wrangler login' and retry.");
            process.exit(1);
        }
        console.log("\n   [OK] Cloudflare authentication successful.");
    }

    // --- STEP 2: Verify Accounts ---
    console.log("\n[2/6] Verifying Google accounts configuration...");
    if (!fs.existsSync(ACCOUNTS_FILE)) {
        console.error(`Error: File not found: ${ACCOUNTS_FILE}`);
        console.error("Run 'npm run login' first to link at least one Google account.");
        process.exit(1);
    }

    let accountsJson = fs.readFileSync(ACCOUNTS_FILE, "utf-8").trim();
    let accounts: any[] = [];
    try {
        accounts = JSON.parse(accountsJson);
        if (!Array.isArray(accounts) || accounts.length === 0) {
            throw new Error("Accounts array is empty");
        }
    } catch (e: any) {
        console.error(`Error: Invalid accounts.json format: ${e.message}`);
        console.error("Run 'npm run login' to authorize your Google account.");
        process.exit(1);
    }
    console.log(`   [OK] Found ${accounts.length} configured account(s): ${accounts.map(a => a.email).join(", ")}`);

    // --- STEP 3: Setup or Read PROXY_API_KEY ---
    console.log("\n[3/6] Setting up Master API Key...");

    // Check CLI arguments (e.g. npm run deploy -- --key=my-key or npm run deploy my-key)
    let customKey = "";
    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith("--key=")) {
            customKey = arg.split("=")[1]?.trim();
        } else if (!arg.startsWith("-")) {
            customKey = arg.trim();
        }
    }

    let existingKey = process.env.PROXY_API_KEY || "";
    if (!existingKey && fs.existsSync(DEV_VARS_FILE)) {
        const content = fs.readFileSync(DEV_VARS_FILE, "utf-8");
        const match = content.match(/PROXY_API_KEY=["']?([^"'\r\n]+)/);
        if (match && match[1]) {
            existingKey = match[1];
        }
    }

    let masterApiKey = customKey;

    if (!masterApiKey) {
        if (process.stdin.isTTY) {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            try {
                if (existingKey) {
                    console.log(`   Current Master API Key: "${existingKey}"`);
                    const answer = await rl.question("   Enter custom Master API Key (or press Enter to keep current): ");
                    masterApiKey = answer.trim() || existingKey;
                } else {
                    const answer = await rl.question("   Enter your custom Master API Key (or press Enter to auto-generate): ");
                    masterApiKey = answer.trim();
                }
            } finally {
                rl.close();
            }
        } else {
            masterApiKey = existingKey;
        }
    }

    if (!masterApiKey) {
        masterApiKey = `ag-proxy-${crypto.randomBytes(12).toString("hex")}`;
        console.log(`   Generated secure Master API Key: ${masterApiKey}`);
    } else {
        console.log(`   [OK] Master API Key configured: ${masterApiKey}`);
    }

    // Persist to .dev.vars
    const line = `PROXY_API_KEY="${masterApiKey}"\n`;
    if (fs.existsSync(DEV_VARS_FILE)) {
        let devVars = fs.readFileSync(DEV_VARS_FILE, "utf-8");
        if (devVars.includes("PROXY_API_KEY=")) {
            devVars = devVars.replace(/PROXY_API_KEY=.*(\r?\n|$)/, line);
        } else {
            devVars = line + devVars;
        }
        fs.writeFileSync(DEV_VARS_FILE, devVars);
    } else {
        fs.writeFileSync(DEV_VARS_FILE, line);
    }

    // --- STEP 4: Setup Cloudflare KV Namespace ---
    console.log("\n[4/6] Checking Cloudflare KV Cache Namespace...");
    let wranglerToml = fs.readFileSync(WRANGLER_FILE, "utf-8");
    if (!wranglerToml.includes('binding = "KV"')) {
        console.log("   Creating KV Namespace for token and model caching...");
        try {
            const kvOutput = execSync('npx wrangler kv namespace create "KV"', { encoding: "utf-8" });
            const idMatch = kvOutput.match(/id = "([a-f0-9]+)"/);
            if (idMatch && idMatch[1]) {
                const kvSnippet = `\n[[kv_namespaces]]\nbinding = "KV"\nid = "${idMatch[1]}"\n`;
                fs.appendFileSync(WRANGLER_FILE, kvSnippet);
                console.log(`   [OK] Created KV namespace (ID: ${idMatch[1]}) and updated wrangler.toml.`);
            } else {
                console.log("   Notice: KV creation succeeded but ID parse failed; proceeding without KV.");
            }
        } catch (kvErr: any) {
            console.log(`   Notice: KV namespace creation skipped (${kvErr.message?.substring(0, 60)}); proceeding.`);
        }
    } else {
        console.log("   [OK] KV Namespace is already configured in wrangler.toml.");
    }

    // --- STEP 5: Bulk Upload Secrets to Cloudflare ---
    console.log("\n[5/6] Uploading secrets to Cloudflare Workers...");
    const tempSecretsPath = path.join(ROOT_DIR, `.secrets-${Date.now()}.tmp.json`);
    try {
        const secretsPayload = {
            PROXY_API_KEY: masterApiKey,
            ACCOUNTS: JSON.stringify(accounts)
        };
        fs.writeFileSync(tempSecretsPath, JSON.stringify(secretsPayload));

        execSync(`npx wrangler secret bulk "${tempSecretsPath}"`, { stdio: "inherit" });
        console.log("   [OK] Secrets (PROXY_API_KEY and ACCOUNTS) uploaded successfully.");
    } catch (secErr: any) {
        console.error("   Error: Failed to upload secrets:", secErr.message);
        process.exit(1);
    } finally {
        if (fs.existsSync(tempSecretsPath)) {
            fs.unlinkSync(tempSecretsPath);
        }
    }

    // --- STEP 6: Deploy Worker and Static Assets ---
    console.log("\n[6/6] Deploying Worker and Static Assets to Cloudflare...");
    let deployOutput = "";
    try {
        deployOutput = execSync("npx wrangler deploy", { encoding: "utf-8" });
        console.log(deployOutput);
    } catch (depErr: any) {
        console.error("Error: Deployment failed:", depErr.message);
        if (depErr.stdout) console.log(depErr.stdout);
        process.exit(1);
    }

    const urlMatch = deployOutput.match(/https:\/\/[a-zA-Z0-9.-]+\.workers\.dev/);
    const workerUrl = urlMatch ? urlMatch[0] : "https://antigravity-proxy.workers.dev";

    // --- LIVE VERIFICATION ---
    console.log("\nExecuting health check on deployed worker...");
    try {
        const healthResp = await fetch(`${workerUrl}/health`);
        if (healthResp.ok) {
            const data = await healthResp.json() as any;
            console.log(`   [OK] Health check passed: status ${healthResp.status}, accounts in pool: ${data.totalAccounts}`);
        }
    } catch (e: any) {
        console.warn(`   Notice: Initial request status: ${e.message} (DNS propagation may take a few seconds)`);
    }

    // --- SUCCESS SUMMARY ---
    console.log("\n========================================================");
    console.log("   DEPLOYMENT COMPLETED SUCCESSFULLY");
    console.log("========================================================\n");
    console.log(`Web Dashboard & Chat:  ${workerUrl}`);
    console.log(`OpenAI API Base URL:   ${workerUrl}/v1`);
    console.log(`Master API Key:        ${masterApiKey}\n`);

    console.log("Client Configuration Presets:");
    console.log("--------------------------------------------------------");
    console.log("Cline / Cursor / Roo-Code:");
    console.log(`  Provider: OpenAI Compatible`);
    console.log(`  Base URL: ${workerUrl}/v1`);
    console.log(`  API Key:  ${masterApiKey}`);
    console.log(`  Model:    gemini-3.8-flash-tiered  OR  claude-sonnet-4-6\n`);

    console.log("NextChat / LibreChat / OpenWebUI:");
    console.log(`  API Endpoint: ${workerUrl}/v1`);
    console.log(`  API Key:      ${masterApiKey}\n`);
    console.log("========================================================\n");
}

main().catch(err => {
    console.error("Fatal deployment error:", err);
    process.exit(1);
});
