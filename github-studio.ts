import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface GitHubUserState {
  connected: boolean;
  token?: string;
  user?: {
    login: string;
    name: string;
    avatar_url: string;
    html_url: string;
    public_repos: number;
    total_private_repos?: number;
    email?: string;
  } | null;
}

const GITHUB_STATE_FILE = "/workspace/.fcc_github.json";

class GitHubStudioManager {
  private state: GitHubUserState = {
    connected: false,
    token: "",
    user: null,
  };

  constructor() {
    this.loadState();
  }

  private loadState() {
    try {
      if (fs.existsSync(GITHUB_STATE_FILE)) {
        const raw = fs.readFileSync(GITHUB_STATE_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.token && parsed.user) {
          this.state = parsed;
        }
      }
    } catch {
      // ignore
    }
  }

  private saveState() {
    try {
      fs.mkdirSync("/workspace", { recursive: true });
      fs.writeFileSync(GITHUB_STATE_FILE, JSON.stringify(this.state, null, 2), "utf-8");
    } catch {
      // ignore
    }
  }

  public getStatus() {
    return {
      connected: this.state.connected,
      user: this.state.user || null,
      hasToken: Boolean(this.state.token),
    };
  }

  public getToken(): string {
    return this.state.token || "";
  }

  public async connect(token: string, username?: string, email?: string): Promise<{ success: boolean; user?: any; error?: string }> {
    try {
      const cleanToken = token.trim();
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Free-Claude-Code-Studio",
        },
      });

      if (!res.ok) {
        return { success: false, error: `GitHub authentication failed: HTTP ${res.status}` };
      }

      const userData: any = await res.json();
      const userObj = {
        login: userData.login,
        name: userData.name || userData.login,
        avatar_url: userData.avatar_url,
        html_url: userData.html_url,
        public_repos: userData.public_repos || 0,
        total_private_repos: userData.total_private_repos || 0,
        email: email || userData.email || `${userData.login}@users.noreply.github.com`,
      };

      this.state = {
        connected: true,
        token: cleanToken,
        user: userObj,
      };
      this.saveState();

      // Configure git global identity and credential helper
      try {
        await execAsync(`git config --global user.name "${userObj.name}"`);
        await execAsync(`git config --global user.email "${userObj.email}"`);
        await execAsync(`git config --global url."https://${cleanToken}@github.com/".insteadOf "https://github.com/"`);
      } catch {
        // non-fatal
      }

      return { success: true, user: userObj };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to connect to GitHub" };
    }
  }

  public disconnect() {
    this.state = {
      connected: false,
      token: "",
      user: null,
    };
    try {
      if (fs.existsSync(GITHUB_STATE_FILE)) {
        fs.unlinkSync(GITHUB_STATE_FILE);
      }
    } catch {
      // ignore
    }
    return { success: true };
  }

  public async getRepos(): Promise<{ success: boolean; repos?: any[]; error?: string }> {
    if (!this.state.token) {
      return { success: false, error: "GitHub not connected. Please connect with your Personal Access Token." };
    }

    try {
      const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
        headers: {
          Authorization: `Bearer ${this.state.token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Free-Claude-Code-Studio",
        },
      });

      if (!res.ok) {
        return { success: false, error: `GitHub API error: HTTP ${res.status}` };
      }

      const rawRepos: any = await res.json();
      const repos = rawRepos.map((r: any) => ({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        private: r.private,
        description: r.description,
        html_url: r.html_url,
        clone_url: r.clone_url,
        default_branch: r.default_branch || "main",
        updated_at: r.updated_at,
        language: r.language,
        stars: r.stargazers_count || 0,
        forks: r.forks_count || 0,
      }));

      return { success: true, repos };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to fetch repositories" };
    }
  }

  public async cloneRepo(repoUrl: string, customName?: string): Promise<{ success: boolean; path?: string; name?: string; error?: string }> {
    try {
      const targetDir = "/workspace/projects";
      fs.mkdirSync(targetDir, { recursive: true });

      // Clean repo URL and name
      let cleanUrl = repoUrl.trim();
      let repoName = customName?.trim();
      if (!repoName) {
        const parts = cleanUrl.replace(/\.git$/, "").split("/");
        repoName = parts[parts.length - 1] || `repo-${Date.now()}`;
      }

      const destPath = path.join(targetDir, repoName);
      if (fs.existsSync(destPath)) {
        return { success: true, path: destPath, name: repoName };
      }

      // If token is available, inject into clone URL for authentication
      if (this.state.token && cleanUrl.startsWith("https://github.com/")) {
        const authedUrl = cleanUrl.replace("https://github.com/", `https://${this.state.token}@github.com/`);
        await execAsync(`git clone "${authedUrl}" "${destPath}"`, { timeout: 60000 });
      } else {
        await execAsync(`git clone "${cleanUrl}" "${destPath}"`, { timeout: 60000 });
      }

      return { success: true, path: destPath, name: repoName };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to clone repository" };
    }
  }

  public async getGitStatus(cwd: string) {
    const targetDir = cwd && fs.existsSync(cwd) ? cwd : "/workspace";
    try {
      const isGit = fs.existsSync(path.join(targetDir, ".git"));
      if (!isGit) {
        return { isGit: false, branch: "", clean: true, modified: [], staged: [], untracked: [] };
      }

      const { stdout: branchOut } = await execAsync("git branch --show-current", { cwd: targetDir });
      const branch = branchOut.trim() || "main";

      const { stdout: statusOut } = await execAsync("git status --porcelain", { cwd: targetDir });
      const lines = statusOut.split("\n").filter(Boolean);

      const modified: string[] = [];
      const staged: string[] = [];
      const untracked: string[] = [];

      for (const line of lines) {
        const code = line.slice(0, 2);
        const file = line.slice(3).trim();
        if (code.includes("M")) modified.push(file);
        else if (code.includes("A") || code.includes("R")) staged.push(file);
        else if (code.includes("?")) untracked.push(file);
        else modified.push(file);
      }

      const { stdout: logOut } = await execAsync("git log -1 --oneline", { cwd: targetDir }).catch(() => ({ stdout: "" }));

      return {
        isGit: true,
        branch,
        clean: lines.length === 0,
        modified,
        staged,
        untracked,
        lastCommit: logOut.trim(),
      };
    } catch {
      return { isGit: false, branch: "", clean: true, modified: [], staged: [], untracked: [] };
    }
  }

  public async gitCommit(cwd: string, message: string): Promise<{ success: boolean; output?: string; error?: string }> {
    const targetDir = cwd && fs.existsSync(cwd) ? cwd : "/workspace";
    try {
      await execAsync("git add -A", { cwd: targetDir });
      const { stdout } = await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: targetDir });
      return { success: true, output: stdout.trim() };
    } catch (err: any) {
      return { success: false, error: err.message || "Git commit failed" };
    }
  }

  public async gitPush(cwd: string, branch?: string): Promise<{ success: boolean; output?: string; error?: string }> {
    const targetDir = cwd && fs.existsSync(cwd) ? cwd : "/workspace";
    try {
      const activeBranch = branch || (await execAsync("git branch --show-current", { cwd: targetDir })).stdout.trim() || "main";

      // If token is configured, configure remote URL with token
      if (this.state.token) {
        try {
          const { stdout: remoteUrl } = await execAsync("git remote get-url origin", { cwd: targetDir });
          const cleanRemote = remoteUrl.trim();
          if (cleanRemote.includes("github.com")) {
            const rawUrl = cleanRemote.replace(/^https:\/\/.*@github\.com\//, "https://github.com/");
            const authedRemote = rawUrl.replace("https://github.com/", `https://${this.state.token}@github.com/`);
            await execAsync(`git remote set-url origin "${authedRemote}"`, { cwd: targetDir });
          }
        } catch {
          // ignore
        }
      }

      const { stdout } = await execAsync(`git push -u origin "${activeBranch}"`, { cwd: targetDir, timeout: 45000 });
      return { success: true, output: stdout.trim() };
    } catch (err: any) {
      return { success: false, error: err.message || "Git push failed" };
    }
  }

  public async gitPull(cwd: string): Promise<{ success: boolean; output?: string; error?: string }> {
    const targetDir = cwd && fs.existsSync(cwd) ? cwd : "/workspace";
    try {
      const { stdout } = await execAsync("git pull", { cwd: targetDir, timeout: 45000 });
      return { success: true, output: stdout.trim() };
    } catch (err: any) {
      return { success: false, error: err.message || "Git pull failed" };
    }
  }

  public getFsTree(cwd: string, maxDepth: number = 3): any[] {
    const baseDir = cwd && fs.existsSync(cwd) ? cwd : "/workspace";

    function buildTree(currentPath: string, depth: number): any[] {
      if (depth > maxDepth) return [];
      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        const items: any[] = [];

        // Sort folders first, then files
        const sorted = entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        for (const entry of sorted) {
          if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".cache" || entry.name === "dist") {
            continue;
          }
          const fullPath = path.join(currentPath, entry.name);
          const isDir = entry.isDirectory();

          items.push({
            name: entry.name,
            path: fullPath,
            type: isDir ? "directory" : "file",
            children: isDir ? buildTree(fullPath, depth + 1) : undefined,
          });
        }
        return items;
      } catch {
        return [];
      }
    }

    return buildTree(baseDir, 1);
  }

  public readFile(filePath: string): { success: boolean; content?: string; path?: string; name?: string; ext?: string; error?: string } {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: "File not found" };
      }
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        return { success: false, error: "Cannot read a directory as a file" };
      }
      if (stat.size > 2 * 1024 * 1024) {
        return { success: false, error: "File exceeds 2MB display limit" };
      }
      const content = fs.readFileSync(filePath, "utf-8");
      return {
        success: true,
        content,
        path: filePath,
        name: path.basename(filePath),
        ext: path.extname(filePath).toLowerCase(),
      };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to read file" };
    }
  }

  public writeFile(filePath: string, content: string): { success: boolean; path?: string; error?: string } {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
      return { success: true, path: filePath };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to write file" };
    }
  }

  public createFsItem(targetPath: string, type: "file" | "directory"): { success: boolean; path?: string; error?: string } {
    try {
      if (type === "directory") {
        fs.mkdirSync(targetPath, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        if (!fs.existsSync(targetPath)) {
          fs.writeFileSync(targetPath, "", "utf-8");
        }
      }
      return { success: true, path: targetPath };
    } catch (err: any) {
      return { success: false, error: err.message || `Failed to create ${type}` };
    }
  }

  public deleteFsItem(targetPath: string): { success: boolean; error?: string } {
    try {
      if (!fs.existsSync(targetPath)) return { success: true };
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(targetPath);
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to delete item" };
    }
  }

  public async runTerminalCommand(command: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const targetDir = cwd && fs.existsSync(cwd) ? cwd : "/workspace";
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: targetDir, timeout: 60000 });
      return { stdout, stderr, exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || err.message || "Command failed",
        exitCode: err.code || 1,
      };
    }
  }
}

export const gitHubStudio = new GitHubStudioManager();
