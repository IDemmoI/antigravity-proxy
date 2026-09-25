// Antigravity AI — Proxy & Web Chat Frontend Engine
(function () {
    // --- Application State ---
    const state = {
        theme: localStorage.getItem("antigravity_theme") || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"),
        apiKey: localStorage.getItem("antigravity_proxy_key") || "",
        models: [],
        selectedModel: "gemini-2.5-flash",
        thinkingLevel: "HIGH", // HIGH | MEDIUM | LOW | OFF
        searchGrounding: localStorage.getItem("antigravity_grounding") !== "false", // default: true
        mode: "chat", // chat | image
        messages: [],
        conversations: [],
        activeConversationId: localStorage.getItem("antigravity_active_conv_id") || null,
        currentAbortController: null,
        isGenerating: false,
        attachedImageBase64: null,
        attachedImageMime: null
    };

    // --- DOM Elements ---
    const dom = {
        btnToggleTheme: document.getElementById("btn-toggle-theme"),
        iconSun: document.querySelector(".icon-sun"),
        iconMoon: document.querySelector(".icon-moon"),

        btnToggleHistory: document.getElementById("btn-toggle-history"),
        btnNewChat: document.getElementById("btn-new-chat"),
        navHistoryCount: document.getElementById("nav-history-count"),
        drawerHistory: document.getElementById("drawer-history"),
        btnCloseHistory: document.getElementById("btn-close-history"),
        btnDrawerNewChat: document.getElementById("btn-drawer-new-chat"),
        historyList: document.getElementById("history-list"),
        historySearchInput: document.getElementById("history-search-input"),
        btnExportChats: document.getElementById("btn-export-chats"),
        btnClearAllHistory: document.getElementById("btn-clear-all-history"),

        proxyStatusDot: document.getElementById("status-dot"),
        proxyStatusText: document.getElementById("proxy-status-text"),
        navAccountsCount: document.getElementById("nav-accounts-count"),
        navKeyLabel: document.getElementById("nav-key-label"),
        
        selectModel: document.getElementById("select-model"),
        thinkingGroup: document.getElementById("thinking-control-group"),
        thinkingSegmented: document.getElementById("thinking-segmented"),
        searchGroup: document.getElementById("search-control-group"),
        searchSegmented: document.getElementById("search-segmented"),
        modeSegmented: document.getElementById("mode-segmented"),
        btnClearChat: document.getElementById("btn-clear-chat"),
        
        messagesContainer: document.getElementById("messages-container"),
        welcomeCard: document.getElementById("welcome-card"),
        
        promptInput: document.getElementById("prompt-input"),
        btnSend: document.getElementById("btn-send"),
        sendIcon: document.getElementById("send-icon"),
        stopIcon: document.getElementById("stop-icon"),
        
        fileInput: document.getElementById("file-input"),
        btnAttachImage: document.getElementById("btn-attach-image"),
        attachmentPreviewBar: document.getElementById("attachment-preview-bar"),
        attachmentImgPreview: document.getElementById("attachment-img-preview"),
        btnRemoveAttachment: document.getElementById("btn-remove-attachment"),
        
        btnToggleDashboard: document.getElementById("btn-toggle-dashboard"),
        drawerDashboard: document.getElementById("drawer-dashboard"),
        btnCloseDashboard: document.getElementById("btn-close-dashboard"),
        btnResetCooldowns: document.getElementById("btn-reset-cooldowns"),
        accountsList: document.getElementById("accounts-list"),
        statTotalAccounts: document.getElementById("stat-total-accounts"),
        statTotalRequests: document.getElementById("stat-total-requests"),
        statCooldownCount: document.getElementById("stat-cooldown-count"),
        statModelsCount: document.getElementById("stat-models-count"),
        
        btnOpenGuide: document.getElementById("btn-open-guide"),
        drawerGuide: document.getElementById("drawer-guide"),
        btnCloseGuide: document.getElementById("btn-close-guide"),
        guideBaseUrl: document.getElementById("guide-base-url"),
        guideApiKey: document.getElementById("guide-api-key"),
        guideCurlSnippet: document.getElementById("guide-curl-snippet"),
        drawerOverlay: document.getElementById("drawer-overlay"),
        
        btnOpenKeyModal: document.getElementById("btn-open-key-modal"),
        modalKeyBackdrop: document.getElementById("modal-key-backdrop"),
        inputMasterKey: document.getElementById("input-master-key"),
        btnToggleKeyVisibility: document.getElementById("btn-toggle-key-visibility"),
        btnCancelKey: document.getElementById("btn-cancel-key"),
        btnSaveKey: document.getElementById("btn-save-key"),
        btnCloseKeyModal: document.getElementById("btn-close-key-modal")
    };

    // --- Initialization ---
    async function init() {
        applyTheme(state.theme);
        setupEventListeners();
        setupDragAndDrop();
        setupClipboardPaste();
        updateKeyUI();
        updateGuideUrls();

        // Load conversation history from local storage
        loadConversationsFromStorage();
        if (state.activeConversationId) {
            const active = state.conversations.find(c => c.id === state.activeConversationId);
            if (active && active.messages && active.messages.length > 0) {
                switchConversation(active.id);
            } else {
                startNewChat();
            }
        } else if (state.conversations.length > 0) {
            switchConversation(state.conversations[0].id);
        } else {
            startNewChat();
        }

        // Check proxy connectivity and models
        await checkHealth();
        if (state.apiKey) {
            await Promise.all([loadModels(), loadAccountsStatus()]);
        } else {
            openKeyModal();
        }

        // Periodic account status polling (every 15s)
        setInterval(() => {
            if (state.apiKey) loadAccountsStatus();
        }, 15000);
    }

    // --- Theme Management ---
    function applyTheme(theme) {
        state.theme = theme;
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("antigravity_theme", theme);

        if (dom.iconSun && dom.iconMoon) {
            if (theme === "light") {
                dom.iconSun.style.display = "none";
                dom.iconMoon.style.display = "block";
            } else {
                dom.iconSun.style.display = "block";
                dom.iconMoon.style.display = "none";
            }
        }
    }

    function toggleTheme() {
        const nextTheme = state.theme === "dark" ? "light" : "dark";
        applyTheme(nextTheme);
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        // Theme toggle
        if (dom.btnToggleTheme) {
            dom.btnToggleTheme.addEventListener("click", toggleTheme);
        }

        // Model change
        dom.selectModel.addEventListener("change", (e) => {
            state.selectedModel = e.target.value;
            const isImg = state.selectedModel.includes("image") || state.selectedModel.includes("dall-e");
            if (isImg && state.mode !== "image") {
                setMode("image");
            }
        });

        // Thinking level segmented control
        dom.thinkingSegmented.addEventListener("click", (e) => {
            const btn = e.target.closest(".segment-btn");
            if (!btn) return;
            dom.thinkingSegmented.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            state.thinkingLevel = btn.dataset.level;
        });

        // Search grounding segmented control
        if (dom.searchSegmented) {
            dom.searchSegmented.querySelectorAll(".segment-btn").forEach(b => {
                b.classList.toggle("active", (b.dataset.search === "true") === state.searchGrounding);
            });
            dom.searchSegmented.addEventListener("click", (e) => {
                const btn = e.target.closest(".segment-btn");
                if (!btn) return;
                dom.searchSegmented.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                state.searchGrounding = btn.dataset.search === "true";
                localStorage.setItem("antigravity_grounding", String(state.searchGrounding));
            });
        }

        // Mode segmented control (Chat vs Image)
        dom.modeSegmented.addEventListener("click", (e) => {
            const btn = e.target.closest(".segment-btn");
            if (!btn) return;
            setMode(btn.dataset.mode);
        });

        // Clear chat
        dom.btnClearChat.addEventListener("click", clearChat);

        // Input textarea auto-resize and Enter submit
        dom.promptInput.addEventListener("input", autoResizeTextarea);
        dom.promptInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendClick();
            }
        });

        // Send / Stop button
        dom.btnSend.addEventListener("click", handleSendClick);

        // Image attachment
        dom.btnAttachImage.addEventListener("click", () => dom.fileInput.click());
        dom.fileInput.addEventListener("change", handleFileSelect);
        dom.btnRemoveAttachment.addEventListener("click", removeAttachment);

        // History & New Chat
        if (dom.btnToggleHistory) dom.btnToggleHistory.addEventListener("click", openHistory);
        if (dom.btnCloseHistory) dom.btnCloseHistory.addEventListener("click", closeDrawers);
        if (dom.btnNewChat) dom.btnNewChat.addEventListener("click", startNewChat);
        if (dom.btnDrawerNewChat) dom.btnDrawerNewChat.addEventListener("click", startNewChat);
        if (dom.btnExportChats) dom.btnExportChats.addEventListener("click", exportConversations);
        if (dom.btnClearAllHistory) dom.btnClearAllHistory.addEventListener("click", clearAllHistory);
        if (dom.historySearchInput) {
            dom.historySearchInput.addEventListener("input", (e) => {
                renderHistoryList(e.target.value.trim());
            });
        }

        // Drawers
        dom.btnToggleDashboard.addEventListener("click", openDashboard);
        dom.btnCloseDashboard.addEventListener("click", closeDrawers);
        dom.btnOpenGuide.addEventListener("click", openGuide);
        dom.btnCloseGuide.addEventListener("click", closeDrawers);
        dom.drawerOverlay.addEventListener("click", closeDrawers);
        dom.btnResetCooldowns.addEventListener("click", resetCooldowns);

        // Copy buttons
        document.querySelectorAll(".btn-copy").forEach(btn => {
            btn.addEventListener("click", () => {
                const targetId = btn.dataset.target;
                const input = document.getElementById(targetId);
                if (input) {
                    navigator.clipboard.writeText(input.value);
                    const originalText = btn.textContent;
                    btn.textContent = "Copied!";
                    setTimeout(() => btn.textContent = originalText, 1800);
                }
            });
        });

        document.querySelectorAll(".btn-copy-code").forEach(btn => {
            btn.addEventListener("click", () => {
                const targetId = btn.dataset.target;
                const code = document.getElementById(targetId);
                if (code) {
                    navigator.clipboard.writeText(code.textContent);
                    const originalText = btn.textContent;
                    btn.textContent = "Copied!";
                    setTimeout(() => btn.textContent = originalText, 1800);
                }
            });
        });

        // Key modal
        dom.btnOpenKeyModal.addEventListener("click", openKeyModal);
        dom.btnCloseKeyModal.addEventListener("click", closeKeyModal);
        dom.btnCancelKey.addEventListener("click", closeKeyModal);
        dom.btnSaveKey.addEventListener("click", saveKey);
        dom.btnToggleKeyVisibility.addEventListener("click", toggleKeyVisibility);

        // Welcome prompt chips
        document.querySelectorAll(".prompt-chip").forEach(chip => {
            chip.addEventListener("click", () => {
                dom.promptInput.value = chip.dataset.prompt;
                autoResizeTextarea();
                dom.promptInput.focus();
            });
        });
    }

    function setMode(newMode) {
        state.mode = newMode;
        dom.modeSegmented.querySelectorAll(".segment-btn").forEach(b => {
            b.classList.toggle("active", b.dataset.mode === newMode);
        });

        if (newMode === "image") {
            dom.thinkingGroup.style.display = "none";
            dom.promptInput.placeholder = "Describe the image you want to generate... (DALL-E / Gemini Flash Image)";
        } else {
            dom.thinkingGroup.style.display = "flex";
            dom.promptInput.placeholder = "Ask anything or paste an image... (Enter to send, Shift+Enter for newline)";
        }
    }

    // --- Drag & Drop and Clipboard Image Handling ---
    function setupDragAndDrop() {
        const viewport = document.querySelector(".chat-viewport");
        viewport.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        viewport.addEventListener("drop", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                if (file.type.startsWith("image/")) {
                    processImageFile(file);
                }
            }
        });
    }

    function setupClipboardPaste() {
        document.addEventListener("paste", (e) => {
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            for (const item of items) {
                if (item.kind === "file" && item.type.startsWith("image/")) {
                    const file = item.getAsFile();
                    processImageFile(file);
                    break;
                }
            }
        });
    }

    function handleFileSelect(e) {
        if (e.target.files && e.target.files.length > 0) {
            processImageFile(e.target.files[0]);
        }
    }

    function processImageFile(file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            state.attachedImageBase64 = event.target.result;
            state.attachedImageMime = file.type || "image/jpeg";
            dom.attachmentImgPreview.src = state.attachedImageBase64;
            dom.attachmentPreviewBar.style.display = "flex";
        };
        reader.readAsDataURL(file);
    }

    function removeAttachment() {
        state.attachedImageBase64 = null;
        state.attachedImageMime = null;
        dom.attachmentPreviewBar.style.display = "none";
        dom.attachmentImgPreview.src = "";
        dom.fileInput.value = "";
    }

    // --- Health & Account Status API Calls ---
    async function checkHealth() {
        try {
            const resp = await fetch("/health");
            if (resp.ok) {
                dom.proxyStatusDot.className = "status-dot pulsing";
                dom.proxyStatusText.textContent = "Online";
            } else {
                throw new Error();
            }
        } catch {
            dom.proxyStatusDot.className = "status-dot offline";
            dom.proxyStatusText.textContent = "Offline";
        }
    }

    async function loadModels() {
        if (!state.apiKey) return;
        try {
            const resp = await fetch("/v1/models", {
                headers: { "Authorization": `Bearer ${state.apiKey}` }
            });
            if (resp.ok) {
                const data = await resp.json();
                state.models = data.data || [];
                renderModelOptions();
                dom.statModelsCount.textContent = state.models.length;
            }
        } catch (e) {
            console.error("Failed to load models:", e);
        }
    }

    function renderModelOptions() {
        dom.selectModel.innerHTML = "";
        const preferred = [
            "gemini-2.5-flash",
            "gemini-3.8-flash-tiered",
            "gemini-3.7-flash-tiered",
            "gemini-2.5-pro",
            "claude-sonnet-4-6",
            "claude-opus-4-6-thinking",
            "gemini-3.1-flash-image",
            "dall-e-3"
        ];

        // Group into Featured and All
        const featuredGroup = document.createElement("optgroup");
        featuredGroup.label = "Featured Models";

        const allGroup = document.createElement("optgroup");
        allGroup.label = "All Discovered Models";

        const modelIds = state.models.map(m => m.id);
        const added = new Set();

        for (const pref of preferred) {
            if (modelIds.includes(pref)) {
                const opt = document.createElement("option");
                opt.value = pref;
                opt.textContent = pref;
                featuredGroup.appendChild(opt);
                added.add(pref);
            }
        }

        for (const model of state.models) {
            if (!added.has(model.id)) {
                const opt = document.createElement("option");
                opt.value = model.id;
                opt.textContent = model.id;
                allGroup.appendChild(opt);
            }
        }

        if (featuredGroup.children.length > 0) dom.selectModel.appendChild(featuredGroup);
        if (allGroup.children.length > 0) dom.selectModel.appendChild(allGroup);

        // Select default
        if (modelIds.includes("gemini-2.5-flash")) {
            dom.selectModel.value = "gemini-2.5-flash";
        } else if (modelIds.length > 0) {
            dom.selectModel.value = modelIds[0];
        }
        state.selectedModel = dom.selectModel.value;
    }

    async function loadAccountsStatus() {
        if (!state.apiKey) return;
        try {
            const resp = await fetch("/v1/accounts", {
                headers: { "Authorization": `Bearer ${state.apiKey}` }
            });
            if (resp.ok) {
                const data = await resp.json();
                renderAccounts(data);
            }
        } catch (e) {
            console.error("Failed to load accounts status:", e);
        }
    }

    function renderAccounts(data) {
        const total = data.totalAccounts || 0;
        const accounts = data.accounts || [];
        
        dom.navAccountsCount.textContent = `${total} ${total === 1 ? 'account' : 'accounts'}`;
        dom.statTotalAccounts.textContent = total;

        let totalReqs = 0;
        let cooldownCount = 0;

        dom.accountsList.innerHTML = "";

        if (accounts.length === 0) {
            dom.accountsList.innerHTML = `<div class="empty-hint">No accounts configured yet. Run <code>npm run login</code> in your console.</div>`;
            return;
        }

        accounts.forEach(acc => {
            totalReqs += acc.totalRequests || 0;
            if (acc.isRateLimited) cooldownCount++;

            const card = document.createElement("div");
            card.className = "account-card";

            const badgeClass = acc.isRateLimited ? "cooldown" : "active";
            const badgeText = acc.isRateLimited ? `Cooldown (${acc.cooldownSecondsRemaining}s)` : "Active";

            card.innerHTML = `
                <div class="account-card-header">
                    <span class="account-email">${escapeHtml(acc.email)}</span>
                    <span class="account-badge ${badgeClass}">${badgeText}</span>
                </div>
                <div class="account-meta">
                    <span>Project: <code>${escapeHtml(acc.projectId)}</code></span>
                    <span>Requests: <strong>${acc.totalRequests || 0}</strong></span>
                </div>
            `;
            dom.accountsList.appendChild(card);
        });

        dom.statTotalRequests.textContent = totalReqs;
        dom.statCooldownCount.textContent = cooldownCount;
    }

    async function resetCooldowns() {
        if (!state.apiKey) return;
        try {
            const resp = await fetch("/v1/accounts/reset", {
                method: "POST",
                headers: { "Authorization": `Bearer ${state.apiKey}` }
            });
            if (resp.ok) {
                await loadAccountsStatus();
                alert("All account cooldowns have been reset successfully!");
            }
        } catch (e) {
            alert("Failed to reset cooldowns: " + e.message);
        }
    }

    // --- Chat & Image Generation Handler ---
    function handleSendClick() {
        if (state.isGenerating) {
            stopGeneration();
        } else {
            sendMessage();
        }
    }

    function stopGeneration() {
        if (state.currentAbortController) {
            state.currentAbortController.abort();
            state.currentAbortController = null;
        }
        setGeneratingState(false);
    }

    function setGeneratingState(isGen) {
        state.isGenerating = isGen;
        if (isGen) {
            dom.sendIcon.style.display = "none";
            dom.stopIcon.style.display = "block";
            dom.btnSend.style.background = "var(--accent-rose)";
            dom.btnSend.title = "Stop generation";
        } else {
            dom.sendIcon.style.display = "block";
            dom.stopIcon.style.display = "none";
            dom.btnSend.style.background = "";
            dom.btnSend.title = "Send message";
        }
    }

    async function sendMessage() {
        const text = dom.promptInput.value.trim();
        const attachedImg = state.attachedImageBase64;

        if (!text && !attachedImg) return;
        if (!state.apiKey) {
            openKeyModal();
            return;
        }

        // Hide welcome card
        if (dom.welcomeCard) {
            dom.welcomeCard.style.display = "none";
        }

        // Clear input & remove attachment
        dom.promptInput.value = "";
        autoResizeTextarea();
        removeAttachment();

        // 1. Render User Message in UI
        renderUserMessage(text, attachedImg);

        if (!state.activeConversationId) {
            initNewConversation(text);
        }

        // 2. Route by Mode: Image Generation vs Chat
        if (state.mode === "image" || state.selectedModel.includes("image") || state.selectedModel.includes("dall-e")) {
            await handleImageGeneration(text);
        } else {
            await handleChatCompletion(text, attachedImg);
        }
    }

    // --- Chat Completion (Streaming) ---
    async function handleChatCompletion(text, attachedImg) {
        setGeneratingState(true);
        state.currentAbortController = new AbortController();

        // Prepare message payload
        let userContent = text;
        if (attachedImg) {
            userContent = [
                { type: "text", text: text || "Please analyze and describe this image in detail." },
                { type: "image_url", image_url: { url: attachedImg } }
            ];
        }

        state.messages.push({ role: "user", content: userContent });

        // Prepare Assistant message container in DOM
        const assistantMsgEl = createAssistantMessageElement(state.selectedModel);
        dom.messagesContainer.appendChild(assistantMsgEl);
        scrollToBottom();

        const thinkingBlock = assistantMsgEl.querySelector(".thinking-block");
        const thinkingContent = assistantMsgEl.querySelector(".thinking-content");
        const thinkingTime = assistantMsgEl.querySelector(".thinking-time");
        const markdownBody = assistantMsgEl.querySelector(".markdown-body");

        let rawResponse = "";
        let isThinking = false;
        let thinkingText = "";
        let answerText = "";
        const startTime = Date.now();

        try {
            // Build model string with thinking tier if applicable
            let requestModel = state.selectedModel;
            const reasoningEffort = state.thinkingLevel !== "OFF" ? state.thinkingLevel.toLowerCase() : undefined;

            const resp = await fetch("/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${state.apiKey}`
                },
                body: JSON.stringify({
                    model: requestModel,
                    messages: state.messages,
                    stream: true,
                    reasoning_effort: reasoningEffort,
                    grounding: state.searchGrounding
                }),
                signal: state.currentAbortController.signal
            });

            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.error?.message || `Server error (${resp.status})`);
            }

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === "data: [DONE]") continue;

                    if (trimmed.startsWith("data: ")) {
                        try {
                            const json = JSON.parse(trimmed.substring(6));
                            const deltaObj = json.choices?.[0]?.delta || {};
                            let delta = deltaObj.content || "";
                            const reasoning = deltaObj.reasoning_content || "";

                            // If server provided reasoning_content explicitly
                            if (reasoning) {
                                if (thinkingBlock.style.display === "none") {
                                    thinkingBlock.style.display = "block";
                                    thinkingBlock.classList.add("expanded");
                                }
                                thinkingText += reasoning;
                                thinkingContent.textContent = thinkingText;
                                const elapsed = Math.round((Date.now() - startTime) / 1000);
                                thinkingTime.textContent = `(${elapsed}s)`;
                            }

                            if (!delta) continue;
                            rawResponse += delta;

                            // Handle opening <think> tag
                            if (delta.includes("<think>")) {
                                const openParts = delta.split("<think>");
                                if (openParts[0]) {
                                    answerText += openParts[0];
                                }
                                isThinking = true;
                                thinkingBlock.style.display = "block";
                                thinkingBlock.classList.add("expanded");
                                delta = openParts.slice(1).join("<think>");
                            }

                            if (isThinking) {
                                if (delta.includes("</think>")) {
                                    const closeParts = delta.split("</think>");
                                    thinkingText += closeParts[0];
                                    thinkingContent.textContent = thinkingText;
                                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                                    thinkingTime.textContent = `(${elapsed}s)`;

                                    isThinking = false;
                                    thinkingBlock.classList.remove("expanded"); // collapse thinking once finished

                                    // Crucial fix: any text after </think> belongs to the actual answer!
                                    const remainder = closeParts.slice(1).join("</think>");
                                    if (remainder) {
                                        answerText += remainder;
                                        markdownBody.innerHTML = renderMarkdown(answerText) + '<span class="typing-cursor"></span>';
                                    }
                                } else {
                                    thinkingText += delta;
                                    thinkingContent.textContent = thinkingText;
                                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                                    thinkingTime.textContent = `(${elapsed}s)`;
                                }
                            } else {
                                const clean = delta.replace(/<\/?think>/g, "");
                                if (clean) {
                                    answerText += clean;
                                    markdownBody.innerHTML = renderMarkdown(answerText) + '<span class="typing-cursor"></span>';
                                }
                            }

                            scrollToBottom();
                        } catch {}
                    }
                }
            }

            // Remove typing cursor and render final response
            markdownBody.innerHTML = renderMarkdown(answerText || rawResponse);
            state.messages.push({ role: "assistant", content: rawResponse });

            // Attach copy code buttons
            attachCodeCopyHandlers(markdownBody);

            // Save active conversation
            saveActiveConversation();

        } catch (err) {
            if (err.name === "AbortError") {
                markdownBody.innerHTML += '<p class="text-warning"><em>[Generation stopped by user]</em></p>';
            } else {
                markdownBody.innerHTML = `<p class="text-rose"><strong>Error:</strong> ${escapeHtml(err.message)}</p>`;
            }
        } finally {
            setGeneratingState(false);
            state.currentAbortController = null;
            scrollToBottom();
        }
    }

    // --- Image Generation Mode ---
    async function handleImageGeneration(prompt) {
        setGeneratingState(true);
        state.currentAbortController = new AbortController();

        const assistantMsgEl = createAssistantMessageElement("gemini-3.1-flash-image");
        dom.messagesContainer.appendChild(assistantMsgEl);
        scrollToBottom();

        const markdownBody = assistantMsgEl.querySelector(".markdown-body");
        markdownBody.innerHTML = `<p class="text-secondary">Generating image: <em>"${escapeHtml(prompt)}"</em>...</p>`;

        try {
            const resp = await fetch("/v1/images/generations", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${state.apiKey}`
                },
                body: JSON.stringify({
                    prompt: prompt,
                    model: "gemini-3.1-flash-image"
                }),
                signal: state.currentAbortController.signal
            });

            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.error?.message || `Server error (${resp.status})`);
            }

            const data = await resp.json();
            const b64 = data.data?.[0]?.b64_json;
            if (!b64) throw new Error("No image data returned from provider");

            const imgSrc = `data:image/jpeg;base64,${b64}`;

            markdownBody.innerHTML = `
                <div class="generated-image-card">
                    <img src="${imgSrc}" alt="${escapeHtml(prompt)}" title="Click to download">
                    <div class="generated-image-actions">
                        <a href="${imgSrc}" download="antigravity-ai-${Date.now()}.jpg" class="btn btn-secondary btn-xs">
                            Download JPEG
                        </a>
                    </div>
                </div>
            `;

            state.messages.push({
                role: "assistant",
                content: `[Generated Image: ${prompt}]`
            });

            // Save active conversation
            saveActiveConversation();

        } catch (err) {
            if (err.name === "AbortError") {
                markdownBody.innerHTML = '<p class="text-warning"><em>[Generation cancelled]</em></p>';
            } else {
                markdownBody.innerHTML = `<p class="text-rose"><strong>Generation Error:</strong> ${escapeHtml(err.message)}</p>`;
            }
        } finally {
            setGeneratingState(false);
            state.currentAbortController = null;
            scrollToBottom();
        }
    }

    // --- DOM Message Elements Rendering ---
    function renderUserMessage(text, attachedImg) {
        const row = document.createElement("div");
        row.className = "message-row user";

        let imgHtml = "";
        if (attachedImg) {
            imgHtml = `<img class="message-attached-image" src="${attachedImg}" alt="Attached preview">`;
        }

        row.innerHTML = `
            <div class="message-body">
                <div class="message-bubble">
                    ${imgHtml}
                    <div>${escapeHtml(text)}</div>
                </div>
            </div>
            <div class="message-avatar user">Me</div>
        `;
        dom.messagesContainer.appendChild(row);
        scrollToBottom();
    }

    function createAssistantMessageElement(modelName) {
        const row = document.createElement("div");
        row.className = "message-row assistant";
        row.innerHTML = `
            <div class="message-avatar assistant">AI</div>
            <div class="message-body">
                <div class="message-meta">
                    <span class="model-tag">${escapeHtml(modelName)}</span>
                </div>
                <div class="message-bubble">
                    <!-- Thinking accordion -->
                    <div class="thinking-block" style="display: none;">
                        <div class="thinking-header">
                            <span class="thinking-title">
                                Thought Process <span class="thinking-time"></span>
                            </span>
                            <span class="thinking-chevron">▼</span>
                        </div>
                        <div class="thinking-content"></div>
                    </div>
                    <!-- Final markdown answer -->
                    <div class="markdown-body">
                        <span class="typing-cursor"></span>
                    </div>
                </div>
            </div>
        `;

        // Add accordion toggle listener
        const header = row.querySelector(".thinking-header");
        const block = row.querySelector(".thinking-block");
        header.addEventListener("click", () => {
            block.classList.toggle("expanded");
        });

        return row;
    }

    // --- Conversation History & Session Management ---
    function loadConversationsFromStorage() {
        try {
            const raw = localStorage.getItem("antigravity_conversations");
            state.conversations = raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.warn("Failed to load conversations:", e);
            state.conversations = [];
        }
        updateHistoryBadge();
    }

    function saveConversationsToStorage() {
        try {
            localStorage.setItem("antigravity_conversations", JSON.stringify(state.conversations));
            if (state.activeConversationId) {
                localStorage.setItem("antigravity_active_conv_id", state.activeConversationId);
            }
        } catch (e) {
            console.warn("Storage quota exceeded, pruning oldest conversation:", e);
            if (state.conversations.length > 1) {
                state.conversations.pop();
                saveConversationsToStorage();
            }
        }
        updateHistoryBadge();
    }

    function updateHistoryBadge() {
        if (!dom.navHistoryCount) return;
        const count = (state.conversations || []).length;
        dom.navHistoryCount.textContent = count;
        dom.navHistoryCount.style.display = count > 0 ? "inline-flex" : "none";
    }

    function initNewConversation(firstPrompt) {
        const now = Date.now();
        state.activeConversationId = "conv-" + now + "-" + Math.random().toString(36).substring(2, 7);
        const title = (typeof firstPrompt === "string" ? firstPrompt.trim() : "New Chat").split("\n")[0].substring(0, 36) || "New Chat";

        const newConv = {
            id: state.activeConversationId,
            title,
            model: state.selectedModel,
            createdAt: now,
            updatedAt: now,
            messages: []
        };
        state.conversations.unshift(newConv);
        saveConversationsToStorage();
        renderHistoryList();
    }

    function saveActiveConversation() {
        if (!state.activeConversationId) {
            const firstUser = state.messages.find(m => m.role === "user");
            const firstText = firstUser ? (typeof firstUser.content === "string" ? firstUser.content : firstUser.content?.[0]?.text) : "Conversation";
            initNewConversation(firstText);
        }

        let conv = state.conversations.find(c => c.id === state.activeConversationId);
        const now = Date.now();
        if (conv) {
            conv.messages = JSON.parse(JSON.stringify(state.messages));
            conv.updatedAt = now;
            conv.model = state.selectedModel;
            // Move updated conversation to top of list
            state.conversations = [conv, ...state.conversations.filter(c => c.id !== conv.id)];
        }
        saveConversationsToStorage();
        renderHistoryList();
    }

    function startNewChat() {
        if (state.isGenerating) stopGeneration();
        state.activeConversationId = null;
        localStorage.removeItem("antigravity_active_conv_id");
        state.messages = [];
        dom.messagesContainer.innerHTML = "";
        if (dom.welcomeCard) {
            dom.messagesContainer.appendChild(dom.welcomeCard);
            dom.welcomeCard.style.display = "block";
        }
        renderHistoryList();
        closeDrawers();
        dom.promptInput.focus();
    }

    function switchConversation(id) {
        if (state.isGenerating) stopGeneration();
        const conv = state.conversations.find(c => c.id === id);
        if (!conv) return;

        state.activeConversationId = conv.id;
        localStorage.setItem("antigravity_active_conv_id", conv.id);
        state.messages = JSON.parse(JSON.stringify(conv.messages || []));

        if (conv.model) {
            state.selectedModel = conv.model;
            if (dom.selectModel) dom.selectModel.value = conv.model;
        }

        renderFullConversation(state.messages, conv.model);
        renderHistoryList();
        closeDrawers();
    }

    function renderFullConversation(messages, modelName) {
        dom.messagesContainer.innerHTML = "";
        if (!messages || messages.length === 0) {
            if (dom.welcomeCard) {
                dom.messagesContainer.appendChild(dom.welcomeCard);
                dom.welcomeCard.style.display = "block";
            }
            return;
        }

        if (dom.welcomeCard) {
            dom.welcomeCard.style.display = "none";
        }

        messages.forEach(msg => {
            if (msg.role === "user") {
                let userText = "";
                let userImg = null;
                if (typeof msg.content === "string") {
                    userText = msg.content;
                } else if (Array.isArray(msg.content)) {
                    const textObj = msg.content.find(i => i.type === "text");
                    const imgObj = msg.content.find(i => i.type === "image_url");
                    userText = textObj?.text || "";
                    userImg = imgObj?.image_url?.url || null;
                }
                renderUserMessage(userText, userImg);
            } else if (msg.role === "assistant") {
                const el = createAssistantMessageElement(modelName || state.selectedModel);
                const markdownBody = el.querySelector(".markdown-body");
                const thinkingBlock = el.querySelector(".thinking-block");
                const thinkingContent = el.querySelector(".thinking-content");

                const raw = msg.content || "";
                if (raw.includes("<think>")) {
                    const parts = raw.split("</think>");
                    const thoughtText = parts[0].replace("<think>", "").trim();
                    const answerText = parts.slice(1).join("</think>").trim();
                    if (thoughtText) {
                        thinkingBlock.style.display = "block";
                        thinkingContent.textContent = thoughtText;
                    }
                    markdownBody.innerHTML = renderMarkdown(answerText);
                } else {
                    markdownBody.innerHTML = renderMarkdown(raw);
                }
                attachCodeCopyHandlers(markdownBody);
                dom.messagesContainer.appendChild(el);
            }
        });

        scrollToBottom();
    }

    function deleteConversation(id, e) {
        if (e) e.stopPropagation();
        if (!confirm("Are you sure you want to delete this conversation?")) return;

        state.conversations = state.conversations.filter(c => c.id !== id);
        saveConversationsToStorage();

        if (state.activeConversationId === id) {
            if (state.conversations.length > 0) {
                switchConversation(state.conversations[0].id);
            } else {
                startNewChat();
            }
        } else {
            renderHistoryList();
        }
    }

    function renameConversation(id, e) {
        if (e) e.stopPropagation();
        const conv = state.conversations.find(c => c.id === id);
        if (!conv) return;

        const newTitle = prompt("Enter conversation title:", conv.title);
        if (newTitle && newTitle.trim()) {
            conv.title = newTitle.trim();
            conv.updatedAt = Date.now();
            saveConversationsToStorage();
            renderHistoryList();
        }
    }

    function exportConversations() {
        if (!state.conversations || state.conversations.length === 0) {
            alert("No conversations to export.");
            return;
        }
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.conversations, null, 2));
        const dlAnchor = document.createElement("a");
        dlAnchor.setAttribute("href", dataStr);
        dlAnchor.setAttribute("download", `antigravity_chats_${new Date().toISOString().slice(0, 10)}.json`);
        document.body.appendChild(dlAnchor);
        dlAnchor.click();
        dlAnchor.remove();
    }

    function clearAllHistory() {
        if (!confirm("Are you sure you want to delete ALL saved conversations? This cannot be undone.")) return;
        state.conversations = [];
        saveConversationsToStorage();
        startNewChat();
    }

    function renderHistoryList(filterQuery = "") {
        if (!dom.historyList) return;
        dom.historyList.innerHTML = "";

        let list = state.conversations || [];
        if (filterQuery) {
            const q = filterQuery.toLowerCase();
            list = list.filter(c => 
                (c.title && c.title.toLowerCase().includes(q)) || 
                (c.messages && c.messages.some(m => (typeof m.content === "string" ? m.content : "").toLowerCase().includes(q)))
            );
        }

        if (list.length === 0) {
            dom.historyList.innerHTML = `<div class="empty-hint">${filterQuery ? "No matching conversations found." : "No saved conversations yet. Start a chat and it will appear here."}</div>`;
            return;
        }

        list.forEach(conv => {
            const card = document.createElement("div");
            card.className = "history-card" + (conv.id === state.activeConversationId ? " active" : "");
            
            const dateStr = formatHistoryDate(conv.updatedAt || conv.createdAt);
            const msgCount = (conv.messages || []).length;
            const modelShort = (conv.model || "gemini").replace("-tiered", "").replace("gemini-", "g-");

            card.innerHTML = `
                <div class="history-card-header">
                    <span class="history-card-title" title="${escapeHtml(conv.title)}">${escapeHtml(conv.title)}</span>
                    <div class="history-card-actions">
                        <button class="btn-icon btn-xs btn-rename-conv" title="Rename title" data-id="${conv.id}">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 20h9"></path>
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                            </svg>
                        </button>
                        <button class="btn-icon btn-xs text-rose btn-delete-conv" title="Delete conversation" data-id="${conv.id}">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="history-card-meta">
                    <span>${dateStr} · ${msgCount} msgs</span>
                    <span class="history-card-badge">${escapeHtml(modelShort)}</span>
                </div>
            `;

            card.addEventListener("click", () => switchConversation(conv.id));

            const btnRename = card.querySelector(".btn-rename-conv");
            if (btnRename) btnRename.addEventListener("click", (e) => renameConversation(conv.id, e));

            const btnDelete = card.querySelector(".btn-delete-conv");
            if (btnDelete) btnDelete.addEventListener("click", (e) => deleteConversation(conv.id, e));

            dom.historyList.appendChild(card);
        });
    }

    function formatHistoryDate(timestamp) {
        if (!timestamp) return "";
        const now = Date.now();
        const diff = now - timestamp;
        if (diff < 60000) return "Just now";
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        const d = new Date(timestamp);
        return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }

    function clearChat() {
        if (confirm("Are you sure you want to clear this conversation?")) {
            state.messages = [];
            dom.messagesContainer.innerHTML = "";
            if (dom.welcomeCard) {
                dom.messagesContainer.appendChild(dom.welcomeCard);
                dom.welcomeCard.style.display = "block";
            }
            if (state.activeConversationId) {
                const conv = state.conversations.find(c => c.id === state.activeConversationId);
                if (conv) {
                    conv.messages = [];
                    conv.updatedAt = Date.now();
                    saveConversationsToStorage();
                    renderHistoryList();
                }
            }
        }
    }

    function scrollToBottom() {
        dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
    }

    function autoResizeTextarea() {
        dom.promptInput.style.height = "auto";
        dom.promptInput.style.height = Math.min(dom.promptInput.scrollHeight, 160) + "px";
    }

    // --- Simple Markdown & Code Block Renderer ---
    function renderMarkdown(text) {
        if (!text) return "";

        let html = escapeHtml(text);

        // Code blocks: ```lang ... ```
        html = html.replace(/```([a-zA-Z0-9_\-+]*)\n([\s\S]*?)```/g, (match, lang, code) => {
            const langLabel = lang || "code";
            return `
                <div class="code-block-wrapper">
                    <div class="code-block-header">
                        <span>${langLabel}</span>
                        <button class="btn btn-ghost btn-xs btn-copy-inline">Copy</button>
                    </div>
                    <pre><code>${code.trim()}</code></pre>
                </div>
            `;
        });

        // Inline code: `code`
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Bold: **text**
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Italic: *text*
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        // Headers: ### Header
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

        // Line breaks into paragraphs
        const paragraphs = html.split("\n\n").map(p => {
            if (p.startsWith("<div class=\"code-block-wrapper\"") || p.startsWith("<h")) return p;
            return `<p>${p.replace(/\n/g, "<br>")}</p>`;
        });

        return paragraphs.join("");
    }

    function attachCodeCopyHandlers(container) {
        container.querySelectorAll(".btn-copy-inline").forEach(btn => {
            btn.addEventListener("click", () => {
                const codeEl = btn.closest(".code-block-wrapper").querySelector("code");
                if (codeEl) {
                    navigator.clipboard.writeText(codeEl.textContent);
                    const original = btn.textContent;
                    btn.textContent = "Copied!";
                    setTimeout(() => btn.textContent = original, 1600);
                }
            });
        });
    }

    // --- Drawers & Modals ---
    function openHistory() {
        closeDrawers();
        renderHistoryList();
        if (dom.drawerHistory) dom.drawerHistory.classList.add("open");
        if (dom.drawerOverlay) dom.drawerOverlay.classList.add("visible");
        if (dom.historySearchInput) {
            dom.historySearchInput.value = "";
            dom.historySearchInput.focus();
        }
    }

    function openDashboard() {
        closeDrawers();
        dom.drawerDashboard.classList.add("open");
        dom.drawerOverlay.classList.add("visible");
        loadAccountsStatus();
    }

    function openGuide() {
        closeDrawers();
        updateGuideUrls();
        dom.drawerGuide.classList.add("open");
        dom.drawerOverlay.classList.add("visible");
    }

    function closeDrawers() {
        if (dom.drawerDashboard) dom.drawerDashboard.classList.remove("open");
        if (dom.drawerGuide) dom.drawerGuide.classList.remove("open");
        if (dom.drawerHistory) dom.drawerHistory.classList.remove("open");
        if (dom.drawerOverlay) dom.drawerOverlay.classList.remove("visible");
    }

    function updateGuideUrls() {
        const origin = window.location.origin;
        const v1Url = `${origin}/v1`;
        if (dom.guideBaseUrl) dom.guideBaseUrl.value = v1Url;
        if (dom.guideApiKey) dom.guideApiKey.value = state.apiKey || "your-proxy-key";

        document.querySelectorAll(".dynamic-url").forEach(el => {
            el.textContent = v1Url;
        });

        if (dom.guideCurlSnippet) {
            dom.guideCurlSnippet.textContent = `curl "${v1Url}/chat/completions" \\
  -H "Authorization: Bearer ${state.apiKey || 'YOUR_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;
        }
    }

    function openKeyModal() {
        dom.inputMasterKey.value = state.apiKey;
        dom.modalKeyBackdrop.style.display = "flex";
        dom.inputMasterKey.focus();
    }

    function closeKeyModal() {
        dom.modalKeyBackdrop.style.display = "none";
    }

    function saveKey() {
        const key = dom.inputMasterKey.value.trim();
        state.apiKey = key;
        localStorage.setItem("antigravity_proxy_key", key);
        updateKeyUI();
        closeKeyModal();
        loadModels();
        loadAccountsStatus();
    }

    function toggleKeyVisibility() {
        if (dom.inputMasterKey.type === "password") {
            dom.inputMasterKey.type = "text";
        } else {
            dom.inputMasterKey.type = "password";
        }
    }

    function updateKeyUI() {
        if (state.apiKey) {
            dom.navKeyLabel.textContent = "Key Set";
            dom.navKeyLabel.parentElement.classList.remove("btn-primary");
            dom.navKeyLabel.parentElement.classList.add("btn-secondary");
        } else {
            dom.navKeyLabel.textContent = "Set API Key";
            dom.navKeyLabel.parentElement.classList.remove("btn-secondary");
            dom.navKeyLabel.parentElement.classList.add("btn-primary");
        }
    }

    // --- Helpers ---
    function escapeHtml(str) {
        if (!str) return "";
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Start App
    window.addEventListener("DOMContentLoaded", init);
})();
