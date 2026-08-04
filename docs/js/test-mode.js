import { PROVIDER_SLUGS } from "./providers.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const PROVIDER_SET = new Set(PROVIDER_SLUGS);

function readProviders(search) {
  const params = new URLSearchParams(search);
  const providers = [];

  for (const value of params.getAll("testProviders")) {
    for (const candidate of value.split(",")) {
      const provider = candidate.trim().toLowerCase();
      if (PROVIDER_SET.has(provider) && !providers.includes(provider)) {
        providers.push(provider);
      }
    }
  }

  return providers.length ? providers : ["netflix"];
}

export function readTestMode(locationLike) {
  if (!locationLike || typeof locationLike !== "object") return null;

  const { hostname, search } = locationLike;
  if (!LOCAL_HOSTS.has(hostname) || typeof search !== "string") return null;

  let params;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  if (!params.getAll("testMode").includes("1")) return null;

  return { providers: readProviders(search) };
}
