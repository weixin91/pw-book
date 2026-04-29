// Passkey 选择弹窗（保存 / 使用）
// 在 content script 隔离世界中渲染浮动层

interface SaveCandidate {
  id: string;
  name: string;
  username: string;
  uri: string;
}

interface GetMatch {
  id: string;
  name: string;
  rpId: string;
  credentialId: string;
}

function createContainer(): HTMLDivElement {
  let el = document.getElementById("__pwbook_passkey_prompt__") as HTMLDivElement | null;
  if (el) {
    el.remove();
  }
  el = document.createElement("div");
  el.id = "__pwbook_passkey_prompt__";
  el.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.35);
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, -apple-system, sans-serif;
  `;
  return el;
}

function closePrompt() {
  const el = document.getElementById("__pwbook_passkey_prompt__");
  if (el) el.remove();
  const card = document.getElementById("__pwbook_passkey_card__");
  if (card) card.remove();
}

// ── 保存 Passkey 弹窗 ──

export function showPasskeySavePrompt(
  candidates: SaveCandidate[],
  origin: string
): Promise<{ action: "existing"; cipherId: string } | { action: "new" }> {
  return new Promise((resolve) => {
    const container = createContainer();
    const card = document.createElement("div");
    card.style.cssText = `
      background: #fff;
      border-radius: 12px;
      width: 420px;
      max-width: 90vw;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25);
      overflow: hidden;
    `;

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px; border-bottom: 1px solid #eee;
    `;
    const title = document.createElement("span");
    title.textContent = "保存通行密钥";
    title.style.cssText = "font-size: 16px; font-weight: 600;";
    const newBtn = document.createElement("button");
    newBtn.textContent = "+ 新增";
    newBtn.style.cssText = `
      padding: 6px 14px; border-radius: 6px; border: none;
      background: #1a73e8; color: #fff; font-size: 13px; cursor: pointer;
    `;
    newBtn.onclick = () => {
      closePrompt();
      resolve({ action: "new" });
    };
    header.appendChild(title);
    header.appendChild(newBtn);
    card.appendChild(header);

    // Search
    const searchWrap = document.createElement("div");
    searchWrap.style.cssText = "padding: 12px 20px;";
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "搜索密码库";
    searchInput.style.cssText = `
      width: 100%; padding: 8px 12px; border-radius: 8px;
      border: 1px solid #ddd; font-size: 14px; box-sizing: border-box;
    `;
    searchWrap.appendChild(searchInput);
    card.appendChild(searchWrap);

    // Hint
    const hint = document.createElement("div");
    hint.textContent = "选择一个用于保存此通行密钥的登录项目";
    hint.style.cssText = "padding: 0 20px 8px; font-size: 14px; color: #333;";
    card.appendChild(hint);

    // List
    const list = document.createElement("div");
    list.style.cssText = "overflow-y: auto; padding: 0 20px 16px; flex: 1;";

    function renderItems(filter = "") {
      list.innerHTML = "";
      const filtered = candidates.filter(
        (c) =>
          c.name.toLowerCase().includes(filter.toLowerCase()) ||
          c.username.toLowerCase().includes(filter.toLowerCase())
      );

      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = "没有匹配的凭据";
        empty.style.cssText = "text-align: center; color: #999; padding: 24px; font-size: 13px;";
        list.appendChild(empty);
        return;
      }

      filtered.forEach((c) => {
        const row = document.createElement("div");
        row.style.cssText = `
          display: flex; align-items: center; gap: 12px;
          padding: 12px; border-radius: 8px; cursor: pointer;
          border: 1px solid #eee; margin-bottom: 8px;
          transition: background 0.15s;
        `;
        row.onmouseenter = () => { row.style.background = "#f5f5f5"; };
        row.onmouseleave = () => { row.style.background = "#fff"; };
        row.onclick = () => {
          closePrompt();
          resolve({ action: "existing", cipherId: c.id });
        };

        const icon = document.createElement("div");
        icon.style.cssText = `
          width: 36px; height: 36px; border-radius: 8px;
          background: #e3f2fd; display: flex; align-items: center; justify-content: center;
          font-size: 16px; flex-shrink: 0;
        `;
        icon.textContent = "🔐";

        const info = document.createElement("div");
        info.style.cssText = "flex: 1; min-width: 0;";
        const name = document.createElement("div");
        name.textContent = c.name;
        name.style.cssText = "font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
        const user = document.createElement("div");
        user.textContent = c.username || "无用户名";
        user.style.cssText = "font-size: 12px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
        info.appendChild(name);
        info.appendChild(user);

        row.appendChild(icon);
        row.appendChild(info);
        list.appendChild(row);
      });
    }

    renderItems();
    searchInput.addEventListener("input", (e) => {
      renderItems((e.target as HTMLInputElement).value);
    });
    card.appendChild(list);

    // Close on backdrop click
    container.addEventListener("click", (e) => {
      if (e.target === container) {
        closePrompt();
        resolve({ action: "new" }); // 点击空白处默认新建
      }
    });

    container.appendChild(card);
    document.body.appendChild(container);
    searchInput.focus();
  });
}

// ── 使用 Passkey 弹窗 ──

export function showPasskeyGetPrompt(
  matches: GetMatch[]
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (matches.length === 0) {
      reject(new Error("没有可用的 Passkey"));
      return;
    }

    const old = document.getElementById("__pwbook_passkey_prompt__");
    if (old) old.remove();

    // 全屏透明点击捕获层
    const backdrop = document.createElement("div");
    backdrop.id = "__pwbook_passkey_prompt__";
    backdrop.style.cssText = `
      all: initial;
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      font-family: system-ui, -apple-system, sans-serif;
    `;

    const card = document.createElement("div");
    card.id = "__pwbook_passkey_card__";
    card.style.cssText = `
      all: initial;
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      background: #fff;
      border-radius: 12px;
      width: 380px;
      max-width: calc(100vw - 32px);
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25);
      overflow: hidden;
    `;

    const header = document.createElement("div");
    header.textContent = "选择通行密钥登录";
    header.style.cssText = `
      padding: 16px 20px; font-size: 16px; font-weight: 600;
      border-bottom: 1px solid #eee;
      background: #e3f2fd;
    `;
    card.appendChild(header);

    const list = document.createElement("div");
    list.style.cssText = "overflow-y: auto; padding: 12px 20px 16px;";

    matches.forEach((m) => {
      const row = document.createElement("div");
      row.style.cssText = `
        display: flex; align-items: center; gap: 12px;
        padding: 12px; border-radius: 8px; cursor: pointer;
        border: 1px solid #eee; margin-bottom: 8px;
        transition: background 0.15s;
      `;
      row.onmouseenter = () => { row.style.background = "#f5f5f5"; };
      row.onmouseleave = () => { row.style.background = "#fff"; };
      row.onclick = () => {
        closePrompt();
        resolve(m.credentialId);
      };

      const icon = document.createElement("div");
      icon.style.cssText = `
        width: 36px; height: 36px; border-radius: 8px;
        background: #e8f5e9; display: flex; align-items: center; justify-content: center;
        font-size: 16px; flex-shrink: 0;
      `;
      icon.textContent = "🔑";

      const info = document.createElement("div");
      info.style.cssText = "flex: 1; min-width: 0;";
      const name = document.createElement("div");
      name.textContent = m.name;
      name.style.cssText = "font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
      const rp = document.createElement("div");
      rp.textContent = m.rpId;
      rp.style.cssText = "font-size: 12px; color: #888;";
      info.appendChild(name);
      info.appendChild(rp);

      row.appendChild(icon);
      row.appendChild(info);
      list.appendChild(row);
    });

    card.appendChild(list);

    backdrop.addEventListener("click", () => {
      closePrompt();
      reject(new Error("用户取消了 Passkey 登录"));
    });

    const root = document.documentElement;
    root.appendChild(backdrop);
    root.appendChild(card);
  });
}
