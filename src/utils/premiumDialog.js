const DIALOG_ROOT_ID = "master-caps-premium-dialog-root";
const DIALOG_STYLE_ID = "master-caps-premium-dialog-styles";

const queue = [];
let activeRequest = null;

function ensureStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(DIALOG_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = DIALOG_STYLE_ID;
  style.textContent = `
    #${DIALOG_ROOT_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(15, 15, 15, 0.56);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      animation: mc-dialog-overlay-in 160ms ease-out;
    }

    #${DIALOG_ROOT_ID}[data-closing="true"] {
      animation: mc-dialog-overlay-out 140ms ease-in forwards;
    }

    #${DIALOG_ROOT_ID} .mc-dialog-card {
      width: min(100%, 470px);
      overflow: hidden;
      border-radius: 28px;
      background: #ffffff;
      color: #111111;
      border: 1px solid rgba(0, 0, 0, 0.08);
      box-shadow: 0 32px 90px rgba(0, 0, 0, 0.24);
      transform-origin: center;
      animation: mc-dialog-card-in 180ms cubic-bezier(.2,.8,.2,1);
    }

    #${DIALOG_ROOT_ID}[data-closing="true"] .mc-dialog-card {
      animation: mc-dialog-card-out 140ms ease-in forwards;
    }

    #${DIALOG_ROOT_ID} .mc-dialog-accent {
      height: 4px;
      background: #e31b23;
    }

    #${DIALOG_ROOT_ID} .mc-dialog-body {
      padding: 28px 28px 22px;
    }

    #${DIALOG_ROOT_ID} .mc-dialog-icon {
      width: 52px;
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 18px;
      margin-bottom: 18px;
      background: rgba(227, 27, 35, 0.08);
      color: #e31b23;
    }

    #${DIALOG_ROOT_ID} .mc-dialog-icon[data-tone="success"] {
      background: rgba(5, 150, 105, 0.09);
      color: #059669;
    }

    #${DIALOG_ROOT_ID} .mc-dialog-icon[data-tone="info"] {
      background: rgba(17, 17, 17, 0.06);
      color: #111111;
    }

    #${DIALOG_ROOT_ID} .mc-dialog-eyebrow {
      margin: 0 0 8px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .16em;
      text-transform: uppercase;
      color: #e31b23;
    }

    #${DIALOG_ROOT_ID} .mc-dialog-title {
      margin: 0;
      font-size: 23px;
      line-height: 1.12;
      font-weight: 650;
      letter-spacing: -0.035em;
    }

    #${DIALOG_ROOT_ID} .mc-dialog-message {
      margin: 12px 0 0;
      font-size: 13px;
      line-height: 1.65;
      color: rgba(17, 17, 17, 0.58);
      white-space: pre-line;
    }

    #${DIALOG_ROOT_ID} .mc-dialog-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      padding: 0 28px 28px;
    }

    #${DIALOG_ROOT_ID} .mc-dialog-actions[data-single="true"] {
      grid-template-columns: 1fr;
    }

    #${DIALOG_ROOT_ID} .mc-dialog-button {
      min-height: 50px;
      border-radius: 16px;
      border: 1px solid rgba(0, 0, 0, 0.10);
      background: #ffffff;
      color: #111111;
      padding: 12px 16px;
      font: inherit;
      font-size: 12px;
      font-weight: 650;
      cursor: pointer;
      transition: transform 150ms ease, background 150ms ease, border-color 150ms ease, color 150ms ease;
    }

    #${DIALOG_ROOT_ID} .mc-dialog-button:hover {
      transform: translateY(-1px);
      border-color: rgba(0, 0, 0, 0.18);
      background: rgba(0, 0, 0, 0.025);
    }

    #${DIALOG_ROOT_ID} .mc-dialog-button:focus-visible {
      outline: 3px solid rgba(227, 27, 35, 0.18);
      outline-offset: 2px;
    }

    #${DIALOG_ROOT_ID} .mc-dialog-button--primary {
      border-color: #e31b23;
      background: #e31b23;
      color: #ffffff;
      box-shadow: 0 12px 28px rgba(227, 27, 35, 0.22);
    }

    #${DIALOG_ROOT_ID} .mc-dialog-button--primary:hover {
      border-color: #c9151c;
      background: #c9151c;
    }

    #${DIALOG_ROOT_ID} .mc-dialog-button--dark {
      border-color: #111111;
      background: #111111;
      color: #ffffff;
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.15);
    }

    #${DIALOG_ROOT_ID} .mc-dialog-button--dark:hover {
      background: #000000;
    }

    @keyframes mc-dialog-overlay-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes mc-dialog-overlay-out {
      from { opacity: 1; }
      to { opacity: 0; }
    }

    @keyframes mc-dialog-card-in {
      from { opacity: 0; transform: translateY(12px) scale(.975); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes mc-dialog-card-out {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to { opacity: 0; transform: translateY(8px) scale(.985); }
    }

    @media (max-width: 560px) {
      #${DIALOG_ROOT_ID} {
        align-items: flex-end;
        padding: 12px;
      }

      #${DIALOG_ROOT_ID} .mc-dialog-card {
        border-radius: 24px;
      }

      #${DIALOG_ROOT_ID} .mc-dialog-body {
        padding: 24px 20px 18px;
      }

      #${DIALOG_ROOT_ID} .mc-dialog-actions {
        padding: 0 20px 20px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #${DIALOG_ROOT_ID},
      #${DIALOG_ROOT_ID} .mc-dialog-card {
        animation: none !important;
      }
    }
  `;

  document.head.appendChild(style);
}

function getIconSvg(tone) {
  if (tone === "success") {
    return `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  }

  if (tone === "info") {
    return `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
        <path d="M12 10v6M12 7.2h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `;
  }

  return `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 8v4.5M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M10.25 4.95 3.1 17.05A2 2 0 0 0 4.82 20h14.36a2 2 0 0 0 1.72-2.95L13.75 4.95a2 2 0 0 0-3.5 0Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>
  `;
}

function sanitizeText(value) {
  return String(value ?? "");
}

function closeCurrent(result) {
  if (!activeRequest || typeof document === "undefined") return;

  const request = activeRequest;
  const root = document.getElementById(DIALOG_ROOT_ID);
  activeRequest = null;

  const finish = () => {
    root?.remove();
    document.body.style.overflow = request.previousOverflow;
    request.resolve(result);
    window.setTimeout(processQueue, 0);
  };

  if (!root) {
    finish();
    return;
  }

  root.dataset.closing = "true";
  window.setTimeout(finish, 145);
}

function processQueue() {
  if (activeRequest || queue.length === 0 || typeof document === "undefined") {
    return;
  }

  ensureStyles();

  const request = queue.shift();
  activeRequest = request;

  const {
    mode,
    title,
    message,
    eyebrow,
    confirmText,
    cancelText,
    tone,
    primaryStyle,
  } = request.options;

  const root = document.createElement("div");
  root.id = DIALOG_ROOT_ID;
  root.setAttribute("role", "presentation");

  const card = document.createElement("section");
  card.className = "mc-dialog-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", `${DIALOG_ROOT_ID}-title`);
  card.setAttribute("aria-describedby", `${DIALOG_ROOT_ID}-message`);

  const accent = document.createElement("div");
  accent.className = "mc-dialog-accent";

  const body = document.createElement("div");
  body.className = "mc-dialog-body";

  const icon = document.createElement("div");
  icon.className = "mc-dialog-icon";
  icon.dataset.tone = tone;
  icon.innerHTML = getIconSvg(tone);

  const eyebrowElement = document.createElement("p");
  eyebrowElement.className = "mc-dialog-eyebrow";
  eyebrowElement.textContent = sanitizeText(eyebrow);

  const titleElement = document.createElement("h2");
  titleElement.id = `${DIALOG_ROOT_ID}-title`;
  titleElement.className = "mc-dialog-title";
  titleElement.textContent = sanitizeText(title);

  const messageElement = document.createElement("p");
  messageElement.id = `${DIALOG_ROOT_ID}-message`;
  messageElement.className = "mc-dialog-message";
  messageElement.textContent = sanitizeText(message);

  body.append(icon, eyebrowElement, titleElement, messageElement);

  const actions = document.createElement("div");
  actions.className = "mc-dialog-actions";
  actions.dataset.single = String(mode === "alert");

  if (mode === "confirm") {
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "mc-dialog-button";
    cancelButton.textContent = sanitizeText(cancelText || "Cancelar");
    cancelButton.addEventListener("click", () => closeCurrent(false));
    actions.appendChild(cancelButton);
  }

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = `mc-dialog-button ${
    primaryStyle === "dark"
      ? "mc-dialog-button--dark"
      : "mc-dialog-button--primary"
  }`;
  confirmButton.textContent = sanitizeText(confirmText || "Aceptar");
  confirmButton.addEventListener("click", () =>
    closeCurrent(mode === "confirm" ? true : undefined)
  );
  actions.appendChild(confirmButton);

  card.append(accent, body, actions);
  root.appendChild(card);

  request.previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  document.body.appendChild(root);

  const keydownHandler = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCurrent(mode === "confirm" ? false : undefined);
      return;
    }

    if (event.key === "Enter") {
      const target = event.target;
      if (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      event.preventDefault();
      closeCurrent(mode === "confirm" ? true : undefined);
    }
  };

  const cleanupKeydown = () => {
    window.removeEventListener("keydown", keydownHandler, true);
  };

  const originalResolve = request.resolve;
  request.resolve = (value) => {
    cleanupKeydown();
    originalResolve(value);
  };

  window.addEventListener("keydown", keydownHandler, true);

  if (mode === "confirm") {
    root.addEventListener("mousedown", (event) => {
      if (event.target === root) {
        closeCurrent(false);
      }
    });
  }

  window.requestAnimationFrame(() => confirmButton.focus());
}

function enqueue(options) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(options.mode === "confirm" ? false : undefined);
  }

  return new Promise((resolve) => {
    queue.push({
      options: {
        mode: options.mode || "alert",
        title: options.title ||
          (options.mode === "confirm" ? "Confirmar acción" : "Información"),
        message: options.message || "",
        eyebrow: options.eyebrow || "Master Caps",
        confirmText:
          options.confirmText ||
          (options.mode === "confirm" ? "Confirmar" : "Entendido"),
        cancelText: options.cancelText || "Cancelar",
        tone: options.tone || "warning",
        primaryStyle: options.primaryStyle || "red",
      },
      resolve,
      previousOverflow: "",
    });

    processQueue();
  });
}

export function showPremiumAlert(message, options = {}) {
  return enqueue({
    ...options,
    mode: "alert",
    message,
  });
}

export function showPremiumConfirm({
  title = "Confirmar acción",
  message = "",
  eyebrow = "Master Caps",
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  tone = "warning",
  primaryStyle = "red",
} = {}) {
  return enqueue({
    mode: "confirm",
    title,
    message,
    eyebrow,
    confirmText,
    cancelText,
    tone,
    primaryStyle,
  });
}
