import { Hono } from "hono";
import { boardHtml } from "./client";

type Bindings = {
  BOARD: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

// トップページ: 新しいボードを作ってリダイレクト
app.get("/", (c) => {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  return c.redirect(`/b/${id}`);
});

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "teamcanvas",
  }),
);

app.get("/b/:id", (c) => c.html(boardHtml));

app.get("/b/:id/ws", (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected websocket", 426);
  }
  const id = c.env.BOARD.idFromName(c.req.param("id"));
  return c.env.BOARD.get(id).fetch(c.req.raw);
});

export default app;
export { BoardRoom } from "./room";
