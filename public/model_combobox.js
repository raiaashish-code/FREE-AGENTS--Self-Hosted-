(() => {
  function getModelCategoryInfo(value) {
    if (!value || value === "None") {
      return { category: "System", group: "system", badge: "System", icon: "↺" };
    }
    const [provider, ...rest] = value.split("/");
    const slug = (rest.join("/") || "").toLowerCase();

    if (provider === "nvidia_nim") {
      if (slug.includes("nemotron") || slug.includes("minitron") || slug.includes("neva") || slug.startsWith("nvidia/")) {
        return { category: "NVIDIA Nemotron", group: "nemotron", badge: "Nemotron", icon: "⚡" };
      }
      if (slug.includes("llama") || slug.includes("codellama") || slug.startsWith("meta/")) {
        return { category: "NVIDIA NIM - Meta Llama", group: "llama", badge: "Meta Llama", icon: "🦙" };
      }
      if (slug.includes("deepseek")) {
        return { category: "NVIDIA NIM - DeepSeek", group: "deepseek", badge: "DeepSeek", icon: "🧠" };
      }
      if (slug.includes("qwen") || slug.includes("qwq")) {
        return { category: "NVIDIA NIM - Qwen Coding", group: "qwen", badge: "Qwen", icon: "💻" };
      }
      if (slug.includes("mistral") || slug.includes("mixtral") || slug.includes("codestral")) {
        return { category: "NVIDIA NIM - Mistral & Codestral", group: "mistral", badge: "Mistral", icon: "🌪️" };
      }
      if (slug.includes("phi") || slug.includes("gemma") || slug.includes("granite")) {
        return { category: "NVIDIA NIM - Phi & Gemma", group: "other_nim", badge: "Phi/Gemma", icon: "🔷" };
      }
      return { category: "NVIDIA NIM - Partner Models", group: "other_nim", badge: "NVIDIA NIM", icon: "📦" };
    }
    if (provider === "gemini") {
      return { category: "Google Gemini", group: "gemini", badge: "Gemini", icon: "✨" };
    }
    if (provider === "open_router") {
      return { category: "OpenRouter", group: "openrouter", badge: "OpenRouter", icon: "🌐" };
    }
    if (provider === "groq") {
      return { category: "Groq High-Speed", group: "groq", badge: "Groq", icon: "⚡" };
    }
    if (provider === "deepseek") {
      return { category: "DeepSeek Direct", group: "deepseek", badge: "DeepSeek", icon: "🧠" };
    }
    if (provider === "mistral" || provider === "mistral_codestral") {
      return { category: "Mistral AI", group: "mistral", badge: "Mistral", icon: "🌪️" };
    }
    if (provider === "openai" || provider === "openai_api") {
      return { category: "OpenAI", group: "openai", badge: "OpenAI", icon: "🤖" };
    }
    if (provider === "ollama" || provider === "lmstudio" || provider === "llamacpp") {
      return { category: "Local Providers", group: "local", badge: "Local", icon: "🖥️" };
    }
    return { category: "Other Providers", group: "other", badge: provider, icon: "🔌" };
  }

  const FILTER_CHIPS = [
    { id: "all", label: "All" },
    { id: "nemotron", label: "⚡ Nemotron" },
    { id: "llama", label: "🦙 Llama" },
    { id: "deepseek", label: "🧠 DeepSeek" },
    { id: "qwen", label: "💻 Qwen" },
    { id: "mistral", label: "🌪️ Mistral" },
    { id: "gemini", label: "✨ Gemini" },
    { id: "openrouter", label: "🌐 OpenRouter" },
    { id: "local", label: "🖥️ Local" },
  ];

  class FccModelCombobox {
    constructor(
      input,
      {
        listboxId,
        label,
        values,
        emptyMessage,
        registry,
        displayValue = (value) => value,
        onSelect = null,
        onClose = null,
      },
    ) {
      this.input = input;
      this.displayValue = displayValue;
      this.getValues = values;
      this.getEmptyMessage = emptyMessage;
      this.registry = registry;
      this.onSelect = onSelect;
      this.onClose = onClose;
      this.activeIndex = -1;
      this.query = "";
      this.activeGroupFilter = "all";

      this.element = document.createElement("div");
      this.element.className = "model-combobox";
      this.listbox = document.createElement("div");
      this.listbox.className = "model-combobox-list";
      this.listbox.id = listboxId;
      this.listbox.setAttribute("role", "listbox");
      this.listbox.hidden = true;
      this.toggle = document.createElement("button");
      this.toggle.type = "button";
      this.toggle.className = "model-combobox-toggle";
      this.toggle.disabled = input.disabled;
      this.toggle.setAttribute("aria-label", `Show ${label} options`);

      input.setAttribute("role", "combobox");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-haspopup", "listbox");
      for (const control of [input, this.toggle]) {
        control.setAttribute("aria-controls", this.listbox.id);
        control.setAttribute("aria-expanded", "false");
      }

      input.addEventListener("click", () => {
        this.open("");
        input.select();
      });
      input.addEventListener("focus", () => {
        input.select();
      });
      input.addEventListener("input", () => {
        this.activeGroupFilter = "all";
        this.open(input.value);
      });
      input.addEventListener("keydown", (event) => this.handleKeydown(event));

      this.toggle.addEventListener("mousedown", (event) => event.preventDefault());
      this.toggle.addEventListener("click", () => {
        if (this.isOpen) {
          this.close();
        } else {
          this.open("");
          input.select();
        }
        input.focus();
      });

      this.listbox.addEventListener("mousedown", (event) => event.preventDefault());
      this.listbox.addEventListener("mousemove", (event) => {
        const optionEl = event.target.closest('[role="option"]');
        if (optionEl) this.setActive(this.visibleOptions.indexOf(optionEl), false);
      });
      this.listbox.addEventListener("click", (event) => {
        const optionEl = event.target.closest('[role="option"]');
        if (optionEl) this.select(optionEl.dataset.value);
      });

      this.element.append(input, this.toggle, this.listbox);
      registry.add(this);
    }

    get isOpen() {
      return this.element.classList.contains("open");
    }

    get visibleOptions() {
      return Array.from(this.listbox.querySelectorAll('[role="option"]'));
    }

    open(query = "") {
      if (this.input.disabled) return;
      this.registry.forEach((combobox) => {
        if (combobox !== this && combobox.isOpen) combobox.close();
      });
      this.render(query);
      this.element.classList.add("open");
      this.listbox.hidden = false;
      this.setExpanded(true);
    }

    close() {
      if (!this.isOpen) return;
      this.element.classList.remove("open");
      this.listbox.hidden = true;
      this.activeIndex = -1;
      this.input.removeAttribute("aria-activedescendant");
      this.setExpanded(false);
      if (this.onClose) this.onClose();
    }

    setExpanded(expanded) {
      for (const control of [this.input, this.toggle]) {
        control.setAttribute("aria-expanded", String(expanded));
      }
    }

    render(query = "") {
      this.query = query;
      const normalizedQuery = query.trim().toLocaleLowerCase();
      const allValues = this.getValues();

      // Filter by search query
      let values = normalizedQuery
        ? allValues.filter((value) =>
            (value + " " + this.displayValue(value)).toLocaleLowerCase().includes(normalizedQuery),
          )
        : allValues;

      // Filter by category chip if active
      if (this.activeGroupFilter !== "all") {
        values = values.filter((val) => {
          if (val === "None") return true;
          const info = getModelCategoryInfo(val);
          return info.group === this.activeGroupFilter;
        });
      }

      this.listbox.replaceChildren();

      // Top Filter Chips Bar
      const filterBar = document.createElement("div");
      filterBar.className = "model-combobox-filter-bar";
      FILTER_CHIPS.forEach((chip) => {
        const chipBtn = document.createElement("button");
        chipBtn.type = "button";
        chipBtn.className = `model-combobox-chip${this.activeGroupFilter === chip.id ? " active" : ""}`;
        chipBtn.textContent = chip.label;
        chipBtn.addEventListener("mousedown", (e) => e.preventDefault());
        chipBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.activeGroupFilter = chip.id;
          this.render(this.query);
        });
        filterBar.appendChild(chipBtn);
      });
      this.listbox.appendChild(filterBar);

      // Options scroll container
      const optionsContainer = document.createElement("div");
      optionsContainer.className = "model-combobox-options-scroll";

      if (values.length === 0) {
        const empty = document.createElement("div");
        empty.className = "model-combobox-empty";
        empty.textContent = this.getEmptyMessage();
        optionsContainer.appendChild(empty);
        this.listbox.appendChild(optionsContainer);
        this.activeIndex = -1;
        this.input.removeAttribute("aria-activedescendant");
        return;
      }

      // Group values by category
      const categoriesMap = new Map();
      values.forEach((value) => {
        const info = getModelCategoryInfo(value);
        if (!categoriesMap.has(info.category)) {
          categoriesMap.set(info.category, []);
        }
        categoriesMap.get(info.category).push(value);
      });

      let optionIndex = 0;
      for (const [categoryName, items] of categoriesMap.entries()) {
        const header = document.createElement("div");
        header.className = "model-combobox-header";
        const titleSpan = document.createElement("span");
        titleSpan.textContent = categoryName;
        const countSpan = document.createElement("span");
        countSpan.className = "model-combobox-count";
        countSpan.textContent = `${items.length}`;
        header.append(titleSpan, countSpan);
        optionsContainer.appendChild(header);

        items.forEach((value) => {
          const optionEl = document.createElement("div");
          optionEl.className = "model-combobox-option";
          optionEl.id = `${this.listbox.id}-option-${optionIndex++}`;
          optionEl.dataset.value = value;
          optionEl.setAttribute("role", "option");

          const info = getModelCategoryInfo(value);
          const rawDisplay = this.displayValue(value);

          const leftContent = document.createElement("div");
          leftContent.className = "model-option-content";
          const titleEl = document.createElement("div");
          titleEl.className = "model-option-title";
          titleEl.textContent = value === "None" ? "None (Inherit Default Model)" : rawDisplay;
          const slugEl = document.createElement("div");
          slugEl.className = "model-option-slug";
          slugEl.textContent = value;
          leftContent.append(titleEl, slugEl);

          const badgeEl = document.createElement("span");
          badgeEl.className = "model-option-badge";
          badgeEl.textContent = info.badge;

          optionEl.append(leftContent, badgeEl);
          optionsContainer.appendChild(optionEl);
        });
      }

      this.listbox.appendChild(optionsContainer);

      const selectedIndex = values.indexOf(this.input.value);
      this.setActive(selectedIndex >= 0 ? selectedIndex : 0, false);
    }

    setActive(index, scroll = true) {
      const options = this.visibleOptions;
      if (options.length === 0) return;
      this.activeIndex = Math.max(0, Math.min(index, options.length - 1));
      options.forEach((optionEl, optionIndex) => {
        const active = optionIndex === this.activeIndex;
        optionEl.classList.toggle("active", active);
        optionEl.setAttribute("aria-selected", String(active));
      });
      const activeOption = options[this.activeIndex];
      if (activeOption) {
        this.input.setAttribute("aria-activedescendant", activeOption.id);
        if (scroll) activeOption.scrollIntoView({ block: "nearest" });
      }
    }

    move(offset) {
      const count = this.visibleOptions.length;
      if (count) this.setActive((this.activeIndex + offset + count) % count);
    }

    select(value) {
      this.input.value = value;
      if (this.onSelect) this.onSelect(value);
      this.input.dispatchEvent(new Event("change", { bubbles: true }));
      this.close();
      this.input.focus();
    }

    handleKeydown(event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (this.isOpen) {
          this.move(event.key === "ArrowDown" ? 1 : -1);
        } else {
          this.open("");
          if (event.key === "ArrowUp") {
            this.setActive(this.visibleOptions.length - 1);
          }
        }
      } else if (this.isOpen && (event.key === "Home" || event.key === "End")) {
        event.preventDefault();
        this.setActive(event.key === "Home" ? 0 : this.visibleOptions.length - 1);
      } else if (this.isOpen && event.key === "Enter") {
        const active = this.visibleOptions[this.activeIndex];
        if (active) {
          event.preventDefault();
          this.select(active.dataset.value);
        }
      } else if (this.isOpen && event.key === "Escape") {
        event.preventDefault();
        this.close();
      } else if (this.isOpen && event.key === "Tab") {
        this.close();
      }
    }
  }

  window.FccModelCombobox = FccModelCombobox;
})();
