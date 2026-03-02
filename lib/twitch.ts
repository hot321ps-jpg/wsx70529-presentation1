// lib/twitch.ts
import { kv } from "@vercel/kv";

const TWITCH_API = "https://api.twitch.tv/helix";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TOKEN_KEY = "twitch:app_token";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function getAppAccessToken(): Promise<string> {
  const cached = await kv.get<string>(TOKEN_KEY);
  if (cached) return cached;

  const client_id = mustEnv("TWITCH_CLIENT_ID");
  const client_secret = mustEnv("TWITCH_CLIENT_SECRET");

  const body = new URLSearchParams({
    client_id,
    client_secret,
    grant_type: "client_credentials"
  });

  const res = await fetch(TOKEN_URL, { method: "POST", body });
  if (!res.ok) throw new Error("Token fetch failed");

  const json = await res.json();
  // 提前 5 分鐘過期以策安全
  await kv.set(TOKEN_KEY, json.access_token, { ex: json.expires_in - 300 });
  return json.access_token;
}

async function helixGet<T>(path: string, query: Record<string, string | string[]>) {
  const token = await getAppAccessToken();
  const clientId = mustEnv("TWITCH_CLIENT_ID");

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else qs.set(k, String(v));
  }

  const url = `${TWITCH_API}${path}?${qs.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId },
    cache: "no-store"
  });

  if (!res.ok) throw new Error(`Helix GET failed: ${res.status}`);
  return (await res.json()) as T;
}

export const Twitch = {
  getUser: async (login: string) => {
    const r = await helixGet<{ data: any[] }>("/users", { login });
    if (!r.data?.[0]) throw new Error(`User not found: ${login}`);
    return r.data[0];
  },
  getStream: async (userId: string) => {
    const r = await helixGet<{ data: any[] }>("/streams", { user_id: userId });
    return r.data?.[0] || null;
  },
  getVideos: async (userId: string, first = 20) => {
    const r = await helixGet<{ data: any[] }>("/videos", { user_id: userId, first: String(first), type: "archive" });
    return r.data || [];
  }
};
