(() => {
  "use strict";

  const state = {
    currentCwd: "/workspace",
    projects: ["/workspace"],
    github: { connected: false, user: null },
    git: { isGit: false, branch: "main", clean: true, modified: [], staged: [], untracked: [] },
    tree: [],
    openTabs: [],
    activeTab: null,
    terminalOpen: true,
    terminalLogs: ["Welcome to Free Claude Code Web Studio.\nYour project files are mounted in /workspace.\n"],
    aiMessages: [
      {
        role: "assistant",
        text: "👋 Hi! I'm your all-in-one AI Partner (Codex, Claude & Frontier LLMs).\n\n**I can do all kinds of AI work, not just coding!**\n- ✍️ **Writing & Docs**: Draft proposals, documentation, blogs, emails, and READMEs\n- 🔍 **Research & Analysis**: Analyze datasets, summarize papers, and break down complex topics\n- 💡 **Brainstorming & Planning**: Create roadmaps, project architectures, and business plans\n- 💻 **Full-Stack Coding**: Build apps, write functions, fix bugs, and refactor code\n\nAsk me anything in the box below!",
      },
    ],
    aiBusy: false,
  };

  const byId = (id) => document.getElementById(id);

  async function api(endpoint, options = {}) {
    const res = await fetch(endpoint, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        if (err.error) msg = err.error;
      } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  // ==========================================
  // Core Studio Initializer
  // ==========================================
  async function initializeStudio() {
    const root = byId("studioRoot");
    if (!root) return;

    renderShell(root);
    await Promise.all([
      refreshGithubStatus(),
      refreshProjectsList(),
      refreshFsTree(),
      refreshGitStatus(),
    ]);
  }

  // ==========================================
  // UI Shell Renderer
  // ==========================================
  function renderShell(root) {
    root.innerHTML = `
      <div class="studio-navbar">
        <div class="studio-nav-left">
          <div class="studio-project-picker">
            <span>📁 Project:</span>
            <select id="studioProjectSelect"></select>
          </div>
          <div id="studioGitBadge" class="studio-git-badge" style="display: none;">
            <span>⑂</span>
            <span id="studioGitBranch">main</span>
            <span id="studioGitStateIndicator" class="studio-git-status-clean">● clean</span>
          </div>
        </div>
        <div class="studio-nav-right">
          <div id="studioGithubUserBadge" style="display: none;"></div>
          <button id="studioGithubBtn" class="secondary-button" type="button">Connect GitHub</button>
          <button id="studioGitCommitBtn" class="primary-button" type="button" style="display: none;">Commit & Push</button>
        </div>
      </div>

      <div class="studio-body">
        <!-- Left: File Explorer -->
        <aside class="studio-sidebar">
          <div class="studio-sidebar-header">
            <h4>Explorer</h4>
            <div class="studio-sidebar-actions">
              <button id="studioNewFileBtn" class="studio-icon-btn" title="New File">+</button>
              <button id="studioRefreshTreeBtn" class="studio-icon-btn" title="Refresh Tree">↻</button>
              <button id="studioCloneRepoBtn" class="studio-icon-btn" title="Clone from GitHub">⬇</button>
            </div>
          </div>
          <div id="studioFileTree" class="studio-file-tree"></div>
        </aside>

        <!-- Center: Code Editor & Terminal -->
        <main class="studio-main-editor">
          <div id="studioTabsBar" class="studio-tabs-bar"></div>

          <div class="editor-container">
            <div id="editorLineNumbers" class="editor-line-numbers">1</div>
            <textarea id="editorCodeInput" class="editor-code-input" placeholder="Select a file from the explorer to view or edit code..." spellcheck="false"></textarea>
            <div class="editor-floating-actions">
              <button id="editorSaveBtn" class="secondary-button" type="button" style="display: none;">Save (Ctrl+S)</button>
            </div>
          </div>

          <div class="editor-status-bar">
            <span id="editorStatusFile">No file open</span>
            <div style="display: flex; gap: 14px;">
              <span id="editorStatusCursor">Ln 1, Col 1</span>
              <span>UTF-8</span>
              <button id="toggleTerminalBtn" class="studio-icon-btn" style="width: auto; height: auto; font-size: 11px;" type="button">⚡ Terminal</button>
            </div>
          </div>

          <!-- Bottom: Terminal Drawer -->
          <div id="studioTerminalDrawer" class="studio-terminal-drawer">
            <div class="studio-terminal-header">
              <span>Terminal (${state.currentCwd})</span>
              <div style="display: flex; gap: 6px;">
                <button id="clearTerminalBtn" class="studio-icon-btn" style="width: 20px; height: 20px; font-size: 11px;" title="Clear">✕</button>
              </div>
            </div>
            <div id="studioTerminalLogs" class="studio-terminal-logs"></div>
            <form id="studioTerminalForm" class="studio-terminal-input-row">
              <span class="studio-terminal-prompt">$</span>
              <input id="studioTerminalInput" type="text" placeholder="Run command in workspace (e.g. git status, ls -la, npm test)..." autocomplete="off" />
              <button class="secondary-button" type="submit" style="padding: 2px 10px; min-height: 26px;">Run</button>
            </form>
          </div>
        </main>

        <!-- Right: AI Partner (General AI + Claude Code) -->
        <aside class="studio-ai-panel">
          <div class="studio-ai-header">
            <h4><span>🧠</span> General AI & Coding Agent</h4>
            <span id="studioAiModelBadge" class="model-option-badge">All-Purpose AI</span>
          </div>

          <div id="studioAiMessages" class="studio-ai-messages"></div>

          <div class="ai-actions-bar">
            <button class="ai-action-chip" data-action="explain">Explain</button>
            <button class="ai-action-chip" data-action="summarize">Summarize</button>
            <button class="ai-action-chip" data-action="draft">Draft Docs</button>
            <button class="ai-action-chip" data-action="fix">Fix Bugs</button>
            <button class="ai-action-chip" data-action="test">Write Tests</button>
            <button class="ai-action-chip" data-action="refactor">Refactor</button>
          </div>

          <form id="studioAiForm" class="studio-ai-composer">
            <textarea id="studioAiInput" placeholder="Ask AI anything: coding, writing, research, analysis, docs, planning..."></textarea>
            <button id="studioAiSendBtn" class="primary-button" type="submit">Ask</button>
          </form>
        </aside>
      </div>

      <!-- Modal Container -->
      <div id="studioModalContainer"></div>
    `;

    attachShellEvents();
  }

  // ==========================================
  // Attach Shell Event Handlers
  // ==========================================
  function attachShellEvents() {
    const projectSelect = byId("studioProjectSelect");
    projectSelect.addEventListener("change", (e) => {
      state.currentCwd = e.target.value;
      refreshFsTree();
      refreshGitStatus();
      appendTerminalLog(`\nSwitched project directory to: ${state.currentCwd}\n`);
    });

    byId("studioGithubBtn").addEventListener("click", openGithubModal);
    byId("studioCloneRepoBtn").addEventListener("click", openGithubModal);
    byId("studioGitCommitBtn").addEventListener("click", openGitCommitModal);
    byId("studioRefreshTreeBtn").addEventListener("click", refreshFsTree);
    byId("studioNewFileBtn").addEventListener("click", promptNewFile);

    const editorInput = byId("editorCodeInput");
    editorInput.addEventListener("input", onEditorInput);
    editorInput.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveActiveFile();
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const start = editorInput.selectionStart;
        const end = editorInput.selectionEnd;
        editorInput.value = editorInput.value.substring(0, start) + "  " + editorInput.value.substring(end);
        editorInput.selectionStart = editorInput.selectionEnd = start + 2;
        onEditorInput();
      }
    });
    editorInput.addEventListener("scroll", () => {
      byId("editorLineNumbers").scrollTop = editorInput.scrollTop;
    });

    byId("editorSaveBtn").addEventListener("click", saveActiveFile);

    // Terminal events
    byId("toggleTerminalBtn").addEventListener("click", () => {
      const drawer = byId("studioTerminalDrawer");
      state.terminalOpen = !state.terminalOpen;
      drawer.style.display = state.terminalOpen ? "flex" : "none";
    });
    byId("clearTerminalBtn").addEventListener("click", () => {
      state.terminalLogs = [];
      byId("studioTerminalLogs").textContent = "";
    });
    byId("studioTerminalForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = byId("studioTerminalInput");
      const cmd = input.value.trim();
      if (!cmd) return;
      input.value = "";
      runTerminalCommand(cmd);
    });

    // AI Coding Assist events
    byId("studioAiForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = byId("studioAiInput");
      const prompt = input.value.trim();
      if (!prompt) return;
      input.value = "";
      sendAiPrompt(prompt, "chat");
    });

    document.querySelectorAll(".ai-action-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const action = chip.dataset.action;
        const active = getActiveTab();
        if (!active) {
          alert("Please open a file first to run this AI action.");
          return;
        }
        let prompt = "";
        if (action === "explain") prompt = "Explain what this file does, its architecture, and key components.";
        else if (action === "summarize") prompt = "Provide a clear summary and key takeaways of this file.";
        else if (action === "draft") prompt = "Draft comprehensive documentation, specifications, or a README for this file.";
        else if (action === "fix") prompt = "Review this code, find any bugs or potential edge cases, and provide fixes.";
        else if (action === "test") prompt = "Write comprehensive unit tests for this code.";
        else if (action === "refactor") prompt = "Refactor this code to follow clean code standards and best practices.";
        sendAiPrompt(prompt, action);
      });
    });

    renderTerminalLogs();
    renderAiMessages();
  }

  // ==========================================
  // GitHub & Git Integration
  // ==========================================
  async function refreshGithubStatus() {
    try {
      const data = await api("/api/github/status");
      state.github = data;
      const userBadge = byId("studioGithubUserBadge");
      const connectBtn = byId("studioGithubBtn");

      if (data.connected && data.user) {
        userBadge.style.display = "flex";
        userBadge.className = "github-user-badge";
        userBadge.innerHTML = `
          <img src="${data.user.avatar_url}" alt="${data.user.login}" />
          <span>${data.user.login}</span>
        `;
        connectBtn.textContent = "GitHub Settings";
      } else {
        userBadge.style.display = "none";
        connectBtn.textContent = "Connect GitHub";
      }
    } catch {
      // ignore
    }
  }

  async function refreshProjectsList() {
    try {
      const res = await api("/api/fs/tree?cwd=/workspace/projects");
      const subdirs = (res.tree || []).filter((item) => item.type === "directory").map((d) => d.path);
      state.projects = ["/workspace", ...subdirs];

      const select = byId("studioProjectSelect");
      select.innerHTML = "";
      state.projects.forEach((proj) => {
        const opt = document.createElement("option");
        opt.value = proj;
        opt.textContent = proj === "/workspace" ? "/workspace (Root)" : `projects/${proj.split("/").pop()}`;
        if (proj === state.currentCwd) opt.selected = true;
        select.appendChild(opt);
      });
    } catch {
      // fallback
    }
  }

  async function refreshGitStatus() {
    try {
      const data = await api(`/api/git/status?cwd=${encodeURIComponent(state.currentCwd)}`);
      state.git = data;
      const badge = byId("studioGitBadge");
      const commitBtn = byId("studioGitCommitBtn");

      if (data.isGit) {
        badge.style.display = "inline-flex";
        byId("studioGitBranch").textContent = data.branch || "main";
        const indicator = byId("studioGitStateIndicator");
        if (data.clean) {
          indicator.className = "studio-git-status-clean";
          indicator.textContent = "● clean";
        } else {
          indicator.className = "studio-git-status-dirty";
          const count = data.modified.length + data.staged.length + data.untracked.length;
          indicator.textContent = `● ${count} modified`;
        }
        commitBtn.style.display = "inline-block";
      } else {
        badge.style.display = "none";
        commitBtn.style.display = "none";
      }
    } catch {
      // ignore
    }
  }

  // ==========================================
  // File Explorer & Editor
  // ==========================================
  async function refreshFsTree() {
    try {
      const data = await api(`/api/fs/tree?cwd=${encodeURIComponent(state.currentCwd)}`);
      state.tree = data.tree || [];
      renderTree(state.tree);
    } catch (err) {
      appendTerminalLog(`Error loading file tree: ${err.message}\n`);
    }
  }

  function renderTree(nodes) {
    const container = byId("studioFileTree");
    container.innerHTML = "";
    if (nodes.length === 0) {
      container.innerHTML = '<div style="padding: 14px; color: var(--muted); font-size: 12px;">Workspace is empty. Create a file or clone a repo to begin.</div>';
      return;
    }

    function createTreeElements(items, level = 0) {
      const wrap = document.createElement("div");
      items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "tree-node";
        row.style.paddingLeft = `${12 + level * 14}px`;

        const isDir = item.type === "directory";
        const icon = isDir ? "📁" : getFileIcon(item.name);
        row.innerHTML = `<span class="tree-node-icon">${icon}</span><span class="tree-node-name">${item.name}</span>`;

        if (isDir) {
          let open = false;
          let childrenEl = null;
          row.addEventListener("click", () => {
            open = !open;
            row.querySelector(".tree-node-icon").textContent = open ? "📂" : "📁";
            if (open) {
              if (!childrenEl) {
                childrenEl = createTreeElements(item.children || [], level + 1);
                wrap.insertBefore(childrenEl, row.nextSibling);
              } else {
                childrenEl.style.display = "block";
              }
            } else if (childrenEl) {
              childrenEl.style.display = "none";
            }
          });
          wrap.appendChild(row);
        } else {
          row.addEventListener("click", () => openFile(item.path));
          wrap.appendChild(row);
        }
      });
      return wrap;
    }

    container.appendChild(createTreeElements(nodes, 0));
  }

  function getFileIcon(name) {
    const ext = name.split(".").pop().toLowerCase();
    const map = {
      ts: "📘",
      tsx: "⚛️",
      js: "📒",
      jsx: "⚛️",
      py: "🐍",
      html: "🌐",
      css: "🎨",
      json: "📋",
      md: "📝",
      rs: "🦀",
      go: "🐹",
      sh: "🐚",
    };
    return map[ext] || "📄";
  }

  async function openFile(filePath) {
    const existing = state.openTabs.find((t) => t.path === filePath);
    if (existing) {
      setActiveTab(filePath);
      return;
    }

    try {
      const res = await api(`/api/fs/read?path=${encodeURIComponent(filePath)}`);
      state.openTabs.push({
        path: filePath,
        name: res.name || filePath.split("/").pop(),
        content: res.content || "",
        originalContent: res.content || "",
        dirty: false,
      });
      setActiveTab(filePath);
    } catch (err) {
      alert(`Could not open file: ${err.message}`);
    }
  }

  function getActiveTab() {
    return state.openTabs.find((t) => t.path === state.activeTab);
  }

  function setActiveTab(filePath) {
    state.activeTab = filePath;
    renderTabs();

    const tab = getActiveTab();
    const editor = byId("editorCodeInput");
    const saveBtn = byId("editorSaveBtn");

    if (tab) {
      editor.value = tab.content;
      editor.disabled = false;
      saveBtn.style.display = tab.dirty ? "inline-block" : "none";
      byId("editorStatusFile").textContent = tab.path.replace("/workspace/", "");
      updateLineNumbers();
    } else {
      editor.value = "";
      editor.disabled = true;
      saveBtn.style.display = "none";
      byId("editorStatusFile").textContent = "No file open";
      byId("editorLineNumbers").textContent = "1";
    }
  }

  function renderTabs() {
    const bar = byId("studioTabsBar");
    bar.innerHTML = "";
    state.openTabs.forEach((tab) => {
      const el = document.createElement("div");
      el.className = `studio-tab${tab.path === state.activeTab ? " active" : ""}${tab.dirty ? " dirty" : ""}`;
      el.innerHTML = `
        <span>${tab.name}</span>
        <button class="studio-tab-close" type="button" title="Close">×</button>
      `;
      el.addEventListener("click", (e) => {
        if (!e.target.classList.contains("studio-tab-close")) {
          setActiveTab(tab.path);
        }
      });
      el.querySelector(".studio-tab-close").addEventListener("click", (e) => {
        e.stopPropagation();
        closeTab(tab.path);
      });
      bar.appendChild(el);
    });
  }

  function closeTab(filePath) {
    const idx = state.openTabs.findIndex((t) => t.path === filePath);
    if (idx === -1) return;
    state.openTabs.splice(idx, 1);
    if (state.activeTab === filePath) {
      state.activeTab = state.openTabs.length ? state.openTabs[state.openTabs.length - 1].path : null;
    }
    setActiveTab(state.activeTab);
  }

  function onEditorInput() {
    const tab = getActiveTab();
    if (!tab) return;
    const editor = byId("editorCodeInput");
    tab.content = editor.value;
    tab.dirty = tab.content !== tab.originalContent;
    byId("editorSaveBtn").style.display = tab.dirty ? "inline-block" : "none";
    renderTabs();
    updateLineNumbers();
  }

  function updateLineNumbers() {
    const editor = byId("editorCodeInput");
    const lines = editor.value.split("\n").length;
    const numEl = byId("editorLineNumbers");
    let str = "";
    for (let i = 1; i <= lines; i++) str += i + "\n";
    numEl.textContent = str;

    // update cursor indicator
    const pos = editor.selectionStart;
    const before = editor.value.substring(0, pos);
    const line = before.split("\n").length;
    const col = pos - before.lastIndexOf("\n");
    byId("editorStatusCursor").textContent = `Ln ${line}, Col ${col}`;
  }

  async function saveActiveFile() {
    const tab = getActiveTab();
    if (!tab) return;
    try {
      await api("/api/fs/write", {
        method: "POST",
        body: JSON.stringify({ path: tab.path, content: tab.content }),
      });
      tab.originalContent = tab.content;
      tab.dirty = false;
      byId("editorSaveBtn").style.display = "none";
      renderTabs();
      refreshGitStatus();
      appendTerminalLog(`Saved: ${tab.path}\n`);
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    }
  }

  async function promptNewFile() {
    const name = prompt("Enter new file path (e.g. src/index.ts or app.py):");
    if (!name) return;
    const target = `${state.currentCwd}/${name.replace(/^\//, "")}`;
    try {
      await api("/api/fs/create", {
        method: "POST",
        body: JSON.stringify({ path: target, type: "file" }),
      });
      await refreshFsTree();
      openFile(target);
    } catch (err) {
      alert(`Create file failed: ${err.message}`);
    }
  }

  // ==========================================
  // Terminal Runner
  // ==========================================
  async function runTerminalCommand(cmd) {
    appendTerminalLog(`$ ${cmd}\n`);
    try {
      const res = await api("/api/terminal/run", {
        method: "POST",
        body: JSON.stringify({ command: cmd, cwd: state.currentCwd }),
      });
      if (res.stdout) appendTerminalLog(res.stdout + (res.stdout.endsWith("\n") ? "" : "\n"));
      if (res.stderr) appendTerminalLog(`[stderr]: ${res.stderr}\n`);
      if (res.exitCode !== 0) appendTerminalLog(`[Exited with code ${res.exitCode}]\n`);
      refreshGitStatus();
      refreshFsTree();
    } catch (err) {
      appendTerminalLog(`[Execution Error]: ${err.message}\n`);
    }
  }

  function appendTerminalLog(text) {
    state.terminalLogs.push(text);
    const box = byId("studioTerminalLogs");
    if (box) {
      box.textContent += text;
      box.scrollTop = box.scrollHeight;
    }
  }

  function renderTerminalLogs() {
    const box = byId("studioTerminalLogs");
    if (box) {
      box.textContent = state.terminalLogs.join("");
      box.scrollTop = box.scrollHeight;
    }
  }

  // ==========================================
  // AI Coding Agent
  // ==========================================
  async function sendAiPrompt(prompt, action = "chat") {
    if (state.aiBusy) return;
    state.aiBusy = true;
    state.aiMessages.push({ role: "user", text: prompt });
    renderAiMessages();

    const active = getActiveTab();
    try {
      const data = await api("/api/ai/code-assist", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          currentFile: active?.path || null,
          fileContent: active?.content || null,
          cwd: state.currentCwd,
          action,
        }),
      });

      state.aiMessages.push({
        role: "assistant",
        text: data.response || "No response received",
        code: data.suggestedCode || null,
      });
    } catch (err) {
      state.aiMessages.push({
        role: "assistant",
        text: `Error: ${err.message}`,
      });
    } finally {
      state.aiBusy = false;
      renderAiMessages();
    }
  }

  function renderAiMessages() {
    const container = byId("studioAiMessages");
    if (!container) return;
    container.innerHTML = "";
    state.aiMessages.forEach((msg) => {
      const b = document.createElement("div");
      b.className = `ai-bubble ${msg.role}`;
      b.innerHTML = formatMarkdownText(msg.text);

      if (msg.code) {
        const applyBtn = document.createElement("button");
        applyBtn.type = "button";
        applyBtn.className = "primary-button";
        applyBtn.style.marginTop = "8px";
        applyBtn.style.padding = "4px 10px";
        applyBtn.style.fontSize = "11px";
        applyBtn.textContent = "✓ Apply Code to Active File";
        applyBtn.addEventListener("click", () => {
          const tab = getActiveTab();
          if (!tab) {
            alert("Open a file in the editor first.");
            return;
          }
          const editor = byId("editorCodeInput");
          editor.value = msg.code;
          onEditorInput();
          alert("Applied AI generated code to editor! Hit Save (Ctrl+S) to persist.");
        });
        b.appendChild(applyBtn);
      }

      container.appendChild(b);
    });
    container.scrollTop = container.scrollHeight;
  }

  function formatMarkdownText(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br/>");
  }

  // ==========================================
  // GitHub Modal & Repositories
  // ==========================================
  async function openGithubModal() {
    const modalWrap = byId("studioModalContainer");
    modalWrap.innerHTML = `
      <div class="studio-modal-backdrop">
        <div class="studio-modal">
          <div class="studio-modal-header">
            <h3>GitHub Integration</h3>
            <button id="closeModalBtn" class="studio-icon-btn">✕</button>
          </div>
          <div class="studio-modal-body">
            <div id="githubConnectedCard" style="display: none;"></div>

            <div id="githubConnectForm">
              <p style="font-size: 13px; color: var(--text);">
                Connect with a <strong>GitHub Personal Access Token</strong> (classic or fine-grained with <code>repo</code> permissions).
                This allows you to clone your private and public repositories, commit code, and push directly from the browser without installing anything locally.
              </p>
              <div class="field" style="margin-top: 10px;">
                <label>GitHub Personal Access Token (PAT):</label>
                <input id="githubTokenInput" type="password" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" autocomplete="off" />
              </div>
              <button id="saveGithubTokenBtn" class="primary-button" style="margin-top: 12px;" type="button">Connect Account</button>
              <div style="font-size: 11px; color: var(--muted); margin-top: 8px;">
                Generate one on GitHub: <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" style="color: var(--accent);">github.com/settings/tokens</a>
              </div>
            </div>

            <hr style="border: 0; border-top: 1px solid var(--line);" />

            <div>
              <h4 style="margin: 0 0 10px 0; font-size: 13px;">Clone Any Repository by URL:</h4>
              <div style="display: flex; gap: 8px;">
                <input id="cloneUrlInput" type="text" placeholder="https://github.com/owner/repository" style="flex: 1;" />
                <button id="cloneUrlBtn" class="secondary-button" type="button">Clone</button>
              </div>
            </div>

            <div id="githubReposListWrap" style="display: none;">
              <h4 style="margin: 14px 0 8px 0; font-size: 13px;">Your GitHub Repositories:</h4>
              <div id="githubReposList" style="display: flex; flex-direction: column; gap: 8px; max-height: 240px; overflow-y: auto;"></div>
            </div>
          </div>
          <div class="studio-modal-footer">
            <button id="cancelModalBtn" class="secondary-button" type="button">Close</button>
          </div>
        </div>
      </div>
    `;

    byId("closeModalBtn").addEventListener("click", () => (modalWrap.innerHTML = ""));
    byId("cancelModalBtn").addEventListener("click", () => (modalWrap.innerHTML = ""));

    byId("saveGithubTokenBtn").addEventListener("click", async () => {
      const token = byId("githubTokenInput").value.trim();
      if (!token) return alert("Please enter your GitHub token.");
      try {
        const res = await api("/api/github/connect", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
        alert(`Successfully connected as @${res.user.login}!`);
        await refreshGithubStatus();
        renderGithubModalConnectedView();
      } catch (err) {
        alert(`Failed to connect: ${err.message}`);
      }
    });

    byId("cloneUrlBtn").addEventListener("click", async () => {
      const url = byId("cloneUrlInput").value.trim();
      if (!url) return alert("Please enter a repository URL.");
      try {
        appendTerminalLog(`Cloning repository ${url}...\n`);
        const res = await api("/api/github/clone", {
          method: "POST",
          body: JSON.stringify({ repo_url: url }),
        });
        alert(`Repository cloned to ${res.path}!`);
        state.currentCwd = res.path;
        modalWrap.innerHTML = "";
        await refreshProjectsList();
        await refreshFsTree();
        await refreshGitStatus();
      } catch (err) {
        alert(`Clone failed: ${err.message}`);
      }
    });

    if (state.github.connected) {
      renderGithubModalConnectedView();
    }
  }

  async function renderGithubModalConnectedView() {
    const card = byId("githubConnectedCard");
    const form = byId("githubConnectForm");
    const reposWrap = byId("githubReposListWrap");
    if (!card || !state.github.user) return;

    form.style.display = "none";
    card.style.display = "flex";
    card.className = "repo-card";
    card.innerHTML = `
      <img src="${state.github.user.avatar_url}" style="width: 36px; height: 36px; border-radius: 50%;" />
      <div class="repo-card-info">
        <div class="repo-card-title">${state.github.user.name} (@${state.github.user.login})</div>
        <div class="repo-card-desc">${state.github.user.public_repos} public repos · Git configured</div>
      </div>
      <button id="disconnectGithubBtn" class="ghost-button" type="button" style="color: #ef4444;">Disconnect</button>
    `;

    byId("disconnectGithubBtn").addEventListener("click", async () => {
      await api("/api/github/disconnect", { method: "POST" });
      await refreshGithubStatus();
      openGithubModal();
    });

    reposWrap.style.display = "block";
    const list = byId("githubReposList");
    list.innerHTML = '<div style="color: var(--muted); font-size: 12px;">Loading your repositories...</div>';

    try {
      const data = await api("/api/github/repos");
      list.innerHTML = "";
      (data.repos || []).forEach((repo) => {
        const item = document.createElement("div");
        item.className = "repo-card";
        item.innerHTML = `
          <div class="repo-card-info">
            <div class="repo-card-title">${repo.private ? "🔒 " : ""}${repo.name}</div>
            <div class="repo-card-desc">${repo.description || "No description"}</div>
          </div>
          <button class="primary-button clone-repo-btn" type="button" style="padding: 4px 10px; font-size: 12px;">Clone to Studio</button>
        `;
        item.querySelector(".clone-repo-btn").addEventListener("click", async () => {
          try {
            item.querySelector(".clone-repo-btn").disabled = true;
            item.querySelector(".clone-repo-btn").textContent = "Cloning...";
            appendTerminalLog(`Cloning ${repo.full_name} into workspace...\n`);
            const res = await api("/api/github/clone", {
              method: "POST",
              body: JSON.stringify({ repo_url: repo.clone_url, repo_name: repo.name }),
            });
            alert(`Repository ${repo.name} is ready!`);
            state.currentCwd = res.path;
            byId("studioModalContainer").innerHTML = "";
            await refreshProjectsList();
            await refreshFsTree();
            await refreshGitStatus();
          } catch (err) {
            alert(`Clone failed: ${err.message}`);
          }
        });
        list.appendChild(item);
      });
    } catch (err) {
      list.innerHTML = `<div style="color: #ef4444; font-size: 12px;">Failed to load repos: ${err.message}</div>`;
    }
  }

  // ==========================================
  // Git Commit & Push Modal
  // ==========================================
  async function openGitCommitModal() {
    await refreshGitStatus();
    const modalWrap = byId("studioModalContainer");
    const count = state.git.modified.length + state.git.staged.length + state.git.untracked.length;

    modalWrap.innerHTML = `
      <div class="studio-modal-backdrop">
        <div class="studio-modal">
          <div class="studio-modal-header">
            <h3>Git Commit & Push to GitHub</h3>
            <button id="closeCommitModalBtn" class="studio-icon-btn">✕</button>
          </div>
          <div class="studio-modal-body">
            <div style="font-size: 13px; color: var(--text);">
              Active Branch: <strong>${state.git.branch}</strong>
              <div style="margin-top: 4px; color: var(--muted); font-size: 12px;">
                ${count === 0 ? "Working tree is clean." : `${count} files changed`}
              </div>
            </div>

            <div style="max-height: 120px; overflow-y: auto; background: var(--panel-strong); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 8px; font-family: monospace; font-size: 11px;">
              ${[...state.git.staged.map((f) => `+ ${f}`), ...state.git.modified.map((f) => `M ${f}`), ...state.git.untracked.map((f) => `? ${f}`)].join("<br/>") || "No changes"}
            </div>

            <div class="field">
              <label>Commit Message:</label>
              <input id="gitCommitMessageInput" type="text" placeholder="e.g. Update feature and fix styling" autocomplete="off" />
            </div>
          </div>
          <div class="studio-modal-footer">
            <button id="gitPullBtn" class="secondary-button" type="button">Pull Latest</button>
            <button id="gitCommitPushBtn" class="primary-button" type="button">Commit & Push</button>
          </div>
        </div>
      </div>
    `;

    byId("closeCommitModalBtn").addEventListener("click", () => (modalWrap.innerHTML = ""));

    byId("gitPullBtn").addEventListener("click", async () => {
      try {
        appendTerminalLog(`git pull in ${state.currentCwd}...\n`);
        const res = await api("/api/git/pull", {
          method: "POST",
          body: JSON.stringify({ cwd: state.currentCwd }),
        });
        appendTerminalLog(res.output + "\n");
        alert("Pulled latest changes from GitHub!");
        await refreshFsTree();
        await refreshGitStatus();
      } catch (err) {
        alert(`Pull failed: ${err.message}`);
      }
    });

    byId("gitCommitPushBtn").addEventListener("click", async () => {
      const msg = byId("gitCommitMessageInput").value.trim();
      if (!msg) return alert("Please enter a commit message.");
      try {
        appendTerminalLog(`git commit -m "${msg}"...\n`);
        await api("/api/git/commit", {
          method: "POST",
          body: JSON.stringify({ cwd: state.currentCwd, message: msg }),
        });
        appendTerminalLog(`git push origin ${state.git.branch}...\n`);
        await api("/api/git/push", {
          method: "POST",
          body: JSON.stringify({ cwd: state.currentCwd, branch: state.git.branch }),
        });
        appendTerminalLog("Successfully pushed changes to GitHub!\n");
        alert("Changes committed and pushed to GitHub successfully!");
        modalWrap.innerHTML = "";
        await refreshGitStatus();
      } catch (err) {
        alert(`Commit or push failed: ${err.message}`);
      }
    });
  }

  window.FccStudio = {
    initialize: initializeStudio,
    openGithub: openGithubModal,
  };

  function autoBootStudio() {
    const root = byId("studioRoot");
    const isStudio = window.location.hash === "#studio" || (window.location.pathname && window.location.pathname.includes("studio"));
    if (root && isStudio && (!root.children || root.children.length === 0)) {
      initializeStudio();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoBootStudio);
  } else {
    setTimeout(autoBootStudio, 20);
  }
})();
