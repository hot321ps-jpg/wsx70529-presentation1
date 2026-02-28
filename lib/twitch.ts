import { kv } from "@vercel/kv";

const TWITCH_API = "https://api.twitch.tv/helix";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";

const TOKEN_KEY = "twitch:app_token";
const TOKEN_EXP_KEY = "twitch:app_token_exp"; // epoch ms

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function getAppAccessToken(): Promise<string> {
  const cached = (await kv.get(TOKEN_KEY)) as string | null;
  const exp = (await kv.get(TOKEN_EXP_KEY)) as number | null;

  if (cached && exp && Date.now() < exp - 60_000) return cached;

  const client_id = mustEnv("TWITCH_CLIENT_ID");
  const client_secret = mustEnv("TWITCH_CLIENT_SECRET");

  const body = new URLSearchParams({
    client_id,
    client_secret,
    grant_type: "client_credentials"
  });

  const res = await fetch(TOKEN_URL, { method: "POST", body });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token fetch failed: ${res.status} ${t}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    token_type: "bearer";
  };

  const expiresAt = Date.now() + json.expires_in * 1000;
  await kv.set(TOKEN_KEY, json.access_token);
  await kv.set(TOKEN_EXP_KEY, expiresAt);

  return json.access_token;
}

async function helixGet<T>(path: string, query: Record<string, string | string[]>) {
  const token = await getAppAccessToken();
  const clientId = mustEnv("TWITCH_CLIENT_ID");

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else qs.set(k, v);
  }

  const url = `${TWITCH_API}${path}?${qs.toString()}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Client-Id": clientId
    },
    cache: "no-store"
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Helix GET ${path} failed: ${res.status} ${t}`);
  }

  return (await res.json()) as T;
}

export async function getUserByLogin(login: string) {
  const r = await helixGet<{ data: any[] }>("/users", { login });
  const u = r.data?.[0];
  if (!u) throw new Error(`User not found: ${login}`);
  return {
    id: u.id as string,
    login: u.login as string,
    displayName: u.display_name as string,
    profileImageUrl: u.profile_image_url as string
  };
}

export async function getStreamByUserId(userId: string) {
  const r = await helixGet<{ data: any[] }>("/streams", { user_id: userId });
  const s = r.data?.[0];
  if (!s) return null;

  return {
    id: s.id as string,
    title: s.title as string,
    gameName: (s.game_name as string) || "",
    viewerCount: s.viewer_count as number,
    startedAt: s.started_at as string
  };
}

export async function getRecentVideosByUserId(userId: string, first = 100) {
  const r = await helixGet<{ data: any[] }>("/videos", {
    user_id: userId,
    first: String(first),
    type: "archive"
  });

  return (r.data ?? []).map((v) => ({
    id: v.id as string,
    title: v.title as string,
    createdAt: v.created_at as string,
    duration: v.duration as string,
    url: v.url as string,
    viewCount: v.view_count as number
  }));
}
