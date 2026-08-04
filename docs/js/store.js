export const KEYS = {
  llm: "ottbyok.llm",
  youmd: "ottbyok.youmd",
  history: "ottbyok.history",
  chats: "ottbyok.chats"
};

export const DEFAULT_LLM = {
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "",
  model: "anthropic/claude-sonnet-4.6"
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
      return { ...DEFAULT_LLM, ...parsed };
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
        model: source.model
      }));
    } catch (err) {
      return false;
    }
  }

  function getYouMd() {
    try {
      const raw = read(KEYS.youmd);
      if (raw === null || raw === undefined) return YOUMD_TEMPLATE;
      return raw;
    } catch (err) {
      return YOUMD_TEMPLATE;
    }
  }

  function setYouMd(str) {
    return write(KEYS.youmd, String(str));
  }

  function getHistory() {
    try {
      const raw = read(KEYS.history);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function setHistory(obj) {
    if (obj === null || obj === undefined) return remove(KEYS.history);
    try {
      return write(KEYS.history, JSON.stringify(obj));
    } catch (err) {
      return false;
    }
  }

  function getChats() {
    try {
      const raw = read(KEYS.chats);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch (err) {
      return [];
    }
  }

  function setChats(arr) {
    try {
      return write(KEYS.chats, JSON.stringify(arr));
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
    getYouMd,
    setYouMd,
    getHistory,
    setHistory,
    getChats,
    setChats,
    clearAll,
    hasKey
  };
}
