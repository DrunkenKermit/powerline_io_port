// Serves the built game. powerline-play.html is the whole app — every image,
// font and sound is inlined by build-game.ts — so this only has to hand it out.
const PORT = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") return new Response("ok");

    if (pathname === "/" || pathname === "/play") {
      const page = Bun.file("powerline-play.html");
      if (await page.exists()) {
        return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return new Response("powerline-play.html is missing — run: bun run build", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`powerline on http://0.0.0.0:${server.port}`);
