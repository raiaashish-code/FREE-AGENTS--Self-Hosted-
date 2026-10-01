import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { gitHubStudio } from "./github-studio.js";

const execAsync = promisify(exec);

export interface AgentStep {
  tool: string;
  arg: string;
  output: string;
  success: boolean;
  timestamp: number;
}

export interface AgentExecutionResult {
  reply: string;
  agent: {
    name: string;
    role: string;
    model: string;
    reason: string;
  };
  steps: AgentStep[];
  repoPath: string;
  gitStatus?: any;
}

export interface RepoInfo {
  name: string;
  path: string;
  isGit: boolean;
  branch: string;
  clean: boolean;
  modifiedCount: number;
  lastCommit?: string;
  remoteUrl?: string;
}

class NvidiaAgentEngine {
  private activeRepoPath: string = "/workspace";

  public getActiveRepoPath(): string {
    return this.activeRepoPath;
  }

  public setActiveRepoPath(repoPath: string): boolean {
    if (fs.existsSync(repoPath)) {
      this.activeRepoPath = repoPath;
      return true;
    }
    return false;
  }

  // List all available repositories in the workspace
  public async getRepositories(): Promise<RepoInfo[]> {
    const list: RepoInfo[] = [];

    // Check root /workspace
    const rootInfo = await this.inspectRepo("/workspace", "Workspace Root");
    list.push(rootInfo);

    // Check /workspace/projects/*
    const projectsDir = "/workspace/projects";
    if (fs.existsSync(projectsDir)) {
      try {
        const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const projectPath = path.join(projectsDir, entry.name);
            const info = await this.inspectRepo(projectPath, entry.name);
            list.push(info);
          }
        }
      } catch {
        // ignore
      }
    }

    return list;
  }

  public async inspectRepo(dirPath: string, displayName?: string): Promise<RepoInfo> {
    const name = displayName || path.basename(dirPath);
    const gitDir = path.join(dirPath, ".git");
    const isGit = fs.existsSync(gitDir);

    if (!isGit) {
      return {
        name,
        path: dirPath,
        isGit: false,
        branch: "",
        clean: true,
        modifiedCount: 0,
      };
    }

    try {
      const { stdout: branchOut } = await execAsync("git branch --show-current", { cwd: dirPath }).catch(() => ({ stdout: "main" }));
      const branch = branchOut.trim() || "main";

      const { stdout: statusOut } = await execAsync("git status --porcelain", { cwd: dirPath }).catch(() => ({ stdout: "" }));
      const modifiedLines = statusOut.split("\n").filter(Boolean);

      const { stdout: logOut } = await execAsync("git log -1 --oneline", { cwd: dirPath }).catch(() => ({ stdout: "" }));
      const { stdout: remoteOut } = await execAsync("git config --get remote.origin.url", { cwd: dirPath }).catch(() => ({ stdout: "" }));

      return {
        name,
        path: dirPath,
        isGit: true,
        branch,
        clean: modifiedLines.length === 0,
        modifiedCount: modifiedLines.length,
        lastCommit: logOut.trim(),
        remoteUrl: remoteOut.trim(),
      };
    } catch {
      return {
        name,
        path: dirPath,
        isGit: true,
        branch: "main",
        clean: true,
        modifiedCount: 0,
      };
    }
  }

  // Clone a new repo or connect an existing directory
  public async cloneOrConnectRepo(urlOrPath: string, customName?: string, token?: string): Promise<{ success: boolean; repo?: RepoInfo; error?: string }> {
    try {
      const trimmed = urlOrPath.trim();

      // Case 1: Local path on filesystem
      if (trimmed.startsWith("/") && fs.existsSync(trimmed)) {
        this.activeRepoPath = trimmed;
        const info = await this.inspectRepo(trimmed, customName);
        return { success: true, repo: info };
      }

      // Case 2: Git URL (https or git@)
      let repoName = customName?.trim();
      if (!repoName) {
        const parts = trimmed.replace(/\.git$/, "").split("/");
        repoName = parts[parts.length - 1] || `repo-${Date.now()}`;
      }

      const targetDir = path.join("/workspace/projects", repoName);

      if (fs.existsSync(targetDir)) {
        if (fs.existsSync(path.join(targetDir, ".git"))) {
          this.activeRepoPath = targetDir;
          const info = await this.inspectRepo(targetDir, repoName);
          return { success: true, repo: info };
        } else {
          // Incomplete directory, clean up
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
      }

      fs.mkdirSync("/workspace/projects", { recursive: true });

      let cloneUrl = trimmed;
      if (token && cloneUrl.startsWith("https://github.com/")) {
        cloneUrl = cloneUrl.replace("https://github.com/", `https://${token}@github.com/`);
      }

      await execAsync(`git clone "${cloneUrl}" "${targetDir}"`, { timeout: 120000 });
      this.activeRepoPath = targetDir;
      const info = await this.inspectRepo(targetDir, repoName);
      return { success: true, repo: info };
    } catch (err: any) {
      let errMsg = err.message || "Failed to clone repository";
      if (errMsg.includes("could not read Username") || errMsg.includes("Authentication failed") || errMsg.includes("Repository not found")) {
        errMsg = "Authentication required. This repository is private or requires access rights. Please connect your GitHub Personal Access Token above to access your private repositories.";
      }
      return { success: false, error: errMsg };
    }
  }

  // Dynamic Agent Classifier & Router
  public routeAgent(prompt: string, requestedMode?: string): { name: string; role: string; model: string; reason: string } {
    if (requestedMode === "architect") {
      return {
        name: "Architect & Planner Agent",
        role: "System Architecture, Design & Analysis",
        model: "nvidia/nemotron-3-super-120b-a12b",
        reason: "Selected Architect mode for deep architectural planning.",
      };
    }
    if (requestedMode === "coder") {
      return {
        name: "Code Specialist Agent",
        role: "Code Implementation, Modification & Refactoring",
        model: "nvidia/nemotron-3-super-120b-a12b",
        reason: "Selected Coder mode for hands-on file creation and editing.",
      };
    }
    if (requestedMode === "reviewer") {
      return {
        name: "Reviewer & QA Agent",
        role: "Validation, Testing & Git Management",
        model: "nvidia/nemotron-3-super-120b-a12b",
        reason: "Selected Reviewer mode for verification and test runs.",
      };
    }

    // Dynamic Intent Analysis
    const lower = prompt.toLowerCase();

    if (
      lower.includes("plan") ||
      lower.includes("design") ||
      lower.includes("architect") ||
      lower.includes("how does") ||
      lower.includes("explain why") ||
      lower.includes("system") ||
      lower.includes("compare")
    ) {
      return {
        name: "Architect & Planner Agent",
        role: "System Architecture, Design & Analysis",
        model: "nvidia/nemotron-3-super-120b-a12b",
        reason: "Dynamically assigned Architect Agent for strategic analysis and design.",
      };
    }

    if (
      lower.includes("test") ||
      lower.includes("verify") ||
      lower.includes("lint") ||
      lower.includes("status") ||
      lower.includes("commit") ||
      lower.includes("security") ||
      lower.includes("review")
    ) {
      return {
        name: "Reviewer & QA Agent",
        role: "Validation, Testing & Git Management",
        model: "nvidia/nemotron-3-super-120b-a12b",
        reason: "Dynamically assigned Reviewer & QA Agent for verification and validation.",
      };
    }

    // Default to Code Specialist Agent
    return {
      name: "Code Specialist Agent",
      role: "Autonomous Full-Stack Development",
      model: "nvidia/nemotron-3-super-120b-a12b",
      reason: "Dynamically assigned Code Specialist Agent for hands-on repo manipulation.",
    };
  }

  // Execute a specific tool in the target repo directory
  public async executeTool(tool: string, args: Record<string, any>, repoCwd: string): Promise<{ output: string; success: boolean }> {
    const cwd = repoCwd && fs.existsSync(repoCwd) ? repoCwd : this.activeRepoPath;

    try {
      switch (tool) {
        case "bash": {
          const cmd = String(args.command || "").trim();
          if (!cmd) return { output: "Error: No command specified", success: false };
          // Run command with timeout
          const { stdout, stderr } = await execAsync(cmd, { cwd, timeout: 30000 });
          const combined = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : "")).trim();
          return {
            output: combined || "(Command completed with no stdout)",
            success: true,
          };
        }

        case "read_file": {
          const relPath = String(args.path || "").trim();
          if (!relPath) return { output: "Error: No file path specified", success: false };
          const fullPath = path.isAbsolute(relPath) ? relPath : path.join(cwd, relPath);
          if (!fs.existsSync(fullPath)) {
            return { output: `Error: File not found: ${relPath}`, success: false };
          }
          const content = fs.readFileSync(fullPath, "utf-8");
          const truncated = content.length > 25000 ? content.slice(0, 25000) + "\n...[truncated remainder of file]" : content;
          return { output: truncated, success: true };
        }

        case "write_file": {
          const relPath = String(args.path || "").trim();
          const content = String(args.content ?? "");
          if (!relPath) return { output: "Error: No file path specified", success: false };
          const fullPath = path.isAbsolute(relPath) ? relPath : path.join(cwd, relPath);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, content, "utf-8");
          return { output: `Successfully wrote ${content.length} characters to ${relPath}`, success: true };
        }

        case "list_files": {
          const subPath = String(args.path || "").trim();
          const targetDir = subPath ? path.join(cwd, subPath) : cwd;
          if (!fs.existsSync(targetDir)) {
            return { output: `Directory does not exist: ${subPath || "."}`, success: false };
          }
          const items = fs.readdirSync(targetDir, { withFileTypes: true });
          const formatted = items
            .filter((item) => !item.name.startsWith(".git") && item.name !== "node_modules")
            .slice(0, 60)
            .map((item) => (item.isDirectory() ? `📁 ${item.name}/` : `📄 ${item.name}`))
            .join("\n");
          return { output: formatted || "(Directory is empty)", success: true };
        }

        case "git_status": {
          const { stdout } = await execAsync("git status --short", { cwd }).catch(() => ({ stdout: "Not a git repo" }));
          return { output: stdout.trim() || "Working tree clean, no uncommitted changes", success: true };
        }

        case "git_commit": {
          const msg = String(args.message || "Update files via Claude Code Agent").trim();
          await execAsync("git add -A", { cwd });
          const { stdout } = await execAsync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd });
          return { output: stdout.trim() || "Committed successfully", success: true };
        }

        case "git_clone": {
          const url = String(args.url || "").trim();
          const name = args.name ? String(args.name).trim() : undefined;
          if (!url) return { output: "Error: No git URL specified", success: false };
          const token = args.token || gitHubStudio.getToken();
          const result = await this.cloneOrConnectRepo(url, name, token);
          if (!result.success) return { output: `Clone failed: ${result.error}`, success: false };
          return { output: `Successfully cloned and switched workspace to: ${result.repo?.path} (branch: ${result.repo?.branch})`, success: true };
        }

        case "git_push": {
          const branch = args.branch || "main";
          const remote = args.remote || "origin";
          const token = gitHubStudio.getToken();
          if (token) {
            try {
              const { stdout: remoteUrl } = await execAsync(`git config --get remote.${remote}.url`, { cwd });
              if (remoteUrl.includes("github.com") && !remoteUrl.includes(token)) {
                const authedRemote = remoteUrl.trim().replace("https://github.com/", `https://${token}@github.com/`);
                await execAsync(`git remote set-url ${remote} "${authedRemote}"`, { cwd });
              }
            } catch {}
          }
          const { stdout, stderr } = await execAsync(`git push -u ${remote} HEAD`, { cwd, timeout: 60000 });
          return { output: (stdout + (stderr ? `\n${stderr}` : "")).trim() || "Pushed changes successfully to remote", success: true };
        }

        case "git_pull": {
          const { stdout, stderr } = await execAsync("git pull", { cwd, timeout: 30000 });
          return { output: (stdout + (stderr ? `\n${stderr}` : "")).trim() || "Already up to date", success: true };
        }

        case "git_checkout": {
          const branch = String(args.branch || "").trim();
          const create = Boolean(args.create);
          if (!branch) return { output: "Error: No branch specified", success: false };
          const cmd = create ? `git checkout -b "${branch}"` : `git checkout "${branch}"`;
          const { stdout, stderr } = await execAsync(cmd, { cwd });
          return { output: (stdout + (stderr ? `\n${stderr}` : "")).trim() || `Switched to branch ${branch}`, success: true };
        }

        case "git_diff": {
          const staged = Boolean(args.staged);
          const cmd = staged ? "git diff --staged" : "git diff";
          const { stdout } = await execAsync(cmd, { cwd });
          return { output: stdout.trim() || "No git diff", success: true };
        }

        case "manage_secrets": {
          const action = args.action || "read"; // "read" | "write" | "set"
          const envPath = path.join(cwd, ".env");
          const gitignorePath = path.join(cwd, ".gitignore");

          // Always ensure .env is safely ignored in .gitignore
          try {
            if (fs.existsSync(gitignorePath)) {
              const gitignore = fs.readFileSync(gitignorePath, "utf-8");
              if (!gitignore.includes(".env")) {
                fs.appendFileSync(gitignorePath, "\n.env\n.env.local\n");
              }
            } else {
              fs.writeFileSync(gitignorePath, ".env\n.env.local\nnode_modules\n", "utf-8");
            }
          } catch {}

          if (action === "read") {
            if (!fs.existsSync(envPath)) return { output: "No .env file found in workspace", success: true };
            const content = fs.readFileSync(envPath, "utf-8");
            const masked = content
              .split("\n")
              .map((line) => {
                const parts = line.split("=");
                if (parts.length < 2) return line;
                const k = parts[0].trim();
                const v = parts.slice(1).join("=").trim();
                if (v.length <= 4) return `${k}=••••`;
                return `${k}=${v.slice(0, 3)}••••••••${v.slice(-2)}`;
              })
              .join("\n");
            return { output: `Existing secrets in .env:\n${masked}`, success: true };
          }

          if (action === "set" || action === "write") {
            const key = String(args.key || "").trim();
            const val = String(args.value || "").trim();
            let entries: Record<string, string> = {};
            if (args.entries && typeof args.entries === "object") {
              entries = args.entries;
            } else if (key) {
              entries[key] = val;
            }

            let existingContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
            const lines = existingContent.split("\n");
            const updatedKeys = new Set<string>();

            const newLines = lines.map((line) => {
              const parts = line.split("=");
              if (parts.length >= 2) {
                const k = parts[0].trim();
                if (entries[k] !== undefined) {
                  updatedKeys.add(k);
                  return `${k}=${entries[k]}`;
                }
              }
              return line;
            });

            for (const [k, v] of Object.entries(entries)) {
              if (!updatedKeys.has(k)) {
                newLines.push(`${k}=${v}`);
              }
            }

            const cleanEnv = newLines.filter(Boolean).join("\n") + "\n";
            fs.writeFileSync(envPath, cleanEnv, "utf-8");
            return { output: `Successfully updated .env with keys: ${Object.keys(entries).join(", ")}. (.env added to .gitignore)`, success: true };
          }

          return { output: `Unknown action: ${action}`, success: false };
        }

        default:
          return { output: `Unknown tool: ${tool}`, success: false };
      }
    } catch (err: any) {
      return { output: `Execution error: ${err.message || String(err)}`, success: false };
    }
  }

  // Run the autonomous agent loop
  public async runAgentLoop(options: {
    prompt: string;
    repoPath?: string;
    agentMode?: string;
    messages?: Array<{ role: string; content: string }>;
    attachments?: Array<{ name: string; type: string; data?: string; url?: string; text?: string }>;
    nvidiaKey?: string;
    geminiKey?: string;
  }): Promise<AgentExecutionResult> {
    const { prompt, repoPath, agentMode, messages = [], attachments = [], nvidiaKey, geminiKey } = options;

    let targetRepo = repoPath && fs.existsSync(repoPath) ? repoPath : this.activeRepoPath;
    this.activeRepoPath = targetRepo;

    // Auto-capture GitHub PAT if user provided it in conversation
    const patMatch = prompt.match(/\b(ghp_[A-Za-z0-9_]{30,45}|github_pat_[A-Za-z0-9_]{60,100})\b/);
    if (patMatch) {
      await gitHubStudio.connect(patMatch[1]).catch(() => {});
    }

    // Augment prompt with attachment descriptions
    let augmentedPrompt = prompt;
    if (attachments && attachments.length > 0) {
      const attDescriptions = attachments
        .map((a) => (a.type?.startsWith("image/") ? `[Attached Screenshot: ${a.name} (saved at /workspace/attachments/${a.name})]` : `[Attached File: ${a.name}]`))
        .join("\n");
      augmentedPrompt = `${prompt}\n\n${attDescriptions}`;
    }

    // 1. Select the dynamic agent
    const agent = this.routeAgent(prompt, agentMode);

    // 2. Inspect current repo context
    const repoInfo = await this.inspectRepo(targetRepo);

    // Collect initial file layout
    let initialFiles = "";
    try {
      const entries = fs.readdirSync(targetRepo, { withFileTypes: true });
      initialFiles = entries
        .filter((e) => !e.name.startsWith(".git") && e.name !== "node_modules")
        .slice(0, 30)
        .map((e) => (e.isDirectory() ? `📁 ${e.name}/` : `📄 ${e.name}`))
        .join(", ");
    } catch {
      initialFiles = "Unable to read directory";
    }

    const systemPrompt = `You are ${agent.name}, an autonomous Claude Code engineering agent powered by NVIDIA NIM inference (${agent.model}).
Role: ${agent.role}
Active Workspace: ${targetRepo}
Git Branch: ${repoInfo.branch || "none"} (Modified: ${repoInfo.modifiedCount} files)
Files in repo: ${initialFiles || "(empty)"}

You have full control over this repository and can execute real actions using tool calls.
To use a tool, output a JSON tool call block in your response formatted EXACTLY like this:
\`\`\`tool_call
{"tool": "bash", "command": "npm test"}
\`\`\`
or
\`\`\`tool_call
{"tool": "read_file", "path": "package.json"}
\`\`\`
or
\`\`\`tool_call
{"tool": "write_file", "path": "src/index.js", "content": "console.log('hello world');"}
\`\`\`
or
\`\`\`tool_call
{"tool": "list_files", "path": "src"}
\`\`\`
or
\`\`\`tool_call
{"tool": "git_clone", "url": "https://github.com/...", "name": "repo-name"}
\`\`\`
or
\`\`\`tool_call
{"tool": "git_commit", "message": "Add feature"}
\`\`\`
or
\`\`\`tool_call
{"tool": "git_push", "branch": "main"}
\`\`\`
or
\`\`\`tool_call
{"tool": "git_pull"}
\`\`\`
or
\`\`\`tool_call
{"tool": "git_checkout", "branch": "feature/login", "create": true}
\`\`\`
or
\`\`\`tool_call
{"tool": "git_diff"}
\`\`\`
or
\`\`\`tool_call
{"tool": "git_status"}
\`\`\`
or
\`\`\`tool_call
{"tool": "manage_secrets", "action": "set", "entries": {"API_KEY": "secret_value"}}
\`\`\`
or
\`\`\`tool_call
{"tool": "manage_secrets", "action": "read"}
\`\`\`

END-TO-END AUTOMATION PRINCIPLES (LIKE CLAUDE CODE & CURSOR):
1. COMPLETE THE ENTIRE LIFECYCLE: Do NOT ask the user to manually run Git commands or create files. YOU must execute them using the tools above.
2. GIT AUTOMATION:
   - When asked to clone a repo: Call \`git_clone\` immediately.
   - When asked to implement or fix something: Inspect files, call \`write_file\`, test with \`bash\`, call \`git_commit\`, and if asked or appropriate, call \`git_push\`.
   - When asked to branch: Call \`git_checkout\`.
   - When asked to inspect changes: Call \`git_diff\` or \`git_status\`.
3. REPO SECRETS & ENVIRONMENT AUTOMATION:
   - If secrets or environment variables are provided or required (e.g. API keys, client tokens, credentials), use \`manage_secrets\` to write them into \`.env\` in the repository.
   - \`manage_secrets\` automatically adds \`.env\` to \`.gitignore\` so secrets are never pushed to GitHub.
4. After executing tools, summarize the actions taken, the files modified, git commits, and the current status.`;

    const conversation: any[] = [
      { role: "system", content: systemPrompt },
      ...messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: augmentedPrompt },
    ];

    const steps: AgentStep[] = [];
    let finalReply = "";
    const MAX_TURNS = 5;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      // Call model (NVIDIA NIM or Gemini fallback)
      let modelResponse = "";

      if (nvidiaKey) {
        try {
          const rawModel = agent.model.replace("nvidia_nim/", "");
          const nimRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${nvidiaKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: rawModel,
              messages: conversation,
              max_tokens: 3000,
            }),
          });

          if (nimRes.ok) {
            const data: any = await nimRes.json();
            modelResponse = data.choices?.[0]?.message?.content || "";
          }
        } catch {
          // fall through
        }
      }

      if (!modelResponse && geminiKey) {
        try {
          const geminiContents = conversation.map((c, idx) => {
            const isLatestUser = c.role === "user" && idx === conversation.length - 1;
            const parts: any[] = [{ text: c.content }];

            if (isLatestUser && attachments && attachments.length > 0) {
              for (const att of attachments) {
                if (att.data && att.type?.startsWith("image/")) {
                  const cleanBase64 = att.data.includes("base64,") ? att.data.split("base64,")[1] : att.data;
                  parts.push({
                    inlineData: {
                      mimeType: att.type,
                      data: cleanBase64,
                    },
                  });
                }
              }
            }

            return {
              role: c.role === "assistant" ? "model" : "user",
              parts,
            };
          });
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contents: geminiContents }),
            }
          );
          if (geminiRes.ok) {
            const data: any = await geminiRes.json();
            modelResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
          }
        } catch {
          // fall through
        }
      }

      if (!modelResponse) {
        finalReply = `[${agent.name}]\nI processed your request for ${targetRepo}. Please check your NVIDIA NIM API key configuration.`;
        break;
      }

      // Check if the model emitted a tool call
      const toolMatch = modelResponse.match(/```tool_call\s*\n([\s\S]*?)\n```/);

      if (!toolMatch) {
        // No more tool calls, model gave final answer
        finalReply = modelResponse;
        break;
      }

      // Execute tool
      let toolParsed: any = null;
      try {
        toolParsed = JSON.parse(toolMatch[1].trim());
      } catch {
        finalReply = modelResponse;
        break;
      }

      const toolName = toolParsed.tool;
      const toolArgs = toolParsed;
      const toolResult = await this.executeTool(toolName, toolArgs, targetRepo);

      if (toolName === "git_clone" && toolResult.success) {
        targetRepo = this.activeRepoPath;
      }

      const step: AgentStep = {
        tool: toolName,
        arg: toolArgs.command || toolArgs.path || toolArgs.message || "",
        output: toolResult.output,
        success: toolResult.success,
        timestamp: Date.now(),
      };
      steps.push(step);

      // Add assistant response and tool result to conversation for next turn
      conversation.push({ role: "assistant", content: modelResponse });
      conversation.push({
        role: "user",
        content: `[TOOL_RESULT for ${toolName}]:\n${toolResult.output}\n\nContinue with your next step or provide your final response if done.`,
      });
    }

    // Refresh git status after agent actions
    const finalGitStatus = await this.inspectRepo(targetRepo);

    return {
      reply: finalReply || "Completed execution steps.",
      agent,
      steps,
      repoPath: targetRepo,
      gitStatus: finalGitStatus,
    };
  }
}

export const nvidiaAgentEngine = new NvidiaAgentEngine();
