const SCHOOL_LOGO_URL = "https://www.ratsada.ac.th/learn/up/uploads/NOOK/LOGO.png";

export async function onRequest({ request }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { "Allow": "GET, HEAD" } });
  }
  try {
    const upstream = await fetch(SCHOOL_LOGO_URL, {
      headers: { "User-Agent": "RSD-Clean/1.0" },
      cf: { cacheEverything: true, cacheTtl: 604800 }
    });
    if (!upstream.ok) throw new Error("Logo upstream HTTP " + upstream.status);
    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "image/png");
    headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
    headers.set("X-Content-Type-Options", "nosniff");
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    return new Response(await upstream.arrayBuffer(), { status: 200, headers });
  } catch (e) {
    return new Response("School logo unavailable", {
      status: 502,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }
}
