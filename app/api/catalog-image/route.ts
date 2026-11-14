import { isOptcgImage, JP_IMAGE_PREFIX } from "@/lib/onepieceCatalog";

/**
 * Japanese One Piece card pictures, served from our own address. The official site marks its pictures
 * "same-site only", so a browser refuses to show them on another website; fetching them here (the server isn't a browser) works.
 * Only pictures in the official card folder can be asked for.
 */
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("u") ?? "";
  if (!url.startsWith(JP_IMAGE_PREFIX) || !isOptcgImage(url)) return new Response("Not found", { status: 404 });
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "CardUnionShop/1.0" } });
    if (!res.ok) return new Response("Not found", { status: 404 });
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > 5 * 1024 * 1024) return new Response("Not found", { status: 404 });
    const type = res.headers.get("content-type")?.split(";")[0] ?? "image/png";
    if (!type.startsWith("image/")) return new Response("Not found", { status: 404 });
    return new Response(buf, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
