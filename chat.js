(() => {
  "use strict";

  const STORAGE_KEY = "fcc_chat_history_v2";

  const state = {
    messages: [],
    model: "nemotron-3-super-120b",
    mode: "claude_code",
    agentMode: "auto", // "auto" | "architect" | "coder" | "reviewer"
    activeRepo: {
      name: "Workspace Root",
      path: "/workspace",
      branch: "master",
      clean: true,
      modifiedCount: 0,
    },
    repos: [],
    github: {
      connected: false,
      user: null,
      repos: [],
      loading: false,
      filter: "",
    },
    pendingAttachments: [], // [{ name, type, size, data, text }]
    busy: false,
  };

  const byId = (id) => document.getElementById(id);

  function loadSavedMessages() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state.messages = JSON.parse(raw);
      }
    } catch {}
  }

  function saveMessages() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.messages));
    } catch {}
  }

  async function api(path, options = {}) {
    const backendUrl = (localStorage.getItem("fcc_backend_url") || "").trim();
    let fullUrl = path;
    if (backendUrl && path.startsWith("/api/")) {
      fullUrl = backendUrl.replace(/\/+$/, "") + path;
    }
    const res = await fetch(fullUrl, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // response was not JSON (e.g. static 404 or 405 error page)
    }
    if (!res.ok) {
      let msg = data?.error || data?.detail;
      if (!msg) {
        if (res.status === 405) {
          msg = "HTTP 405: Static host does not support POST requests without a backend server.";
        } else if (res.status === 404) {
          msg = `HTTP 404: Endpoint ${path} not found.`;
        } else {
          msg = `HTTP ${res.status}`;
        }
      }
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data !== null ? data : { text };
  }

  // ==========================================
  // Fetch Repositories & GitHub Status
  // ==========================================
  async function fetchRepos() {
    try {
      const data = await api("/api/agent/repos");
      state.repos = data.repos || [];
      if (data.activeRepo) {
        state.activeRepo = data.activeRepo;
      }
      updateRepoBarUI();
    } catch (err) {
      console.error("Failed to fetch repos:", err);
    }
  }

  async function fetchGitHubStatus() {
    try {
      const data = await api("/api/github/status");
      state.github.connected = data.connected;
      state.github.user = data.user;
      if (data.connected) {
        loadGitHubRepos();
      }
    } catch (err) {
      console.error("Failed to check GitHub status:", err);
    }
  }

  async function loadGitHubRepos() {
    try {
      state.github.loading = true;
      const data = await api("/api/github/repos");
      if (data.success && data.repos) {
        state.github.repos = data.repos;
      }
    } catch (err) {
      console.error("Failed to load GitHub repos:", err);
    } finally {
      state.github.loading = false;
      renderGitHubSectionInDialog();
    }
  }

  function updateRepoBarUI() {
    const nameEl = byId("activeRepoName");
    const branchEl = byId("activeRepoBranch");
    const statusEl = byId("activeRepoStatus");
    const routerText = byId("currentAgentRouteText");

    if (nameEl) nameEl.textContent = state.activeRepo.name || state.activeRepo.path;
    if (branchEl) {
      branchEl.textContent = state.activeRepo.branch || "workspace";
      branchEl.style.display = state.activeRepo.isGit ? "inline-block" : "none";
    }
    if (statusEl) {
      if (state.activeRepo.clean) {
        statusEl.textContent = "clean";
        statusEl.className = "repo-pill-tag clean";
      } else {
        statusEl.textContent = `${state.activeRepo.modifiedCount} modified`;
        statusEl.className = "repo-pill-tag dirty";
      }
      statusEl.style.display = state.activeRepo.isGit ? "inline-block" : "none";
    }

    if (routerText) {
      const modeLabels = {
        auto: "🔄 NVIDIA Auto-Switch Multi-Agent",
        architect: "⚡ Architect Agent (Nemotron 120B)",
        coder: "💻 Code Specialist Agent",
        reviewer: "🛡️ Reviewer & QA Agent",
      };
      routerText.textContent = modeLabels[state.agentMode] || "NVIDIA Agent";
    }
  }

  // ==========================================
  // Attachments & Screenshot Handling
  // ==========================================
  function addAttachmentFile(file) {
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const reader = new FileReader();

    if (isImage) {
      reader.onload = (e) => {
        state.pendingAttachments.push({
          name: file.name || `screenshot-${Date.now()}.png`,
          type: file.type || "image/png",
          size: file.size,
          data: e.target.result,
        });
        renderPendingAttachments();
      };
      reader.readAsDataURL(file);
    } else {
      reader.onload = (e) => {
        state.pendingAttachments.push({
          name: file.name,
          type: file.type || "text/plain",
          size: file.size,
          text: typeof e.target.result === "string" ? e.target.result : "",
        });
        renderPendingAttachments();
      };
      reader.readAsText(file);
    }
  }

  function renderPendingAttachments() {
    const tray = byId("chatAttachmentsTray");
    if (!tray) return;

    if (state.pendingAttachments.length === 0) {
      tray.style.display = "none";
      tray.innerHTML = "";
      return;
    }

    tray.style.display = "flex";
    tray.innerHTML = state.pendingAttachments
      .map((att, idx) => {
        const isImg = att.type?.startsWith("image/");
        return `
          <div class="chat-attachment-chip">
            ${isImg && att.data ? `<img src="${att.data}" class="chat-attachment-thumb" alt="thumb" />` : `<span>📄</span>`}
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;">${escapeHtml(att.name)}</span>
            <button type="button" class="chat-attachment-remove" data-idx="${idx}" title="Remove attachment">✕</button>
          </div>
        `;
      })
      .join("");

    tray.querySelectorAll(".chat-attachment-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.idx, 10);
        state.pendingAttachments.splice(idx, 1);
        renderPendingAttachments();
      });
    });
  }

  // ==========================================
  // Initialize Chat UI
  // ==========================================
  function initializeChat() {
    const root = byId("chatRoot");
    if (!root) return;

    loadSavedMessages();
    renderShell(root);
    fetchRepos();
    fetchGitHubStatus();
  }

  // ==========================================
  // Render Shell
  // ==========================================
  function renderShell(root) {
    root.innerHTML = `
      <div class="chat-view-container">
        <!-- Top Navbar -->
        <div class="chat-navbar">
          <div class="chat-nav-title">
            <h3><span>⚡</span> Claude Code & NVIDIA Multi-Agent</h3>
            <div class="chat-backend-badge" title="Live NVIDIA NIM backend handling all agent requests">
              <span class="live-dot"></span>
              <span><strong>Backend:</strong> NVIDIA NIM & Gemini Vision</span>
            </div>
            <select id="chatAgentSelect" class="chat-model-select" title="Switch NVIDIA Agent dynamically">
              <option value="auto">🔄 Dynamic Multi-Agent Auto-Switch (NVIDIA NIM)</option>
              <option value="architect">⚡ Architect & Planner Agent (Nemotron 3 Super 120B)</option>
              <option value="coder">💻 Code Specialist Agent (Autonomous Tools)</option>
              <option value="reviewer">🛡️ Reviewer & QA Agent (Test & Validation)</option>
              <option value="gemini">✨ Google Gemini 3.5 Flash (Vision & Multimodal)</option>
            </select>
          </div>

          <div class="chat-nav-actions">
            <button id="openApiKeysBtn" class="secondary-button" type="button" style="padding: 4px 10px; font-size: 12px; display: inline-flex; align-items: center; gap: 5px;" title="Configure API Keys (NVIDIA NIM, Gemini, OpenAI) and Server URL">
              <span id="apiKeysDot">🔑</span> <span id="apiKeysBtnLabel">API Keys & Server</span>
            </button>
            <div class="mode-pill-toggle">
              <button id="modeClaudeCodeBtn" class="mode-pill-btn active" type="button">💻 Claude Code Agent</button>
              <button id="modeChatBtn" class="mode-pill-btn" type="button">💬 Conversational</button>
            </div>
            <button id="chatNewBtn" class="secondary-button" type="button" style="padding: 4px 12px; font-size: 12px;">+ New Session</button>
          </div>
        </div>

        <!-- Active Repo & Agent Bar -->
        <div class="chat-repo-bar">
          <div class="repo-badge-info">
            <span style="font-size: 14px;">📦</span>
            <span><strong>Active Repo:</strong> <span id="activeRepoName">/workspace</span></span>
            <span id="activeRepoBranch" class="repo-pill-tag">master</span>
            <span id="activeRepoStatus" class="repo-pill-tag clean">clean</span>
          </div>

          <div class="repo-bar-actions">
            <div class="agent-routing-indicator">
              <span id="currentAgentRouteText">🔄 NVIDIA Auto-Switch Multi-Agent</span>
            </div>
            <button id="openSecretsBtn" class="secondary-button" type="button" style="padding: 4px 10px; font-size: 12px;" title="View and edit .env secrets for active repository">🔐 Repo Secrets (.env)</button>
            <button id="connectRepoBtn" class="primary-button" type="button" style="padding: 4px 12px; font-size: 12px;">🔗 Connect Account / Pick Repo</button>
          </div>
        </div>

        <!-- Chat Stream -->
        <div id="chatMessagesScroll" class="chat-messages-scroll"></div>

        <!-- Chat Input Bar -->
        <div class="chat-input-bar-wrap" style="position: relative;">
          <div id="chatDropOverlay" class="chat-drop-overlay" style="display: none;">
            📸 Drop screenshots or files here to attach
          </div>

          <form id="chatForm" class="chat-input-box">
            <!-- Staged Attachments Preview Tray -->
            <div id="chatAttachmentsTray" class="chat-attachments-tray" style="display: none;"></div>

            <div class="chat-input-main-row">
              <button id="chatAttachBtn" class="chat-attach-btn" type="button" title="Attach file or screenshot (or paste directly via Ctrl+V)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                </svg>
              </button>
              <input type="file" id="chatFileInput" multiple accept="image/*,.txt,.md,.json,.ts,.js,.py,.html,.css,.csv,.log,.pdf" style="display: none;" />

              <textarea id="chatInput" class="chat-textarea" placeholder="Ask Claude Code to inspect the repo, paste screenshots (Ctrl+V), create/edit files, run commands, fix bugs..." rows="1"></textarea>

              <button id="chatSendBtn" class="chat-send-btn" type="submit" title="Send message to Claude Code Agent">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5"></line>
                  <polyline points="5 12 12 5 19 12"></polyline>
                </svg>
              </button>
            </div>
          </form>

          <div class="chat-input-footer-note">
            Powered by NVIDIA NIM & Gemini Vision with autonomous tool execution. Paste screenshots with <code>Ctrl+V</code> or click <code>📎</code>.
          </div>
        </div>
      </div>

      <!-- Connect or Pick Repo Dialog -->
      <dialog id="connectRepoDialog" class="integration-dialog" style="max-width: 680px; width: 95%;">
        <div class="section-heading">
          <h3>🔗 Connect GitHub Account & Pick Repository</h3>
          <button id="closeConnectRepoDialog" class="ghost-button" type="button">&#x2715;</button>
        </div>

        <div style="padding: 16px 0; display: flex; flex-direction: column; gap: 16px;">
          <!-- 1. GitHub Account Section -->
          <div id="githubAccountSection"></div>

          <!-- 2. Manual Clone Section (Collapsible) -->
          <div style="border-top: 1px solid var(--line); padding-top: 12px;">
            <details id="manualCloneDetails">
              <summary style="font-size: 12px; font-weight: 600; color: var(--text-strong); cursor: pointer; user-select: none;">
                ⚙️ Or clone from custom Git URL / filesystem path
              </summary>
              <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
                <input id="repoUrlInput" type="text" placeholder="https://github.com/username/repo or /workspace/projects/my-app" style="width: 100%; padding: 8px 12px; background: var(--input); border: 1px solid var(--line-strong); border-radius: var(--radius-md); color: var(--text-strong); font-size: 13px;" />
                <div style="display: flex; justify-content: flex-end;">
                  <button id="confirmCloneRepoBtn" class="primary-button" type="button" style="padding: 6px 14px; font-size: 12px;">Clone & Connect</button>
                </div>
              </div>
            </details>
          </div>

          <!-- 3. Existing Local Workspace Repositories -->
          <div style="border-top: 1px solid var(--line); padding-top: 12px;">
            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: var(--text-strong);">
              📂 Local Workspace Repositories:
            </label>
            <div id="existingReposList" style="max-height: 140px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--line); border-radius: var(--radius-md); padding: 8px; background: rgba(0,0,0,0.2);">
              <span style="color: var(--muted); font-size: 12px;">Loading detected repositories...</span>
            </div>
          </div>

          <div id="repoDialogMessage" class="message-area" hidden></div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--line); padding-top: 12px;">
          <button id="cancelRepoDialogBtn" class="secondary-button" type="button">Close</button>
        </div>
      </dialog>

      <!-- Repo Secrets (.env) Dialog -->
      <dialog id="repoSecretsDialog" class="integration-dialog" style="max-width: 620px; width: 95%;">
        <div class="section-heading">
          <h3>🔐 Active Repository Secrets (.env)</h3>
          <button id="closeRepoSecretsDialog" class="ghost-button" type="button">&#x2715;</button>
        </div>
        <div style="padding: 14px 0; display: flex; flex-direction: column; gap: 12px;">
          <div style="font-size: 12px; color: var(--muted);">
            Maintain API keys, credentials, and environment variables for: <strong id="secretsRepoPath" style="color: #38bdf8;">/workspace/.env</strong>.<br/>
            Claude Code autonomously reads and injects these variables during tasks.
          </div>
          <textarea id="repoSecretsTextarea" rows="10" placeholder="KEY=value&#10;DHAN_CLIENT_ID=your_id&#10;DHAN_ACCESS_TOKEN=your_token&#10;API_SECRET=your_secret" style="width: 100%; padding: 10px 12px; background: #030712; font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #38bdf8; border: 1px solid var(--line-strong); border-radius: var(--radius-md); box-sizing: border-box;"></textarea>
          <div style="font-size: 11px; color: #10b981; display: flex; align-items: center; gap: 6px;">
            <span>🔒 Automatically saved to <code>.env</code> and added to <code>.gitignore</code> so secrets are never pushed to GitHub.</span>
          </div>
          <div id="secretsDialogMsg" class="message-area" hidden></div>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--line); padding-top: 12px;">
          <button id="cancelRepoSecretsBtn" class="secondary-button" type="button">Cancel</button>
          <button id="saveRepoSecretsBtn" class="primary-button" type="button">Save .env</button>
        </div>
      </dialog>

      <!-- Image Preview Modal -->
      <dialog id="imagePreviewDialog" class="integration-dialog" style="max-width: 90vw; max-height: 90vh; padding: 12px; background: rgba(0,0,0,0.92); border: 1px solid var(--line);">
        <div style="display: flex; justify-content: flex-end; margin-bottom: 8px;">
          <button id="closeImagePreviewDialog" class="ghost-button" type="button" style="font-size: 16px;">✕ Close</button>
        </div>
        <div style="display: flex; justify-content: center; align-items: center; max-height: 75vh; overflow: auto;">
          <img id="fullImagePreviewImg" src="" alt="preview" style="max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 6px;" />
        </div>
      </dialog>
    `;

    attachEvents();
    renderMessages();
  }

  // ==========================================
  // Render GitHub Section in Dialog
  // ==========================================
  function renderGitHubSectionInDialog() {
    const container = byId("githubAccountSection");
    if (!container) return;

    if (!state.github.connected) {
      container.innerHTML = `
        <div class="github-connect-box">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 24px;">🐙</span>
              <div>
                <strong style="color: var(--text-strong); font-size: 14px;">Connect Your GitHub Account</strong>
                <div style="font-size: 11px; color: var(--muted);">Pick and clone all your public & private repositories with 1 click.</div>
              </div>
            </div>
            <a href="https://github.com/settings/tokens/new?scopes=repo,read:user,user:email&description=Free+Claude+Code+Studio" target="_blank" class="secondary-button" style="padding: 4px 10px; font-size: 11px; text-decoration: none;">
              🔑 Create Token on GitHub ↗
            </a>
          </div>

          <div style="display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap;">
            <input id="ghPatInput" type="password" placeholder="Paste GitHub Personal Access Token (ghp_... or github_pat_...)" style="flex: 1; min-width: 260px; padding: 8px 12px; background: var(--input); border: 1px solid var(--line-strong); border-radius: var(--radius-md); color: var(--text-strong); font-size: 13px;" />
            <button id="connectGhPatBtn" class="primary-button" type="button" style="white-space: nowrap; padding: 8px 16px; font-size: 12px;">
              Connect & Pick Repos
            </button>
          </div>
          <div style="font-size: 11px; color: var(--muted);">
            🔒 Token is stored locally in your workspace. Requires <code>repo</code> scope to access private repositories.
          </div>
        </div>
      `;

      byId("connectGhPatBtn")?.addEventListener("click", async () => {
        const input = byId("ghPatInput");
        const token = input?.value.trim();

        if (!token) {
          showDialogMessage("Please enter a GitHub Personal Access Token.", "error");
          return;
        }

        showDialogMessage("Authenticating with GitHub and fetching your repositories...", "info");

        try {
          const res = await api("/api/github/connect", {
            method: "POST",
            body: JSON.stringify({ token }),
          });

          if (!res.success) throw new Error(res.error || "GitHub authentication failed");

          state.github.connected = true;
          state.github.user = res.user;
          showDialogMessage(`Connected as @${res.user.login}! Fetching repositories...`, "success");
          await loadGitHubRepos();
        } catch (err) {
          showDialogMessage(`Connection failed: ${err.message}`, "error");
        }
      });
    } else {
      // Connected View
      const u = state.github.user || {};
      const repos = state.github.repos || [];
      const filter = (state.github.filter || "").toLowerCase();
      const filteredRepos = filter
        ? repos.filter((r) => r.name.toLowerCase().includes(filter) || (r.description && r.description.toLowerCase().includes(filter)))
        : repos;

      container.innerHTML = `
        <div class="github-profile-card">
          <div class="github-profile-user">
            <img class="github-profile-avatar" src="${u.avatar_url || "https://github.com/ghost.png"}" alt="avatar" />
            <div>
              <strong style="color: var(--text-strong); font-size: 14px;">${escapeHtml(u.name || u.login || "GitHub User")}</strong>
              <div style="font-size: 12px; color: var(--muted);">
                <a href="${u.html_url || "#"}" target="_blank" style="color: #38bdf8; text-decoration: none;">@${escapeHtml(u.login || "")}</a>
                · ${repos.length} repositories loaded
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button id="refreshGhReposBtn" class="secondary-button" type="button" style="padding: 4px 10px; font-size: 11px;">🔄 Refresh Repos</button>
            <button id="disconnectGhBtn" class="ghost-button" type="button" style="color: #ef4444; font-size: 11px;">Disconnect</button>
          </div>
        </div>

        <div style="margin-top: 12px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <label style="font-size: 12px; font-weight: 600; color: var(--text-strong);">
              Select Repository to Work With:
            </label>
            <span style="font-size: 11px; color: var(--muted);">${filteredRepos.length} repo${filteredRepos.length === 1 ? "" : "s"} shown</span>
          </div>

          <input id="ghRepoSearchInput" type="text" placeholder="🔍 Search your repositories (e.g. dhanalgo-code)..." value="${escapeHtml(state.github.filter)}" style="width: 100%; padding: 8px 12px; background: var(--input); border: 1px solid var(--line-strong); border-radius: var(--radius-md); color: var(--text-strong); font-size: 13px;" />

          <div id="ghReposListContainer" class="github-repos-scroll">
            ${state.github.loading
              ? `<div style="text-align: center; padding: 24px; color: var(--muted); font-size: 12px;">Loading repositories from GitHub...</div>`
              : filteredRepos.length === 0
              ? `<div style="text-align: center; padding: 24px; color: var(--muted); font-size: 12px;">No repositories match your search.</div>`
              : filteredRepos
                  .map((r) => {
                    const localPath = `/workspace/projects/${r.name}`;
                    const isCloned = state.repos.some((local) => local.path === localPath);
                    const isActive = state.activeRepo.path === localPath;

                    return `
                      <div class="github-repo-card">
                        <div style="display: flex; flex-direction: column; gap: 3px; max-width: 70%;">
                          <div style="display: flex; align-items: center; gap: 8px;">
                            <strong style="color: var(--text-strong); font-size: 13px;">${escapeHtml(r.name)}</strong>
                            <span class="repo-access-badge ${r.private ? "private" : "public"}">
                              ${r.private ? "🔒 Private" : "🌐 Public"}
                            </span>
                            <span style="font-size: 11px; color: var(--muted);">${escapeHtml(r.default_branch || "main")}</span>
                          </div>
                          ${r.description ? `<span style="font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(r.description)}</span>` : ""}
                        </div>

                        <div>
                          ${isActive
                            ? `<button class="secondary-button" type="button" style="padding: 4px 12px; font-size: 11px;" disabled>✓ Active</button>`
                            : isCloned
                            ? `<button class="primary-button switch-local-btn" type="button" data-path="${escapeHtml(localPath)}" style="padding: 4px 12px; font-size: 11px;">Switch To</button>`
                            : `<button class="primary-button clone-gh-repo-btn" type="button" data-url="${escapeHtml(r.clone_url)}" data-name="${escapeHtml(r.name)}" style="padding: 4px 14px; font-size: 11px;">⚡ Clone & Work</button>`}
                        </div>
                      </div>
                    `;
                  })
                  .join("")}
          </div>
        </div>
      `;

      // Event handlers for connected view
      const searchInput = byId("ghRepoSearchInput");
      searchInput?.addEventListener("input", (e) => {
        state.github.filter = e.target.value;
        renderGitHubSectionInDialog();
        const nextInput = byId("ghRepoSearchInput");
        if (nextInput) {
          nextInput.focus();
          nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
        }
      });

      byId("refreshGhReposBtn")?.addEventListener("click", () => {
        loadGitHubRepos();
      });

      byId("disconnectGhBtn")?.addEventListener("click", async () => {
        if (confirm("Disconnect GitHub account?")) {
          await api("/api/github/disconnect", { method: "POST" });
          state.github.connected = false;
          state.github.user = null;
          state.github.repos = [];
          renderGitHubSectionInDialog();
        }
      });

      // Clone buttons
      container.querySelectorAll(".clone-gh-repo-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const url = btn.dataset.url;
          const name = btn.dataset.name;
          await performCloneAndConnect(url, name, btn);
        });
      });

      // Switch local buttons
      container.querySelectorAll(".switch-local-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const path = btn.dataset.path;
          try {
            await api("/api/agent/repos/active", {
              method: "POST",
              body: JSON.stringify({ path }),
            });
            await fetchRepos();
            byId("connectRepoDialog")?.close();
          } catch (err) {
            alert("Failed to switch repo: " + err.message);
          }
        });
      });
    }
  }

  async function performCloneAndConnect(url, name, triggerBtn) {
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = "Cloning…";
    }

    showDialogMessage(`Cloning ${name || "repository"} with authenticated token...`, "info");

    try {
      const res = await api("/api/agent/repos/connect", {
        method: "POST",
        body: JSON.stringify({ url, name }),
      });

      if (res.error) throw new Error(res.error);

      showDialogMessage(`Successfully cloned and connected ${name || "repository"}!`, "success");
      await fetchRepos();

      setTimeout(() => {
        byId("connectRepoDialog")?.close();
        hideDialogMessage();
      }, 1000);
    } catch (err) {
      showDialogMessage(`Clone error: ${err.message}`, "error");
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = "⚡ Clone & Work";
      }
    }
  }

  function showDialogMessage(text, type = "info") {
    const msg = byId("repoDialogMessage");
    if (!msg) return;
    msg.textContent = text;
    msg.className = `message-area ${type}`;
    msg.hidden = false;
  }

  function hideDialogMessage() {
    const msg = byId("repoDialogMessage");
    if (msg) msg.hidden = true;
  }

  // ==========================================
  // Event Handlers
  // ==========================================
  function attachEvents() {
    const agentSelect = byId("chatAgentSelect");
    agentSelect.value = state.agentMode;
    agentSelect.addEventListener("change", (e) => {
      state.agentMode = e.target.value;
      if (state.agentMode === "gemini") {
        state.model = "gemini-3.5-flash";
      } else {
        state.model = "nemotron-3-super-120b";
      }
      updateRepoBarUI();
    });

    const modeChat = byId("modeChatBtn");
    const modeClaude = byId("modeClaudeCodeBtn");

    modeChat.addEventListener("click", () => setMode("chat"));
    modeClaude.addEventListener("click", () => setMode("claude_code"));

    byId("chatNewBtn").addEventListener("click", () => {
      if (state.messages.length && confirm("Start a new Claude Code session?")) {
        state.messages = [];
        saveMessages();
        renderMessages();
      }
    });

    // Connect Repo Modal Events
    const dialog = byId("connectRepoDialog");
    byId("connectRepoBtn").addEventListener("click", () => {
      renderGitHubSectionInDialog();
      renderExistingReposInDialog();
      hideDialogMessage();
      dialog.showModal();
    });
    byId("closeConnectRepoDialog").addEventListener("click", () => dialog.close());
    byId("cancelRepoDialogBtn").addEventListener("click", () => dialog.close());

    // Repo Secrets (.env) Modal Events
    const secretsDialog = byId("repoSecretsDialog");
    byId("openSecretsBtn")?.addEventListener("click", async () => {
      const pathEl = byId("secretsRepoPath");
      if (pathEl) pathEl.textContent = `${state.activeRepo.path}/.env`;
      const textarea = byId("repoSecretsTextarea");
      const msg = byId("secretsDialogMsg");
      if (msg) msg.hidden = true;
      if (textarea) textarea.value = "Loading existing .env...";

      secretsDialog.showModal();

      try {
        const data = await api("/api/agent/secrets");
        if (textarea) textarea.value = data.content || "";
      } catch (err) {
        if (textarea) textarea.value = "";
      }
    });

    byId("closeRepoSecretsDialog")?.addEventListener("click", () => secretsDialog?.close());
    byId("cancelRepoSecretsBtn")?.addEventListener("click", () => secretsDialog?.close());

    byId("saveRepoSecretsBtn")?.addEventListener("click", async () => {
      const textarea = byId("repoSecretsTextarea");
      const msg = byId("secretsDialogMsg");
      const content = textarea?.value || "";

      try {
        await api("/api/agent/secrets", {
          method: "POST",
          body: JSON.stringify({ content }),
        });
        if (msg) {
          msg.textContent = "Saved .env successfully! Claude Code has loaded these secrets.";
          msg.className = "message-area success";
          msg.hidden = false;
        }
        setTimeout(() => {
          secretsDialog?.close();
        }, 1000);
      } catch (err) {
        if (msg) {
          msg.textContent = `Error saving secrets: ${err.message}`;
          msg.className = "message-area error";
          msg.hidden = false;
        }
      }
    });

    // Client API Keys & Server Config Modal Events
    byId("openApiKeysBtn")?.addEventListener("click", openClientKeysModal);
    byId("closeClientKeysDialog")?.addEventListener("click", () => byId("clientKeysDialog")?.close());
    byId("cancelClientKeysBtn")?.addEventListener("click", () => byId("clientKeysDialog")?.close());
    byId("clearClientKeysBtn")?.addEventListener("click", () => {
      localStorage.removeItem("fcc_nvidia_key");
      localStorage.removeItem("fcc_gemini_key");
      localStorage.removeItem("fcc_openai_key");
      localStorage.removeItem("fcc_backend_url");
      if (byId("inputNvidiaKey")) byId("inputNvidiaKey").value = "";
      if (byId("inputGeminiKey")) byId("inputGeminiKey").value = "";
      if (byId("inputOpenaiKey")) byId("inputOpenaiKey").value = "";
      if (byId("inputBackendUrl")) byId("inputBackendUrl").value = "";
      const status = byId("clientKeysStatus");
      if (status) {
        status.hidden = false;
        status.style.color = "#ef4444";
        status.textContent = "Cleared all local keys.";
      }
      updateApiKeysBtnUI();
    });
    byId("saveClientKeysBtn")?.addEventListener("click", () => {
      const nv = (byId("inputNvidiaKey")?.value || "").trim();
      const gem = (byId("inputGeminiKey")?.value || "").trim();
      const oai = (byId("inputOpenaiKey")?.value || "").trim();
      const url = (byId("inputBackendUrl")?.value || "").trim();
      if (nv) localStorage.setItem("fcc_nvidia_key", nv); else localStorage.removeItem("fcc_nvidia_key");
      if (gem) localStorage.setItem("fcc_gemini_key", gem); else localStorage.removeItem("fcc_gemini_key");
      if (oai) localStorage.setItem("fcc_openai_key", oai); else localStorage.removeItem("fcc_openai_key");
      if (url) localStorage.setItem("fcc_backend_url", url); else localStorage.removeItem("fcc_backend_url");

      const status = byId("clientKeysStatus");
      if (status) {
        status.hidden = false;
        status.style.color = "#22c55e";
        status.textContent = "✓ Settings saved successfully!";
      }
      updateApiKeysBtnUI();
      setTimeout(() => byId("clientKeysDialog")?.close(), 500);
    });

    // Listen for clicks on links in messages requesting API key setup
    byId("chatMessagesScroll")?.addEventListener("click", (e) => {
      const target = e.target.closest("a, button");
      if (!target) return;
      if (target.getAttribute("href") === "#open-keys-modal" || target.dataset.action === "open-keys") {
        e.preventDefault();
        openClientKeysModal();
      }
    });

    updateApiKeysBtnUI();

    // Image preview dialog
    const previewDialog = byId("imagePreviewDialog");
    byId("closeImagePreviewDialog")?.addEventListener("click", () => previewDialog?.close());

    // File Attachment Picker & Paperclip Button
    const fileInput = byId("chatFileInput");
    byId("chatAttachBtn")?.addEventListener("click", () => {
      fileInput?.click();
    });

    fileInput?.addEventListener("change", (e) => {
      const files = e.target.files;
      if (files) {
        for (let i = 0; i < files.length; i++) {
          addAttachmentFile(files[i]);
        }
      }
      e.target.value = "";
    });

    // Clipboard Paste Listener (Ctrl+V Screenshots)
    window.addEventListener("paste", (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      let hasImage = false;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            hasImage = true;
            addAttachmentFile(blob);
          }
        }
      }

      if (hasImage) {
        byId("chatInput")?.focus();
      }
    });

    // Drag & Drop on chat window
    const dropOverlay = byId("chatDropOverlay");
    window.addEventListener("dragenter", (e) => {
      e.preventDefault();
      if (dropOverlay) dropOverlay.style.display = "grid";
    });

    window.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (dropOverlay) dropOverlay.style.display = "grid";
    });

    window.addEventListener("dragleave", (e) => {
      e.preventDefault();
      if (e.relatedTarget === null && dropOverlay) {
        dropOverlay.style.display = "none";
      }
    });

    window.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dropOverlay) dropOverlay.style.display = "none";
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          addAttachmentFile(files[i]);
        }
      }
    });

    byId("confirmCloneRepoBtn")?.addEventListener("click", async () => {
      const urlInput = byId("repoUrlInput");
      const url = urlInput.value.trim();

      if (!url) {
        showDialogMessage("Please enter a Git clone URL or path.", "error");
        return;
      }

      await performCloneAndConnect(url, undefined, byId("confirmCloneRepoBtn"));
    });

    const form = byId("chatForm");
    const input = byId("chatInput");

    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 160) + "px";
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitMessage();
      }
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitMessage();
    });
  }

  function setMode(mode) {
    state.mode = mode;
    byId("modeChatBtn").classList.toggle("active", mode === "chat");
    byId("modeClaudeCodeBtn").classList.toggle("active", mode === "claude_code");
    const placeholder = mode === "claude_code"
      ? "Ask Claude Code to inspect the repo, paste screenshots (Ctrl+V), create/edit files, run commands, fix bugs..."
      : "Message NVIDIA NIM AI (ask questions, draft documents, research, brainstorm)...";
    byId("chatInput").placeholder = placeholder;
  }

  function renderExistingReposInDialog() {
    const list = byId("existingReposList");
    if (!list) return;

    if (!state.repos.length) {
      list.innerHTML = `<span style="color: var(--muted); font-size: 12px;">No local workspace repositories found.</span>`;
      return;
    }

    list.innerHTML = "";
    state.repos.forEach((repo) => {
      const row = document.createElement("div");
      row.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: 12px;";

      const isActive = repo.path === state.activeRepo.path;
      row.innerHTML = `
        <div style="display: flex; flex-direction: column;">
          <strong>📁 ${escapeHtml(repo.name)}</strong>
          <span style="font-size: 11px; color: var(--muted);">${escapeHtml(repo.path)} ${repo.branch ? `(${repo.branch})` : ""}</span>
        </div>
        <button class="${isActive ? "secondary-button" : "primary-button"}" type="button" style="padding: 2px 10px; font-size: 11px;" ${isActive ? "disabled" : ""}>
          ${isActive ? "Active" : "Switch To"}
        </button>
      `;

      if (!isActive) {
        row.querySelector("button").addEventListener("click", async () => {
          try {
            await api("/api/agent/repos/active", {
              method: "POST",
              body: JSON.stringify({ path: repo.path }),
            });
            await fetchRepos();
            byId("connectRepoDialog").close();
          } catch (err) {
            alert("Failed to switch repo: " + err.message);
          }
        });
      }

      list.appendChild(row);
    });
  }

  function openClientKeysModal() {
    const keysDialog = byId("clientKeysDialog");
    if (!keysDialog) return;
    const nvInput = byId("inputNvidiaKey");
    const gemInput = byId("inputGeminiKey");
    const oaiInput = byId("inputOpenaiKey");
    const urlInput = byId("inputBackendUrl");
    const status = byId("clientKeysStatus");
    if (nvInput) nvInput.value = localStorage.getItem("fcc_nvidia_key") || "";
    if (gemInput) gemInput.value = localStorage.getItem("fcc_gemini_key") || "";
    if (oaiInput) oaiInput.value = localStorage.getItem("fcc_openai_key") || "";
    if (urlInput) urlInput.value = localStorage.getItem("fcc_backend_url") || "";
    if (status) status.hidden = true;
    keysDialog.showModal();
  }

  function updateApiKeysBtnUI() {
    const dot = byId("apiKeysDot");
    const label = byId("apiKeysBtnLabel");
    const nvidiaKey = (localStorage.getItem("fcc_nvidia_key") || "").trim();
    const geminiKey = (localStorage.getItem("fcc_gemini_key") || "").trim();
    const openaiKey = (localStorage.getItem("fcc_openai_key") || "").trim();
    const backendUrl = (localStorage.getItem("fcc_backend_url") || "").trim();
    const hasKey = Boolean(nvidiaKey || geminiKey || openaiKey || backendUrl);
    if (dot) dot.textContent = hasKey ? "🟢" : "🔑";
    if (label) {
      if (backendUrl) label.textContent = "Server: Connected";
      else if (nvidiaKey) label.textContent = "NVIDIA NIM Active";
      else if (geminiKey) label.textContent = "Gemini Active";
      else if (openaiKey) label.textContent = "OpenAI Active";
      else label.textContent = "API Keys & Server";
    }
  }

  // ==========================================
  // Direct Client-Side Browser AI (Zero-Server / GitHub Pages Mode)
  // ==========================================
  async function executeDirectAI({ prompt, messages, attachments, assistantIndex }) {
    const nvidiaKey = (localStorage.getItem("fcc_nvidia_key") || "").trim();
    const geminiKey = (localStorage.getItem("fcc_gemini_key") || "").trim();
    const openaiKey = (localStorage.getItem("fcc_openai_key") || "").trim();

    if (!nvidiaKey && !geminiKey && !openaiKey) {
      state.messages[assistantIndex] = {
        role: "assistant",
        content: `👋 **Welcome to Free Claude Code (Static GitHub Pages Mode)**\n\nGitHub Pages is a static host without a Node.js backend. You can run AI models **directly inside your browser** with your own free API key:\n\n• **NVIDIA NIM** (Recommended — free tier provides Nemotron 3 120B, Llama 3.3 70B, DeepSeek R1):\n  👉 [Get Free NVIDIA Key](https://build.nvidia.com)\n• **Google Gemini** (Gemini 2.5 Flash with full screenshot / multimodal vision):\n  👉 [Get Free Gemini Key](https://aistudio.google.com/apikey)\n\n<p style="margin-top:12px;"><button type="button" class="primary-button" data-action="open-keys" style="padding:6px 16px; font-size:13px; cursor:pointer;">🔑 Configure API Key Now</button></p>\n\n*(Or if you are running locally with \`npm start\`, set your backend URL to \`http://localhost:3000\` in Server Settings).*`,
        model: state.model,
        timestamp: Date.now(),
        error: false,
      };
      const dialog = byId("clientKeysDialog");
      if (dialog) setTimeout(() => dialog.showModal(), 300);
      return;
    }

    state.messages[assistantIndex].content = "Generating direct response from browser AI API…";
    renderMessages();

    // 1. Google Gemini if key provided and either chosen or images attached
    const hasImageAttachments = attachments && attachments.some((a) => a.type?.startsWith("image/") && a.data);
    if ((geminiKey && (state.model.includes("gemini") || hasImageAttachments)) || (!nvidiaKey && geminiKey)) {
      try {
        const contents = [];
        messages.slice(-8).forEach((m) => {
          if (!m.pending && m.content) {
            contents.push({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            });
          }
        });
        const currentParts = [{ text: prompt || "Please analyze this request." }];
        if (attachments && attachments.length > 0) {
          attachments.forEach((att) => {
            if (att.data && att.data.includes(";base64,")) {
              const mime = att.data.split(";base64,")[0].replace("data:", "") || "image/png";
              const b64 = att.data.split(";base64,")[1];
              currentParts.push({
                inlineData: { mimeType: mime, data: b64 },
              });
            }
          });
        }
        contents.push({ role: "user", parts: currentParts });

        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents }),
        });
        const gText = await geminiRes.text();
        let gData = null;
        try { gData = JSON.parse(gText); } catch {}
        if (!geminiRes.ok) {
          throw new Error(gData?.error?.message || `Gemini API error ${geminiRes.status}`);
        }
        const reply = gData?.candidates?.[0]?.content?.parts?.[0]?.text || "No reply generated.";
        state.messages[assistantIndex] = {
          role: "assistant",
          content: reply,
          agent: { name: "Gemini Vision Agent", model: "gemini-2.5-flash", reason: "Direct Client Browser Mode" },
          model: "gemini-2.5-flash",
          provider: "Google Gemini (Client-Direct)",
          steps: [{ tool: "client_browser_vision", status: "completed", description: "Direct multimodal browser execution" }],
          timestamp: Date.now(),
        };
        return;
      } catch (err) {
        if (!nvidiaKey && !openaiKey) throw err;
        console.warn("Gemini direct call failed, trying NVIDIA NIM:", err);
      }
    }

    // 2. NVIDIA NIM or OpenAI / Groq
    let endpoint = "https://integrate.api.nvidia.com/v1/chat/completions";
    let token = nvidiaKey;
    let model = "nvidia/nemotron-3-super-120b-a12b";

    if (state.model && !state.model.includes("gemini")) {
      model = state.model.replace(/^nvidia_nim\//, "");
    }
    if (!nvidiaKey && openaiKey) {
      if (openaiKey.startsWith("gsk_")) {
        endpoint = "https://api.groq.com/openai/v1/chat/completions";
        model = "llama-3.3-70b-versatile";
      } else {
        endpoint = "https://api.openai.com/v1/chat/completions";
        model = "gpt-4o-mini";
      }
      token = openaiKey;
    }

    const chatMsgs = [
      {
        role: "system",
        content: "You are Free Claude Code, an expert autonomous AI software engineer and senior developer. Provide comprehensive, accurate, production-ready code and helpful explanations.",
      },
      ...messages.slice(-8).filter((m) => !m.pending && m.content).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content || "",
      })),
    ];
    if (!chatMsgs.some((m) => m.content === prompt)) {
      chatMsgs.push({ role: "user", content: prompt });
    }

    const nRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        messages: chatMsgs,
        temperature: 0.6,
        max_tokens: 4096,
      }),
    });
    const nText = await nRes.text();
    let nData = null;
    try { nData = JSON.parse(nText); } catch {}
    if (!nRes.ok) {
      throw new Error(nData?.error?.message || nData?.message || `API error ${nRes.status}: ${nText.slice(0, 100)}`);
    }
    const reply = nData?.choices?.[0]?.message?.content || "Completed response.";
    state.messages[assistantIndex] = {
      role: "assistant",
      content: reply,
      agent: { name: "NVIDIA Agent", model, reason: "Direct Client Browser Mode" },
      model,
      provider: "NVIDIA NIM (Client-Direct)",
      steps: [{ tool: "client_browser_nim", status: "completed", description: "Direct browser AI execution" }],
      timestamp: Date.now(),
    };
  }

  // ==========================================
  // Submit & Run Autonomous Agent
  // ==========================================
  async function submitMessage() {
    if (state.busy) return;
    const input = byId("chatInput");
    const text = input.value.trim();
    const hasAttachments = state.pendingAttachments.length > 0;

    if (!text && !hasAttachments) return;

    input.value = "";
    input.style.height = "auto";

    const currentAttachments = [...state.pendingAttachments];
    state.pendingAttachments = [];
    renderPendingAttachments();

    state.messages.push({
      role: "user",
      content: text || "Please inspect the attached screenshot / file.",
      attachments: currentAttachments,
      timestamp: Date.now(),
    });

    saveMessages();
    renderMessages();

    state.busy = true;
    updateSendBtnState();

    // Placeholder message while waiting
    const assistantIndex = state.messages.length;
    state.messages.push({
      role: "assistant",
      content: "Planning and executing workspace tools…",
      model: state.model,
      timestamp: Date.now(),
      pending: true,
    });
    renderMessages();

    try {
      const isStaticPages = window.location.hostname.endsWith("github.io") && !localStorage.getItem("fcc_backend_url");
      if (isStaticPages) {
        await executeDirectAI({ prompt: text || "Please inspect the attached screenshot / file.", messages: state.messages, attachments: currentAttachments, assistantIndex });
      } else {
        try {
          const data = await api("/api/agent/run", {
            method: "POST",
            body: JSON.stringify({
              prompt: text || "Please inspect the attached screenshot / file.",
              repoPath: state.activeRepo.path,
              agentMode: state.agentMode,
              attachments: currentAttachments,
              messages: state.messages.filter((m) => !m.pending).map((m) => ({ role: m.role, content: m.content })),
            }),
          });

          state.messages[assistantIndex] = {
            role: "assistant",
            content: data.reply || "Completed execution steps.",
            agent: data.agent,
            model: data.agent?.model || state.model,
            provider: "NVIDIA NIM",
            steps: data.steps || [],
            repoPath: data.repoPath || state.activeRepo.path,
            gitStatus: data.gitStatus,
            timestamp: Date.now(),
          };

          if (data.gitStatus) {
            state.activeRepo = data.gitStatus;
            updateRepoBarUI();
          }
        } catch (err) {
          if (err.status === 405 || err.status === 404 || err.message?.includes("405") || err.message?.includes("404")) {
            console.warn("Backend API unavailable, falling back to direct browser AI:", err.message);
            await executeDirectAI({ prompt: text || "Please inspect the attached screenshot / file.", messages: state.messages, attachments: currentAttachments, assistantIndex });
          } else {
            state.messages[assistantIndex] = {
              role: "assistant",
              content: `⚠️ Error executing agent loop: ${err.message}`,
              model: state.model,
              timestamp: Date.now(),
              error: true,
            };
          }
        }
      }
    } finally {
      state.busy = false;
      saveMessages();
      renderMessages();
      updateSendBtnState();
      byId("chatInput").focus();
    }
  }

  function updateSendBtnState() {
    const btn = byId("chatSendBtn");
    if (btn) btn.disabled = state.busy;
  }

  // ==========================================
  // Render Messages / Welcome View
  // ==========================================
  function renderMessages() {
    const scroll = byId("chatMessagesScroll");
    if (!scroll) return;

    scroll.innerHTML = "";

    if (state.messages.length === 0) {
      renderWelcomeHero(scroll);
      return;
    }

    state.messages.forEach((msg) => {
      const row = document.createElement("div");
      row.className = `chat-message-row ${msg.role}`;

      const avatar = document.createElement("div");
      avatar.className = `chat-avatar ${msg.role === "user" ? "user" : "claude"}`;
      avatar.textContent = msg.role === "user" ? "👤" : "⚡";

      const contentWrap = document.createElement("div");
      contentWrap.className = "chat-message-content";

      const meta = document.createElement("div");
      meta.className = "chat-message-meta";
      if (msg.role === "user") {
        meta.textContent = "You";
      } else {
        const agentName = msg.agent?.name || "NVIDIA Agent";
        meta.textContent = `${agentName} · NVIDIA NIM`;
      }

      contentWrap.appendChild(meta);

      // Render Dynamic Assignment Reason banner
      if (msg.agent?.reason) {
        const reasonTag = document.createElement("div");
        reasonTag.style.cssText = "font-size: 11px; color: #818cf8; margin-bottom: 6px; font-weight: 500;";
        reasonTag.textContent = `🎯 ${msg.agent.reason}`;
        contentWrap.appendChild(reasonTag);
      }

      // Render Attached Screenshots & Files in Message
      if (msg.attachments && msg.attachments.length > 0) {
        const attWrap = document.createElement("div");
        attWrap.className = "chat-message-attachments";
        msg.attachments.forEach((att) => {
          if (att.type?.startsWith("image/") && att.data) {
            const img = document.createElement("img");
            img.src = att.data;
            img.className = "chat-message-image-thumb";
            img.alt = att.name || "Screenshot";
            img.title = "Click to enlarge screenshot";
            img.addEventListener("click", () => {
              const previewDialog = byId("imagePreviewDialog");
              const previewImg = byId("fullImagePreviewImg");
              if (previewDialog && previewImg) {
                previewImg.src = att.data;
                previewDialog.showModal();
              }
            });
            attWrap.appendChild(img);
          } else {
            const chip = document.createElement("div");
            chip.className = "chat-message-file-chip";
            chip.innerHTML = `<span>📄</span> <strong>${escapeHtml(att.name || "file")}</strong> <span style="opacity:0.7;">(${Math.round((att.size || 0) / 1024)} KB)</span>`;
            attWrap.appendChild(chip);
          }
        });
        contentWrap.appendChild(attWrap);
      }

      // Render Autonomous Agent Tool Execution Steps
      if (msg.steps && msg.steps.length > 0) {
        const stepsCard = document.createElement("div");
        stepsCard.className = "agent-steps-card";

        const count = msg.steps.length;
        stepsCard.innerHTML = `
          <div class="agent-steps-summary">
            <span>⚡ Executed ${count} autonomous tool action${count > 1 ? "s" : ""} on repository</span>
            <span style="font-size: 11px; opacity: 0.8;">▼ View details</span>
          </div>
          <div class="agent-step-list">
            ${msg.steps
              .map((step, idx) => {
                const icon = step.tool === "bash" ? "▶️" : step.tool === "write_file" ? "💾" : step.tool === "read_file" ? "📄" : "🔍";
                return `
                  <div class="agent-step-item">
                    <div class="agent-step-title">
                      <span>${icon} Step ${idx + 1}: <strong>${escapeHtml(step.tool)}</strong></span>
                      <span style="color: var(--muted); font-size: 11px;">${escapeHtml(step.arg || "")}</span>
                    </div>
                    <div class="agent-step-output">${escapeHtml(step.output || "(no output)")}</div>
                  </div>
                `;
              })
              .join("")}
          </div>
        `;

        stepsCard.querySelector(".agent-steps-summary").addEventListener("click", () => {
          const list = stepsCard.querySelector(".agent-step-list");
          list.style.display = list.style.display === "none" ? "flex" : "none";
        });

        contentWrap.appendChild(stepsCard);
      }

      const bubble = document.createElement("div");
      bubble.className = "chat-bubble";

      if (msg.pending) {
        bubble.innerHTML = '<span style="opacity: 0.7; font-style: italic;">Planning and executing workspace tools…</span>';
      } else {
        bubble.innerHTML = renderMarkdown(msg.content);
        attachCodeblockActions(bubble);
      }

      contentWrap.appendChild(bubble);

      row.appendChild(avatar);
      row.appendChild(contentWrap);

      scroll.appendChild(row);
    });

    scroll.scrollTop = scroll.scrollHeight;
  }

  function renderWelcomeHero(container) {
    const hero = document.createElement("div");
    hero.className = "chat-welcome-hero";
    hero.innerHTML = `
      <div class="chat-welcome-icon">⚡</div>
      <div class="chat-welcome-title">Claude Code Agent powered by NVIDIA NIM & Vision</div>
      <div class="chat-welcome-subtitle">
        Autonomous repository engineering agent. Paste screenshots (<code>Ctrl+V</code>), attach files (<code>📎</code>), maintain secrets (.env), and execute end-to-end Git operations.
      </div>

      <div class="chat-suggestion-grid">
        <div class="chat-suggestion-card" data-prompt="Clone https://github.com/raiaashish-code/dhanalgo-code, check .env secrets, and inspect the project architecture.">
          <div class="suggestion-card-icon">🚀</div>
          <div class="suggestion-card-title">Clone & Setup Repo</div>
          <div class="suggestion-card-prompt">Auto-clone private repo & verify environment</div>
        </div>

        <div class="chat-suggestion-card" data-prompt="Read the repository .env file and check what API credentials or variables are configured.">
          <div class="suggestion-card-icon">🔐</div>
          <div class="suggestion-card-title">Manage Secrets (.env)</div>
          <div class="suggestion-card-prompt">Read, maintain, or update .env credentials</div>
        </div>

        <div class="chat-suggestion-card" data-prompt="Run git diff and git status on the active repo and show me any uncommitted changes.">
          <div class="suggestion-card-icon">📊</div>
          <div class="suggestion-card-title">Check Git Diff & Status</div>
          <div class="suggestion-card-prompt">Inspect branches, modified files & diffs</div>
        </div>

        <div class="chat-suggestion-card" data-prompt="Create branch feature/algo-updates, implement the requested logic, commit with a descriptive message, and push upstream.">
          <div class="suggestion-card-icon">🌿</div>
          <div class="suggestion-card-title">Branch, Commit & Push</div>
          <div class="suggestion-card-prompt">End-to-end Git workflow automated by Claude Code</div>
        </div>
      </div>
    `;

    hero.querySelectorAll(".chat-suggestion-card").forEach((card) => {
      card.addEventListener("click", () => {
        const prompt = card.dataset.prompt;
        byId("chatInput").value = prompt;
        submitMessage();
      });
    });

    container.appendChild(hero);
  }

  // ==========================================
  // Markdown & Code Actions
  // ==========================================
  function renderMarkdown(text) {
    if (!text) return "";
    let html = escapeHtml(text);

    // Filter out internal tool_call tags from final user output
    html = html.replace(/```tool_call\s*\n([\s\S]*?)\n```/g, "");

    // Code blocks with syntax wrappers
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const language = lang || "code";
      return `
        <div class="chat-codeblock-wrap">
          <div class="chat-codeblock-header">
            <span>${language}</span>
            <div class="chat-codeblock-actions">
              <button class="chat-codeblock-btn copy-code-btn" type="button" data-code="${encodeURIComponent(code)}">📋 Copy</button>
              <button class="chat-codeblock-btn save-workspace-btn" type="button" data-code="${encodeURIComponent(code)}" data-lang="${language}">💾 Save to Repo</button>
            </div>
          </div>
          <pre><code>${code}</code></pre>
        </div>
      `;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Headers
    html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

    // Bold & Italics
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // Bullet points
    html = html.replace(/^\s*[-*]\s+(.*)$/gim, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>)/gim, "<ul>$1</ul>");

    // Clean up adjacent ULs
    html = html.replace(/<\/ul>\s*<ul>/g, "");

    // Line breaks
    html = html.replace(/\n\n/g, "<br/><br/>");

    return html;
  }

  function attachCodeblockActions(bubble) {
    bubble.querySelectorAll(".copy-code-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = decodeURIComponent(btn.dataset.code || "");
        navigator.clipboard.writeText(code).then(() => {
          btn.textContent = "✓ Copied!";
          setTimeout(() => (btn.textContent = "📋 Copy"), 2000);
        });
      });
    });

    bubble.querySelectorAll(".save-workspace-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const code = decodeURIComponent(btn.dataset.code || "");
        const lang = btn.dataset.lang || "txt";
        const defaultName = lang === "javascript" || lang === "js" ? "app.js" : lang === "typescript" || lang === "ts" ? "index.ts" : lang === "python" || lang === "py" ? "main.py" : lang === "html" ? "index.html" : "script." + lang;
        const filename = prompt("Enter filename to save in active repository (" + state.activeRepo.path + "):", defaultName);
        if (!filename) return;

        try {
          btn.textContent = "Saving…";
          const res = await api("/api/fs/write", {
            method: "POST",
            body: JSON.stringify({
              path: state.activeRepo.path + "/" + filename.replace(/^\//, ""),
              content: code,
            }),
          });
          btn.textContent = "✓ Saved!";
          alert("Successfully saved file to " + res.path + "! You can open and edit it in Web Studio.");
          setTimeout(() => (btn.textContent = "💾 Save to Repo"), 2500);
        } catch (err) {
          alert("Failed to save: " + err.message);
          btn.textContent = "💾 Save to Repo";
        }
      });
    });
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  window.FccChat = {
    initialize: initializeChat,
    openKeysModal: openClientKeysModal,
  };

  // Self-boot if chatRoot is in the DOM
  function autoBoot() {
    const root = byId("chatRoot");
    if (root && (!root.children || root.children.length === 0)) {
      initializeChat();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoBoot);
  } else {
    setTimeout(autoBoot, 10);
  }
})();
