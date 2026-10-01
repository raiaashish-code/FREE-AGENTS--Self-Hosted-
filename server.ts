import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { PROVIDERS, SECTIONS, POPULAR_MODELS, NVIDIA_NIM_MODELS, ProviderMeta } from "./catalog-data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = "0.0.0.0";
const VERSION = "0.3.1";

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

// In-memory configuration store
const configStore: Record<string, any> = {
  MODEL: "nvidia_nim/nvidia/nemotron-3-super-120b-a12b",
  MODEL_FABLE: null,
  MODEL_OPUS: null,
  MODEL_SONNET: null,
  MODEL_HAIKU: null,
  MODEL_FALLBACKS: null,
  REASONING_POLICY: "client",
  REASONING_FABLE: "inherit",
  REASONING_OPUS: "inherit",
  REASONING_SONNET: "inherit",
  REASONING_HAIKU: "inherit",
  PROXY_AUTH_ENABLED: false,
  ANTHROPIC_AUTH_TOKEN: "",
  PROVIDER_RATE_LIMIT: 60,
  PROVIDER_RATE_WINDOW: 60,
  PROVIDER_MAX_CONCURRENCY: 10,
  PROVIDER_PROGRESS_TIMEOUT: 120,
  HTTP_READ_TIMEOUT: 300,
  HTTP_WRITE_TIMEOUT: 30,
  DISCORD_BOT_TOKEN: null,
  TELEGRAM_BOT_TOKEN: null,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || null,
  NVIDIA_NIM_API_KEY: process.env.NVIDIA_NIM_API_KEY || null,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || null,
  GROQ_API_KEY: process.env.GROQ_API_KEY || null,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,
  MISTRAL_API_KEY: process.env.MISTRAL_API_KEY || null,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || null,
};

// In-memory integration state
const integrationState: Record<string, boolean> = {
  vscode_chat: false,
  claude_vscode: false,
  jetbrains_acp: false,
  codex: false,
  claude_desktop: false,
};

// In-memory code sessions & events
const codeEpoch = "epoch-" + Date.now();
let codeCursor = 0;
const codeSessions: any[] = [];
const codeEventClients = new Set<Response>();

function broadcastCodeEvent(type: string, data: any) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of codeEventClients) {
    try {
      client.write(payload);
    } catch {
      codeEventClients.delete(client);
    }
  }
}

// Helper: build provider status array
function getProviderStatus(): any[] {
  return PROVIDERS.map((provider) => {
    const isConnectedAccount = provider.kind === "connected_account";
    const isLocal = Boolean(provider.local);
    const keyEnv = provider.credential_env;
    const hasKey = keyEnv ? Boolean(configStore[keyEnv]) : false;

    let status = "missing_key";
    let label = "Missing key";

    if (isConnectedAccount) {
      status = "disconnected";
      label = "Not connected";
    } else if (isLocal) {
      status = "configured";
      label = "Configured";
    } else if (hasKey) {
      status = "configured";
      label = "Configured";
    }

    return {
      provider_id: provider.provider_id,
      display_name: provider.display_name,
      website_url: provider.website_url,
      logo_filename: provider.logo_filename,
      kind: isConnectedAccount ? "connected_account" : isLocal ? "local" : "remote",
      status,
      label,
      base_url: provider.default_base_url || "",
      configuration_keys: keyEnv ? [keyEnv] : [],
      missing_configuration_keys: hasKey || isLocal || isConnectedAccount ? [] : keyEnv ? [keyEnv] : [],
      settings_keys: keyEnv ? [keyEnv] : [],
    };
  });
}

// Helper: build fields list for GET /admin/api/config
function getFieldsList(): any[] {
  const modelOptions = getAllCatalogModels().map((m) => ({ value: m, label: m }));
  const fields: any[] = [
    {
      key: "MODEL",
      label: "Default Model",
      section: "models",
      type: "model",
      value: configStore.MODEL,
      configured: Boolean(configStore.MODEL),
      source: "managed",
      locked: false,
      nullable: false,
      secret: false,
      advanced: false,
      restart_required: false,
      session_sensitive: false,
      options: modelOptions,
      description: "Provider/model used when no tier-specific override applies.",
    },
    {
      key: "MODEL_FABLE",
      label: "Fable Override",
      section: "models",
      type: "optional_model",
      value: configStore.MODEL_FABLE,
      configured: Boolean(configStore.MODEL_FABLE),
      source: "managed",
      locked: false,
      nullable: true,
      secret: false,
      advanced: false,
      restart_required: false,
      session_sensitive: false,
      options: modelOptions,
      description: "Select None to use the Default Model for Fable requests.",
    },
    {
      key: "MODEL_OPUS",
      label: "Opus Override",
      section: "models",
      type: "optional_model",
      value: configStore.MODEL_OPUS,
      configured: Boolean(configStore.MODEL_OPUS),
      source: "managed",
      locked: false,
      nullable: true,
      secret: false,
      advanced: false,
      restart_required: false,
      session_sensitive: false,
      options: modelOptions,
      description: "Select None to use the Default Model for Opus requests.",
    },
    {
      key: "MODEL_SONNET",
      label: "Sonnet Override",
      section: "models",
      type: "optional_model",
      value: configStore.MODEL_SONNET,
      configured: Boolean(configStore.MODEL_SONNET),
      source: "managed",
      locked: false,
      nullable: true,
      secret: false,
      advanced: false,
      restart_required: false,
      session_sensitive: false,
      options: modelOptions,
      description: "Select None to use the Default Model for Sonnet requests.",
    },
    {
      key: "MODEL_HAIKU",
      label: "Haiku Override",
      section: "models",
      type: "optional_model",
      value: configStore.MODEL_HAIKU,
      configured: Boolean(configStore.MODEL_HAIKU),
      source: "managed",
      locked: false,
      nullable: true,
      secret: false,
      advanced: false,
      restart_required: false,
      session_sensitive: false,
      options: modelOptions,
      description: "Select None to use the Default Model for Haiku requests.",
    },
    {
      key: "MODEL_FALLBACKS",
      label: "Fallback Models",
      section: "models",
      type: "model_list",
      value: configStore.MODEL_FALLBACKS || "",
      configured: Boolean(configStore.MODEL_FALLBACKS),
      source: "managed",
      locked: false,
      nullable: true,
      secret: false,
      advanced: false,
      restart_required: false,
      session_sensitive: false,
      options: modelOptions,
      description: "Ordered fallback models to try if the active model encounters rate limits or errors. Add multiple models here.",
    },
    {
      key: "REASONING_POLICY",
      label: "Reasoning Policy",
      section: "reasoning",
      type: "select",
      value: configStore.REASONING_POLICY,
      configured: true,
      source: "managed",
      locked: false,
      nullable: false,
      secret: false,
      advanced: false,
      restart_required: false,
      session_sensitive: false,
      options: [
        { value: "inherit", label: "Inherit" },
        { value: "client", label: "From client" },
        { value: "off", label: "Off" },
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
        { value: "max", label: "Max" },
      ],
      description: "From client preserves CLI effort. Providers translate only the controls their API supports.",
    },
    {
      key: "PROXY_AUTH_ENABLED",
      label: "Require API Authentication",
      section: "runtime",
      type: "boolean",
      value: configStore.PROXY_AUTH_ENABLED,
      configured: true,
      source: "managed",
      locked: false,
      nullable: false,
      secret: false,
      advanced: false,
      restart_required: true,
      session_sensitive: false,
      options: [],
      description: "Require the retained API/CLI token on FCC API routes.",
    },
    {
      key: "ANTHROPIC_AUTH_TOKEN",
      label: "API/CLI Auth Token",
      section: "runtime",
      type: "secret",
      value: configStore.ANTHROPIC_AUTH_TOKEN ? "********" : "",
      configured: Boolean(configStore.ANTHROPIC_AUTH_TOKEN),
      source: "managed",
      locked: false,
      nullable: true,
      secret: true,
      advanced: false,
      restart_required: true,
      session_sensitive: false,
      options: [],
      description: "Retained non-empty token passed to every harness. Authentication can be disabled without clearing it.",
    },
  ];

  // Add provider key fields
  for (const provider of PROVIDERS) {
    if (provider.credential_env) {
      const rawVal = configStore[provider.credential_env];
      fields.push({
        key: provider.credential_env,
        label: `${provider.display_name} API Key`,
        section: "providers",
        type: "secret",
        value: rawVal ? "********" : null,
        configured: Boolean(rawVal),
        source: rawVal ? "managed" : "default",
        locked: false,
        nullable: true,
        secret: true,
        advanced: false,
        restart_required: false,
        session_sensitive: false,
        options: [],
        description: `API key for ${provider.display_name}.`,
      });
    }
    if (provider.local && provider.default_base_url) {
      const urlKey = `${provider.provider_id.toUpperCase()}_BASE_URL`;
      fields.push({
        key: urlKey,
        label: `${provider.display_name} Endpoint`,
        section: "providers",
        type: "text",
        value: configStore[urlKey] || provider.default_base_url,
        configured: true,
        source: "default",
        locked: false,
        nullable: false,
        secret: false,
        advanced: false,
        restart_required: false,
        session_sensitive: false,
        options: [],
        description: `Endpoint URL for ${provider.display_name}.`,
      });
    }
  }

  return fields;
}

// Serve admin asset files with accurate content types
app.get("/admin/assets/:version/:filename(*)", (req: Request, res: Response) => {
  const rawParam = req.params.filename;
  const filename = Array.isArray(rawParam) ? rawParam.join("/") : String(rawParam || "");
  const filePath = path.join(__dirname, "public", filename);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".ico": "image/x-icon",
      ".html": "text/html",
      ".json": "application/json",
    };
    if (mimeTypes[ext]) {
      res.setHeader("Content-Type", mimeTypes[ext]);
    }
    res.setHeader("Cache-Control", "no-cache");
    return res.sendFile(filePath);
  }

  // Check fallback for app-icon
  if (filename === "app-icon.svg" || filename.endsWith("app-icon.svg")) {
    const iconPath = path.join(__dirname, "public", "app-icon.svg");
    if (fs.existsSync(iconPath)) {
      res.setHeader("Content-Type", "image/svg+xml");
      return res.sendFile(iconPath);
    }
  }

  return res.status(404).send("Admin asset not found");
});

// Serve uploaded attachments and screenshots
app.get("/attachments/:filename", (req: Request, res: Response) => {
  const safeName = path.basename(req.params.filename);
  const filePath = path.join("/workspace", "attachments", safeName);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  return res.status(404).send("Attachment not found");
});

// Render the main Admin HTML page
function serveAdminPage(req: Request, res: Response) {
  const htmlPath = path.join(__dirname, "public", "index.html");
  if (!fs.existsSync(htmlPath)) {
    return res.status(500).send("index.html not found");
  }
  let html = fs.readFileSync(htmlPath, "utf-8");
  html = html.replaceAll("__FCC_VERSION__", VERSION);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.send(html);
}

// Admin UI Page Routes
app.get(["/admin", "/admin/chat", "/admin/studio", "/admin/code", "/admin/model_config", "/admin/providers", "/admin/messaging", "/admin/integrations"], serveAdminPage);

// Root route: Serve HTML if requested by browser, or JSON status if API
app.get("/", (req: Request, res: Response) => {
  const accept = req.headers.accept || "";
  if (accept.includes("text/html")) {
    return serveAdminPage(req, res);
  }
  const providerType = (configStore.MODEL || "").split("/")[0] || "gemini";
  return res.json({
    status: "ok",
    provider: providerType,
    model: configStore.MODEL,
  });
});

// Admin Configuration API
app.get("/admin/api/config", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    sections: SECTIONS,
    fields: getFieldsList(),
    paths: { managed: "/root/.free-claude-code/settings.env" },
    provider_status: getProviderStatus(),
    custom_providers: [],
    custom_providers_locked: false,
    custom_reasoning_formats: {
      thought: ["thought"],
      think: ["think"],
      reasoning_content: ["reasoning_content"],
    },
  });
});

app.post("/admin/api/config/apply", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const values = req.body?.values || {};
  for (const [k, v] of Object.entries(values)) {
    if (v !== "********") {
      configStore[k] = v;
    }
  }
  return res.json({
    applied: true,
    valid: true,
    errors: [],
    pending_fields: [],
    credential_checks: [],
    restart: null,
  });
});

// Dynamic model catalog store
let dynamicallyDiscoveredNvidiaModels: string[] = [];

async function fetchNvidiaModelsIfConfigured(): Promise<string[]> {
  const apiKey = configStore.NVIDIA_NIM_API_KEY;
  if (!apiKey) {
    return NVIDIA_NIM_MODELS;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch("https://integrate.api.nvidia.com/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (resp.ok) {
      const data: any = await resp.json();
      if (Array.isArray(data?.data)) {
        const fetched = data.data.map((item: any) => `nvidia_nim/${item.id}`);
        dynamicallyDiscoveredNvidiaModels = Array.from(new Set([...NVIDIA_NIM_MODELS, ...fetched]));
        return dynamicallyDiscoveredNvidiaModels;
      }
    }
  } catch (err) {
    // Fall back to built-in catalog if network error or timeout
  }
  return NVIDIA_NIM_MODELS;
}

function getAllCatalogModels(): string[] {
  const customNvidia = dynamicallyDiscoveredNvidiaModels.length ? dynamicallyDiscoveredNvidiaModels : NVIDIA_NIM_MODELS;
  return Array.from(new Set([...customNvidia, ...POPULAR_MODELS]));
}

function getModelLabels(models: string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const m of models) {
    const [provider, ...rest] = m.split("/");
    const slug = rest.join("/");
    const formattedSlug = slug
      .split("/")
      .pop()
      ?.replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) || slug;
    labels[m] = `${formattedSlug} (${provider})`;
  }
  return labels;
}

app.get("/admin/api/status", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const currentModel = configStore.MODEL || "gemini/gemini-2.5-flash";
  const currentProvider = currentModel.split("/")[0] || "gemini";

  const allModels = getAllCatalogModels();
  const cachedModels: Record<string, string[]> = {};
  for (const model of allModels) {
    const [p] = model.split("/");
    if (!cachedModels[p]) cachedModels[p] = [];
    cachedModels[p].push(model);
  }

  const providersReady: Record<string, string> = {
    nvidia_nim: "ready",
    gemini: "ready",
    open_router: "ready",
    groq: "ready",
    deepseek: "ready",
    mistral: "ready",
    openai_api: "ready",
  };

  return res.json({
    status: "running",
    instance_id: "fcc-node-instance",
    startup: {
      generation_id: 1,
      catalog_revision: 1,
      catalog: "ready",
      catalog_file: "ready",
      providers: providersReady,
      code: { state: "ready", sessions_count: codeSessions.length },
      messaging: { state: "ready" },
      integrations: {
        vscode_chat: { connected: integrationState.vscode_chat },
        claude_vscode: { connected: integrationState.claude_vscode },
        jetbrains_acp: { connected: integrationState.jetbrains_acp },
        codex: { connected: integrationState.codex },
        claude_desktop: { connected: integrationState.claude_desktop },
      },
    },
    host: HOST,
    port: PORT,
    model: currentModel,
    provider: currentProvider,
    pending_fields: [],
    provider_status: getProviderStatus(),
    cached_models: cachedModels,
  });
});

// Admin models list and refresh endpoint
app.get("/admin/api/models", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  await fetchNvidiaModelsIfConfigured();
  const models = getAllCatalogModels();
  return res.json({
    models,
    model_labels: getModelLabels(models),
    failed_providers: [],
  });
});

app.post("/admin/api/models/refresh", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  await fetchNvidiaModelsIfConfigured();
  const models = getAllCatalogModels();
  return res.json({
    models,
    model_labels: getModelLabels(models),
    failed_providers: [],
  });
});

// Local provider check
app.get("/admin/api/providers/local-status", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    providers: [
      { provider_id: "lmstudio", reachable: false, message: "Local provider not detected." },
      { provider_id: "llamacpp", reachable: false, message: "Local provider not detected." },
      { provider_id: "ollama", reachable: false, message: "Local provider not detected." },
    ],
  });
});

// Provider test endpoint
app.post("/admin/api/providers/:provider_id/test", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { provider_id } = req.params;

  let providerModels: string[] = [];
  if (provider_id === "nvidia_nim") {
    providerModels = await fetchNvidiaModelsIfConfigured();
  } else {
    const allModels = getAllCatalogModels();
    providerModels = allModels.filter((m) => m.startsWith(`${provider_id}/`));
  }

  return res.json({
    provider_id,
    ok: true,
    models: providerModels,
    message: `${providerModels.length} models available`,
  });
});

// Connected account status & actions
app.get("/admin/api/providers/:provider_id/auth", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { provider_id } = req.params;
  return res.json({
    provider_id,
    status: "disconnected",
    label: "Not connected",
    supported_login_modes: ["browser", "device"],
    default_login_mode: "browser",
    revision: 1,
  });
});

app.post("/admin/api/providers/:provider_id/auth/login", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { provider_id } = req.params;
  return res.json({
    provider_id,
    status: "connected",
    label: "Connected",
    mode: req.body?.mode || "browser",
    revision: 2,
  });
});

app.post("/admin/api/providers/:provider_id/auth/cancel", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { provider_id } = req.params;
  return res.json({
    provider_id,
    status: "disconnected",
    label: "Not connected",
    revision: 3,
  });
});

app.delete("/admin/api/providers/:provider_id/auth", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { provider_id } = req.params;
  return res.json({
    provider_id,
    status: "disconnected",
    label: "Not connected",
    revision: 4,
  });
});

// Integration endpoints (VS Code, Claude, Codex, JetBrains, Desktop)
const integrationHandlers = [
  { key: "vscode-chat", stateKey: "vscode_chat", name: "VS Code Chat", file: ".vscode/settings.json" },
  { key: "claude", stateKey: "claude_vscode", name: "Claude Code in VS Code", file: ".vscode/settings.json" },
  { key: "codex", stateKey: "codex", name: "Codex", file: "~/.codex/config.json" },
  { key: "jetbrains-acp", stateKey: "jetbrains_acp", name: "JetBrains ACP", file: "~/.jetbrains/acp.json" },
  { key: "claude-desktop", stateKey: "claude_desktop", name: "Claude Desktop", file: "claude_desktop_config.json" },
];

for (const intg of integrationHandlers) {
  app.get(`/admin/api/integrations/${intg.key}`, (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      connected: integrationState[intg.stateKey],
      files: [intg.file],
      error: null,
    });
  });

  app.post(`/admin/api/integrations/${intg.key}/connect`, (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    integrationState[intg.stateKey] = true;
    return res.json({
      connected: true,
      message: `Connected ${intg.name}.`,
    });
  });

  app.post(`/admin/api/integrations/${intg.key}/disconnect`, (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    integrationState[intg.stateKey] = false;
    return res.json({
      connected: false,
      message: `Disconnected ${intg.name}.`,
    });
  });

  app.post(`/admin/api/integrations/${intg.key}/refresh`, (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      connected: integrationState[intg.stateKey],
    });
  });
}

// Code Sessions Realtime Event Stream: GET /admin/api/code/events
app.get("/admin/api/code/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  codeEventClients.add(res);

  // Send feed.ready immediately
  const readyData = {
    epoch: codeEpoch,
    cursor: codeCursor,
    sessions: codeSessions.map((s) => ({
      session_id: s.id,
      session: s,
      run: s.runs && s.runs.length ? s.runs[s.runs.length - 1] : null,
      cursor: codeCursor,
    })),
  };
  res.write(`event: feed.ready\ndata: ${JSON.stringify(readyData)}\n\n`);

  req.on("close", () => {
    codeEventClients.delete(res);
  });
});

// Code Sessions Bootstrap: GET /admin/api/code/bootstrap
app.get("/admin/api/code/bootstrap", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const allModels = getAllCatalogModels();
  const catalogDetailed = allModels.map((id) => {
    const [provider, ...rest] = id.split("/");
    const slug = rest.join("/");
    const formattedSlug = slug
      .split("/")
      .pop()
      ?.replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) || slug;
    return {
      id,
      provider_id: provider,
      model_name: `${formattedSlug} (${provider})`,
      context_window_tokens: 128000,
      reasoning_efforts: ["off", "low", "medium", "high", "max"],
      default_reasoning_effort: "off",
    };
  });

  return res.json({
    epoch: codeEpoch,
    available: true,
    startup: {
      generation_id: 1,
      catalog_revision: 1,
      catalog: "ready",
    },
    models: catalogDetailed,
    harnesses: [
      { id: "codex", name: "Codex" },
      { id: "claude", name: "Claude Code" },
    ],
    message: "",
  });
});

// Code Sessions List: GET /admin/api/code/sessions
app.get("/admin/api/code/sessions", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const query = String(req.query.query || "").toLowerCase();
  let filtered = codeSessions;
  if (query) {
    filtered = filtered.filter(
      (s) =>
        s.title.toLowerCase().includes(query) ||
        s.cwd.toLowerCase().includes(query)
    );
  }
  return res.json({
    epoch: codeEpoch,
    cursor: codeCursor,
    sessions: filtered,
    next_cursor: null,
  });
});

// Code Folder Picker: POST /admin/api/code/folder-picker
app.post("/admin/api/code/folder-picker", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    path: process.cwd(),
  });
});

// Create Code Session: POST /admin/api/code/sessions
app.post("/admin/api/code/sessions", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { session_id, harness = "codex", cwd = process.cwd() } = req.body || {};
  const id = session_id || `session-${Date.now()}`;
  const currentModel = configStore.MODEL || "nvidia_nim/nvidia/nemotron-3-super-120b-a12b";
  const [provider] = currentModel.split("/");
  const folderName = path.basename(cwd) || cwd;

  const newSession: any = {
    id,
    title: `Session in ${folderName}`,
    cwd: cwd || process.cwd(),
    model: currentModel,
    provider_id: provider,
    model_name: currentModel,
    harness,
    mode: "config",
    reasoning_effort: "off",
    status: "ready",
    revision: 1,
    created_at: Date.now(),
    updated_at: Date.now(),
    context_used_tokens: 0,
    runs: [],
    items: [],
    prompts: [],
  };

  codeSessions.unshift(newSession);
  codeCursor++;

  broadcastCodeEvent("session.updated", {
    epoch: codeEpoch,
    version: 1,
    cursor: codeCursor,
    session_id: id,
    session: newSession,
    run: null,
    runs: [],
    items: [],
    prompts: [],
  });

  return res.json(newSession);
});

// Code Session Detail: GET /admin/api/code/sessions/:id
app.get("/admin/api/code/sessions/:id", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { id } = req.params;
  const session = codeSessions.find((s) => s.id === id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const currentRun = session.runs && session.runs.length ? session.runs[session.runs.length - 1] : null;
  return res.json({
    epoch: codeEpoch,
    version: session.revision || 1,
    session,
    run: currentRun,
    runs: session.runs || [],
    items: session.items || [],
    prompts: session.prompts || [],
    active_review_ids: [],
    active_prompt_ids: [],
    next_before: null,
  });
});

app.get("/admin/api/code/sessions/:id/items", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { id } = req.params;
  const session = codeSessions.find((s) => s.id === id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  return res.json({
    epoch: codeEpoch,
    version: session.revision || 1,
    items: session.items || [],
    next_before: null,
  });
});

// Update Code Session: PATCH /admin/api/code/sessions/:id
app.patch("/admin/api/code/sessions/:id", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { id } = req.params;
  const session = codeSessions.find((s) => s.id === id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  if (req.body.title !== undefined) session.title = req.body.title;
  if (req.body.model !== undefined) {
    session.model = req.body.model;
    session.provider_id = req.body.model.split("/")[0];
    session.model_name = req.body.model;
  }
  if (req.body.mode !== undefined) session.mode = req.body.mode;
  if (req.body.reasoning_effort !== undefined) session.reasoning_effort = req.body.reasoning_effort;
  session.revision = (session.revision || 1) + 1;
  session.updated_at = Date.now();
  codeCursor++;

  broadcastCodeEvent("session.updated", {
    epoch: codeEpoch,
    version: session.revision,
    cursor: codeCursor,
    session_id: id,
    session,
    run: session.runs && session.runs.length ? session.runs[session.runs.length - 1] : null,
  });

  return res.json(session);
});

// Delete Code Session: DELETE /admin/api/code/sessions/:id
app.delete("/admin/api/code/sessions/:id", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { id } = req.params;
  const index = codeSessions.findIndex((s) => s.id === id);
  if (index !== -1) {
    codeSessions.splice(index, 1);
  }
  codeCursor++;
  broadcastCodeEvent("session.deleted", {
    epoch: codeEpoch,
    session_id: id,
    cursor: codeCursor,
  });
  return res.json({ deleted: true });
});

// Submit Turn: POST /admin/api/code/sessions/:id/turns
app.post("/admin/api/code/sessions/:id/turns", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { id } = req.params;
  const { operation_id, text } = req.body || {};
  const session = codeSessions.find((s) => s.id === id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const runId = operation_id || `run-${Date.now()}`;
  const userItemId = `item-${Date.now()}-user`;
  const assistantItemId = `item-${Date.now()}-assistant`;

  const userItem = {
    id: userItemId,
    run_id: runId,
    sequence: 1,
    kind: "user",
    title: "User",
    text,
    complete: true,
  };

  const runRecord = {
    id: runId,
    ordinal: session.runs.length + 1,
    status: "running",
    error: null,
  };

  session.runs.push(runRecord);
  session.items.push(userItem);
  session.updated_at = Date.now();
  codeCursor++;

  // Return receipt immediately
  res.json({ id: runId });

  // Broadcast user message and running run
  broadcastCodeEvent("item.updated", {
    epoch: codeEpoch,
    session_id: id,
    version: session.revision,
    cursor: codeCursor,
    item: userItem,
  });
  broadcastCodeEvent("run.updated", {
    epoch: codeEpoch,
    session_id: id,
    version: session.revision,
    cursor: codeCursor,
    run: runRecord,
  });

  // Execute AI response
  setTimeout(async () => {
    let reply = `I'm Codex running in **${session.cwd}** using **${session.model}**.\n\nI received your instruction:\n> ${text}\n\nReady to work on your codebase!`;

    try {
      const apiKey = configStore.NVIDIA_NIM_API_KEY;
      if (apiKey && session.model.startsWith("nvidia_nim/")) {
        const rawModel = session.model.replace("nvidia_nim/", "");
        const apiRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: rawModel,
            messages: [
              {
                role: "system",
                content: `You are Codex & Claude, an advanced AI assistant and partner working in directory ${session.cwd}. You excel at all tasks: software engineering, writing, research, analysis, planning, mathematics, and creative problem solving. Always answer directly and helpfully based on the user's intent.`,
              },
              { role: "user", content: text },
            ],
            max_tokens: 2048,
          }),
        });
        if (apiRes.ok) {
          const resultData: any = await apiRes.json();
          const content = resultData?.choices?.[0]?.message?.content;
          if (content) {
            reply = content;
          }
        }
      }
    } catch {
      // Fallback to local reply
    }

    const assistantItem = {
      id: assistantItemId,
      run_id: runId,
      sequence: 2,
      kind: "text",
      title: "Codex",
      text: reply,
      complete: true,
    };

    session.items.push(assistantItem);
    runRecord.status = "ready";
    codeCursor++;

    broadcastCodeEvent("item.updated", {
      epoch: codeEpoch,
      session_id: id,
      version: session.revision,
      cursor: codeCursor,
      item: assistantItem,
    });

    broadcastCodeEvent("run.updated", {
      epoch: codeEpoch,
      session_id: id,
      version: session.revision,
      cursor: codeCursor,
      run: runRecord,
    });
  }, 400);
});

// Stop Turn: POST /admin/api/code/sessions/:id/stop
app.post("/admin/api/code/sessions/:id/stop", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { id } = req.params;
  const session = codeSessions.find((s) => s.id === id);
  if (session) {
    const lastRun = session.runs[session.runs.length - 1];
    if (lastRun && lastRun.status === "running") {
      lastRun.status = "interrupted";
      codeCursor++;
      broadcastCodeEvent("run.updated", {
        epoch: codeEpoch,
        session_id: id,
        version: session.revision,
        cursor: codeCursor,
        run: lastRun,
      });
    }
  }
  return res.json({ stopped: true });
});

// Models Catalog API: GET /v1/models
app.get("/v1/models", (req: Request, res: Response) => {
  const allModels = getAllCatalogModels();
  const models = allModels.map((id) => {
    const [ownedBy] = id.split("/");
    return {
      id,
      object: "model",
      created: 1700000000,
      owned_by: ownedBy || "system",
    };
  });
  return res.json({
    object: "list",
    data: models,
  });
});

// Anthropic Token Count: POST /v1/messages/count_tokens
app.post("/v1/messages/count_tokens", (req: Request, res: Response) => {
  const body = req.body || {};
  const length = JSON.stringify(body).length;
  return res.json({
    input_tokens: Math.max(1, Math.ceil(length / 4)),
  });
});

function extractAnthropicText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .filter(Boolean)
      .join("\n");
  }
  return String(content || "");
}

// Anthropic Messages API: POST /v1/messages (Used by Claude Code CLI, Claude Desktop, VS Code)
app.post("/v1/messages", async (req: Request, res: Response) => {
  const { messages = [], stream = false, model = configStore.MODEL, system, max_tokens = 4096 } = req.body;
  const requestId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const nvidiaKey = configStore.NVIDIA_NIM_API_KEY || process.env.NVIDIA_NIM_API_KEY;
  const rawModel = (configStore.MODEL || "nvidia_nim/nvidia/nemotron-3-super-120b-a12b").replace("nvidia_nim/", "");

  // Prepare OpenAI-format messages for NVIDIA NIM
  const nimMessages: any[] = [];
  if (system) {
    nimMessages.push({ role: "system", content: extractAnthropicText(system) });
  }

  for (const m of messages) {
    nimMessages.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: extractAnthropicText(m.content),
    });
  }

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const messageStart = {
      type: "message_start",
      message: {
        id: requestId,
        type: "message",
        role: "assistant",
        content: [],
        model: rawModel,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 50, output_tokens: 1 },
      },
    };
    res.write(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`);

    const blockStart = {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    };
    res.write(`event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`);

    let totalChars = 0;

    if (nvidiaKey) {
      try {
        const nimRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${nvidiaKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: rawModel,
            messages: nimMessages,
            stream: true,
            max_tokens,
          }),
        });

        if (nimRes.ok && nimRes.body) {
          const reader = nimRes.body.getReader();
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
              if (!trimmed.startsWith("data:")) continue;
              const dataStr = trimmed.slice(5).trim();
              if (dataStr === "[DONE]") continue;

              try {
                const parsed = JSON.parse(dataStr);
                const chunk = parsed.choices?.[0]?.delta?.content;
                if (chunk) {
                  totalChars += chunk.length;
                  const delta = {
                    type: "content_block_delta",
                    index: 0,
                    delta: { type: "text_delta", text: chunk },
                  };
                  res.write(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`);
                }
              } catch {}
            }
          }
        }
      } catch (err: any) {
        console.error("NVIDIA NIM streaming error in /v1/messages:", err.message);
      }
    }

    if (totalChars === 0) {
      const fallbackMsg = `[NVIDIA NIM ${rawModel}] Ready. Connect with your task.`;
      const delta = {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: fallbackMsg },
      };
      res.write(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`);
      totalChars = fallbackMsg.length;
    }

    const blockStop = { type: "content_block_stop", index: 0 };
    res.write(`event: content_block_stop\ndata: ${JSON.stringify(blockStop)}\n\n`);

    const msgDelta = {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: Math.ceil(totalChars / 4) },
    };
    res.write(`event: message_delta\ndata: ${JSON.stringify(msgDelta)}\n\n`);

    const msgStop = { type: "message_stop" };
    res.write(`event: message_stop\ndata: ${JSON.stringify(msgStop)}\n\n`);

    return res.end();
  }

  // Non-streaming JSON response from NVIDIA NIM
  let replyText = `[NVIDIA NIM ${rawModel}] Ready.`;
  if (nvidiaKey) {
    try {
      const nimRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${nvidiaKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: rawModel,
          messages: nimMessages,
          max_tokens,
        }),
      });

      if (nimRes.ok) {
        const nimData: any = await nimRes.json();
        const content = nimData.choices?.[0]?.message?.content;
        if (content) {
          replyText = content;
        }
      }
    } catch (err: any) {
      console.error("NVIDIA NIM error in /v1/messages:", err.message);
    }
  }

  return res.json({
    id: requestId,
    type: "message",
    role: "assistant",
    content: [
      {
        type: "text",
        text: replyText,
      },
    ],
    model: rawModel,
    stop_reason: "end_turn",
    usage: {
      input_tokens: 50,
      output_tokens: Math.ceil(replyText.length / 4),
    },
  });
});

// OpenAI Responses API: POST /v1/responses
app.post("/v1/responses", (req: Request, res: Response) => {
  return res.json({
    id: `resp_${Date.now()}`,
    object: "response",
    created: Math.floor(Date.now() / 1000),
    model: configStore.MODEL,
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Free Claude Code proxy active." }],
      },
    ],
    usage: { total_tokens: 25 },
  });
});

// OpenAI Chat Completions API: POST /v1/chat/completions (Used by Codex & VS Code Chat)
app.post("/v1/chat/completions", async (req: Request, res: Response) => {
  const nvidiaKey = configStore.NVIDIA_NIM_API_KEY || process.env.NVIDIA_NIM_API_KEY;
  const rawModel = (configStore.MODEL || "nvidia_nim/nvidia/nemotron-3-super-120b-a12b").replace("nvidia_nim/", "");
  const { messages = [], stream = false, max_tokens = 4096 } = req.body;

  if (nvidiaKey) {
    try {
      const nimRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${nvidiaKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: rawModel,
          messages,
          stream,
          max_tokens,
        }),
      });

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        if (nimRes.body) {
          const reader = nimRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        }
        return res.end();
      }

      if (nimRes.ok) {
        const nimData = await nimRes.json();
        return res.json(nimData);
      }
    } catch (err: any) {
      console.error("NVIDIA NIM error in /v1/chat/completions:", err.message);
    }
  }

  // Fallback response if key missing or network error
  return res.json({
    id: `chatcmpl_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: rawModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: `Free Claude Code active. Backed by NVIDIA NIM (${rawModel}).`,
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });
});

import { gitHubStudio } from "./github-studio.js";
import { nvidiaAgentEngine } from "./nvidia-agent-engine.js";

// Health check
app.get("/health", (req: Request, res: Response) => {
  return res.json({ status: "ok", app: "free-claude-code", version: VERSION });
});

// ==========================================
// NVIDIA Multi-Agent & Repo Control Endpoints
// ==========================================

// Get All Repos & Active Repo
app.get("/api/agent/repos", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const repos = await nvidiaAgentEngine.getRepositories();
  const activePath = nvidiaAgentEngine.getActiveRepoPath();
  const activeRepo = await nvidiaAgentEngine.inspectRepo(activePath);
  return res.json({ repos, activePath, activeRepo });
});

// Switch Active Repo
app.post("/api/agent/repos/active", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { path: repoPath } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: "Path is required" });
  const ok = nvidiaAgentEngine.setActiveRepoPath(repoPath);
  if (!ok) return res.status(404).json({ error: "Directory not found" });
  const activeRepo = await nvidiaAgentEngine.inspectRepo(repoPath);
  return res.json({ success: true, activePath: repoPath, activeRepo });
});

// Connect or Clone Repo into Workspace
app.post("/api/agent/repos/connect", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { url, name, token: explicitToken } = req.body || {};
  if (!url) return res.status(400).json({ error: "Git URL or filesystem path required" });
  const token = explicitToken || gitHubStudio.getToken();
  const result = await nvidiaAgentEngine.cloneOrConnectRepo(url, name, token);
  return res.json(result);
});

// Get active repo secrets (.env)
app.get("/api/agent/secrets", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const activePath = nvidiaAgentEngine.getActiveRepoPath();
  const envPath = path.join(activePath, ".env");
  const exists = fs.existsSync(envPath);
  const content = exists ? fs.readFileSync(envPath, "utf-8") : "";
  return res.json({ path: envPath, exists, content });
});

// Save active repo secrets (.env)
app.post("/api/agent/secrets", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { content } = req.body || {};
  const activePath = nvidiaAgentEngine.getActiveRepoPath();
  const envPath = path.join(activePath, ".env");
  const gitignorePath = path.join(activePath, ".gitignore");

  try {
    fs.mkdirSync(activePath, { recursive: true });
    fs.writeFileSync(envPath, content || "", "utf-8");

    // Ensure .env is in .gitignore
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, "utf-8");
      if (!gitignore.includes(".env")) {
        fs.appendFileSync(gitignorePath, "\n.env\n.env.local\n");
      }
    } else {
      fs.writeFileSync(gitignorePath, ".env\n.env.local\nnode_modules\n", "utf-8");
    }

    return res.json({ success: true, path: envPath });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// File / Screenshot Upload Endpoint
app.post("/api/agent/upload", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { name, data, type } = req.body || {};
  if (!data) return res.status(400).json({ error: "No file data provided" });

  try {
    const uploadDir = path.join("/workspace", "attachments");
    fs.mkdirSync(uploadDir, { recursive: true });

    const safeName = (name || `screenshot-${Date.now()}.png`).replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = path.join(uploadDir, safeName);

    const base64Data = data.includes("base64,") ? data.split("base64,")[1] : data;
    const buffer = Buffer.from(base64Data, "base64");
    fs.writeFileSync(filePath, buffer);

    return res.json({
      success: true,
      name: safeName,
      path: filePath,
      size: buffer.length,
      type: type || "image/png",
      url: `/attachments/${safeName}`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Execute Autonomous Claude Code Agent Loop
app.post("/api/agent/run", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { prompt, repoPath, agentMode = "auto", messages = [], attachments = [] } = req.body || {};
  if (!prompt && (!attachments || attachments.length === 0)) {
    return res.status(400).json({ error: "Prompt or attachment is required" });
  }

  const nvidiaKey = configStore.NVIDIA_NIM_API_KEY || process.env.NVIDIA_NIM_API_KEY;
  const geminiKey = configStore.GEMINI_API_KEY || process.env.GEMINI_API_KEY;

  const result = await nvidiaAgentEngine.runAgentLoop({
    prompt: prompt || "Please analyze the attached screenshot/file.",
    repoPath,
    agentMode,
    messages,
    attachments,
    nvidiaKey,
    geminiKey,
  });

  return res.json(result);
});

// ==========================================
// GitHub & Cloud Web Studio API Endpoints
// ==========================================

// GitHub Status: GET /api/github/status
app.get("/api/github/status", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json(gitHubStudio.getStatus());
});

// GitHub Connect: POST /api/github/connect
app.post("/api/github/connect", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { token, username, email } = req.body || {};
  if (!token) {
    return res.status(400).json({ success: false, error: "Personal Access Token is required" });
  }
  const result = await gitHubStudio.connect(token, username, email);
  if (!result.success) {
    return res.status(401).json(result);
  }
  return res.json(result);
});

// GitHub Disconnect: POST /api/github/disconnect
app.post("/api/github/disconnect", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json(gitHubStudio.disconnect());
});

// GitHub Repositories: GET /api/github/repos
app.get("/api/github/repos", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const result = await gitHubStudio.getRepos();
  if (!result.success) {
    return res.status(400).json(result);
  }
  return res.json(result);
});

// GitHub Clone: POST /api/github/clone
app.post("/api/github/clone", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { repo_url, repo_name } = req.body || {};
  if (!repo_url) {
    return res.status(400).json({ success: false, error: "Repository URL is required" });
  }
  const result = await gitHubStudio.cloneRepo(repo_url, repo_name);
  if (!result.success) {
    return res.status(500).json(result);
  }
  return res.json(result);
});

// Git Status: GET /api/git/status
app.get("/api/git/status", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const cwd = String(req.query.cwd || "/workspace");
  const status = await gitHubStudio.getGitStatus(cwd);
  return res.json(status);
});

// Git Commit: POST /api/git/commit
app.post("/api/git/commit", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { cwd = "/workspace", message } = req.body || {};
  if (!message) {
    return res.status(400).json({ success: false, error: "Commit message is required" });
  }
  const result = await gitHubStudio.gitCommit(cwd, message);
  if (!result.success) {
    return res.status(500).json(result);
  }
  return res.json(result);
});

// Git Push: POST /api/git/push
app.post("/api/git/push", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { cwd = "/workspace", branch } = req.body || {};
  const result = await gitHubStudio.gitPush(cwd, branch);
  if (!result.success) {
    return res.status(500).json(result);
  }
  return res.json(result);
});

// Git Pull: POST /api/git/pull
app.post("/api/git/pull", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { cwd = "/workspace" } = req.body || {};
  const result = await gitHubStudio.gitPull(cwd);
  if (!result.success) {
    return res.status(500).json(result);
  }
  return res.json(result);
});

// File System Tree: GET /api/fs/tree
app.get("/api/fs/tree", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const cwd = String(req.query.cwd || "/workspace");
  const tree = gitHubStudio.getFsTree(cwd);
  return res.json({ tree, cwd });
});

// File System Read: GET /api/fs/read
app.get("/api/fs/read", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const filePath = String(req.query.path || "");
  if (!filePath) {
    return res.status(400).json({ success: false, error: "File path is required" });
  }
  const result = gitHubStudio.readFile(filePath);
  if (!result.success) {
    return res.status(404).json(result);
  }
  return res.json(result);
});

// File System Write: POST /api/fs/write
app.post("/api/fs/write", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { path: filePath, content } = req.body || {};
  if (!filePath) {
    return res.status(400).json({ success: false, error: "File path is required" });
  }
  const result = gitHubStudio.writeFile(filePath, content ?? "");
  if (!result.success) {
    return res.status(500).json(result);
  }
  return res.json(result);
});

// File System Create: POST /api/fs/create
app.post("/api/fs/create", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { path: targetPath, type = "file" } = req.body || {};
  if (!targetPath) {
    return res.status(400).json({ success: false, error: "Target path is required" });
  }
  const result = gitHubStudio.createFsItem(targetPath, type);
  if (!result.success) {
    return res.status(500).json(result);
  }
  return res.json(result);
});

// File System Delete: POST /api/fs/delete
app.post("/api/fs/delete", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { path: targetPath } = req.body || {};
  if (!targetPath) {
    return res.status(400).json({ success: false, error: "Target path is required" });
  }
  const result = gitHubStudio.deleteFsItem(targetPath);
  if (!result.success) {
    return res.status(500).json(result);
  }
  return res.json(result);
});

// Terminal Run Command: POST /api/terminal/run
app.post("/api/terminal/run", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { command, cwd = "/workspace" } = req.body || {};
  if (!command) {
    return res.status(400).json({ stdout: "", stderr: "No command provided", exitCode: 1 });
  }
  const result = await gitHubStudio.runTerminalCommand(command, cwd);
  return res.json(result);
});

// AI Code Assist: POST /api/ai/code-assist
app.post("/api/ai/code-assist", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { prompt, currentFile, fileContent, cwd = "/workspace", action = "chat" } = req.body || {};

  const currentModel = configStore.MODEL || "nvidia_nim/nvidia/nemotron-3-super-120b-a12b";
  const apiKey = configStore.NVIDIA_NIM_API_KEY;

  let systemPrompt = `You are Claude Code & Codex, an advanced AI partner working in ${cwd}.
Current file: ${currentFile || "None"}
You are versatile and excel at all AI capabilities:
- Writing, editing, and summarizing documents, reports, proposals, and emails.
- Analyzing data, architectures, research, and logical problem solving.
- Writing, reviewing, fixing, refactoring, and explaining code across all programming languages.
When producing or modifying code, provide the code cleanly in standard markdown codeblocks with language tags. If the user asks general questions, essays, plans, or analysis, respond naturally and thoroughly.`;

  let userPrompt = prompt;
  if (fileContent) {
    userPrompt = `Current file (${currentFile || "unnamed"}):\n\`\`\`\n${fileContent}\n\`\`\`\n\nRequest: ${prompt}`;
  }

  try {
    if (apiKey && currentModel.startsWith("nvidia_nim/")) {
      const rawModel = currentModel.replace("nvidia_nim/", "");
      const apiRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: rawModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 3000,
        }),
      });

      if (apiRes.ok) {
        const resData: any = await apiRes.json();
        const content = resData?.choices?.[0]?.message?.content || "";
        // Extract codeblock if present
        const codeMatch = content.match(/```(?:\w+)?\n([\s\S]*?)```/);
        const suggestedCode = codeMatch ? codeMatch[1].trim() : null;
        return res.json({
          response: content,
          suggestedCode,
          action,
          model: currentModel,
        });
      }
    }

    // Default fallback assistant response
    return res.json({
      response: `[Codex in ${cwd}]\nI analyzed your request for ${currentFile || "the workspace"}:\n\n${prompt}\n\nMake sure your NVIDIA NIM or Gemini API Key is configured in Providers to unlock live model reasoning.`,
      suggestedCode: null,
      action,
      model: currentModel,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "AI assist failed" });
  }
});

// General AI & Claude Code Chat: POST /api/chat
app.post("/api/chat", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { messages = [], model = "nemotron-3-super-120b", mode = "chat" } = req.body || {};

  if (!messages.length) {
    return res.status(400).json({ error: "Messages array cannot be empty." });
  }

  const geminiKey = configStore.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  const nvidiaKey = configStore.NVIDIA_NIM_API_KEY || process.env.NVIDIA_NIM_API_KEY;

  const isClaudeCode = mode === "claude_code" || model === "claude-code";

  if (isClaudeCode) {
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user")?.content || "";
    const agentResult = await nvidiaAgentEngine.runAgentLoop({
      prompt: lastUserMsg,
      repoPath: req.body.repoPath || nvidiaAgentEngine.getActiveRepoPath(),
      agentMode: req.body.agentMode || "auto",
      messages,
      nvidiaKey,
      geminiKey,
    });

    return res.json({
      reply: agentResult.reply,
      agent: agentResult.agent,
      model: agentResult.agent.model,
      provider: "NVIDIA NIM",
      steps: agentResult.steps,
      repoPath: agentResult.repoPath,
      gitStatus: agentResult.gitStatus,
    });
  }

  let systemInstruction = `You are an advanced, thoughtful AI assistant running on NVIDIA NIM inference (Nemotron 3 Super 120B & Frontier models).
You excel at all domains: creative writing, document drafting, strategic business analysis, research, mathematics, and full-stack software development.
Respond with clarity, warmth, and thoroughness using clean markdown formatting.`;

  const wantsGemini = model.includes("gemini") && Boolean(geminiKey);

  // 1. If Gemini explicitly requested
  if (wantsGemini) {
    try {
      const geminiContents = messages.map((m: any) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const payload = {
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: geminiContents,
        generationConfig: {
          maxOutputTokens: 3000,
          temperature: 0.7,
        },
      };

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (geminiRes.ok) {
        const geminiData: any = await geminiRes.json();
        const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return res.json({
            reply: text,
            model: "gemini-3.5-flash",
            provider: "Google AI",
          });
        }
      }
    } catch {}
  }

  // 2. Default & Primary: NVIDIA NIM (Nemotron 3 Super 120B / Llama 3.2)
  if (nvidiaKey) {
    try {
      let nimModel = "nvidia/nemotron-3-super-120b-a12b";
      if (model.includes("llama")) nimModel = "meta/llama-3.2-11b-vision-instruct";

      const nimMessages = [
        { role: "system", content: systemInstruction },
        ...messages.map((m: any) => ({ role: m.role, content: m.content })),
      ];

      const nimRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${nvidiaKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: nimModel,
          messages: nimMessages,
          max_tokens: 3000,
        }),
      });

      if (nimRes.ok) {
        const nimData: any = await nimRes.json();
        const content = nimData.choices?.[0]?.message?.content;
        if (content) {
          return res.json({
            reply: content,
            model: nimModel,
            provider: "NVIDIA NIM",
            usage: nimData.usage,
          });
        }
      }
    } catch (err: any) {
      console.error("NVIDIA NIM /api/chat error:", err.message);
    }
  }

  // 3. Fallback to Gemini if NVIDIA failed or was unavailable
  if (geminiKey) {
    try {
      const geminiContents = messages.map((m: any) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const payload = {
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: geminiContents,
        generationConfig: {
          maxOutputTokens: 3000,
          temperature: 0.7,
        },
      };

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (geminiRes.ok) {
        const geminiData: any = await geminiRes.json();
        const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return res.json({
            reply: text,
            model: "gemini-3.5-flash",
            provider: "Google AI",
          });
        }
      }
    } catch {}
  }

  // 4. Fallback message if neither succeeded
  return res.json({
    reply: `Hello! I'm your AI Assistant.\n\nI received your message: "${messages[messages.length - 1].content}".\n\nPlease verify your **NVIDIA_NIM_API_KEY** or **GEMINI_API_KEY** in the **Providers** tab to unlock live responses.`,
    model: model,
    provider: "local",
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Free Claude Code proxy running at http://${HOST}:${PORT}`);
  console.log(`Admin UI accessible at http://${HOST}:${PORT}/admin`);
});
