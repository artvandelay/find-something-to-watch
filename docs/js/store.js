export const KEYS = {
  llm: "ottbyok.llm",
  youmd: "ottbyok.youmd",
  history: "ottbyok.history"
};

// The browser-memory adapter migrates these two values into IndexedDB after a
// verified write. Keep the names stable so existing visitors retain their data.
export const LEGACY_CONTEXT_KEYS = Object.freeze({
  youmd: KEYS.youmd,
  history: KEYS.history
});

export const DEFAULT_LLM = {
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "",
  model: "anthropic/claude-sonnet-4.6",
  webSearch: false
};

export const YOUMD_TEMPLATE = `# You.md

## What I love
- 

## What I avoid
- 

## Languages I watch in
- English
- Hindi

## Typical session
- Weeknights, about 45 minutes
- Weekend, up to 2.5 hours

## Notes for the recommender
- 
`;

export function createStore(storage) {
  function read(key) {
    try {
      return storage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function write(key, value) {
    try {
      storage.setItem(key, value);
      return true;
    } catch (err) {
      return false;
    }
  }

  function remove(key) {
    try {
      storage.removeItem(key);
      return true;
    } catch (err) {
      return false;
    }
  }

  function getLlm() {
    try {
      const raw = read(KEYS.llm);
      if (!raw) return { ...DEFAULT_LLM };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ...DEFAULT_LLM };
      }
      return {
        ...DEFAULT_LLM,
        ...parsed,
        webSearch: parsed.webSearch === true
      };
    } catch (err) {
      return { ...DEFAULT_LLM };
    }
  }

  function setLlm(obj) {
    const source = obj && typeof obj === "object" ? obj : {};
    try {
      return write(KEYS.llm, JSON.stringify({
        baseUrl: source.baseUrl,
        apiKey: source.apiKey,
        model: source.model,
        webSearch: source.webSearch === true
      }));
    } catch (err) {
      return false;
    }
  }

  function clearAll() {
    let ok = true;
    for (const key of Object.values(KEYS)) {
      if (!remove(key)) ok = false;
    }
    return ok;
  }

  function hasKey() {
    const apiKey = getLlm().apiKey;
    return typeof apiKey === "string" && apiKey.trim().length > 0;
  }

  return {
    getLlm,
    setLlm,
    clearAll,
    hasKey
  };
}
