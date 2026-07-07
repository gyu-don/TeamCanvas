import { Hono } from "hono";

type Bindings = Record<string, never>;

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) => c.text("Hello TeamCanvas!"));

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "teamcanvas",
  }),
);

export default app;
