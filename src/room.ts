// 1ボード = 1 Durable Object。WebSocket Hibernation API を使い、
// 接続維持中の課金時間(duration)を抑えて無料枠に収める。
const USER_COLORS = [
  "#e11d48",
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#7c3aed",
  "#0d9488",
];

const MAX_PAGES = 50;
const MAX_STROKE_POINTS = 3000;
const MAX_TEXT_LEN = 4000;

interface Stroke {
  id: string;
  color: string;
  size: number;
  pts: [number, number][];
  t: number;
}

// テキスト・TeX数式アイテム(kind: "text")。ストロークと同じキー空間に保存する。
interface TextItem {
  id: string;
  kind: "text";
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  t: number;
}

type BoardItem = Stroke | TextItem;

interface User {
  id: string;
  name: string;
  color: string;
  // "viewer" は書き込み系メッセージをサーバー側で破棄する(認証フェーズ1のゲスト閲覧向け)。
  // ヘッダが無い従来接続(認証未使用時・認証edit時のゲスト)は常に "editor"。
  role: "editor" | "viewer";
  pageId?: string;
}

// viewer に許可する読み取り系メッセージ。新しいメッセージ種別はデフォルトで拒否される
const VIEWER_ALLOWED_MESSAGE_TYPES = new Set(["load", "cursor"]);

export class BoardRoom implements DurableObject {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      // 管理画面からのボード削除。DO へは binding 経由でしか到達できないため追加認証は不要。
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.close(1000, "board deleted");
        } catch {
          // 切断済みは無視
        }
      }
      await this.state.storage.deleteAll();
      return new Response(null, { status: 204 });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Worker 側の認可結果をヘッダで受け取る。ID・名前が無ければ従来通り「ゲストN」を
    // 採番する(モード0、および認証時の guest-editor / guest-viewer)。
    // role は名前の有無と独立に判定する(閲覧のみゲストは名前なし + viewer)。
    const headerId = request.headers.get("X-User-Id");
    const headerNameRaw = request.headers.get("X-User-Name");
    // Worker 側で URL エンコードして渡される(任意文字列をヘッダに安全に載せるため)
    let headerName: string | null = null;
    if (headerNameRaw) {
      try {
        headerName = decodeURIComponent(headerNameRaw);
      } catch {
        headerName = headerNameRaw;
      }
    }
    const role: User["role"] =
      request.headers.get("X-User-Role") === "viewer" ? "viewer" : "editor";
    const seq = ((await this.state.storage.get<number>("userSeq")) ?? 0) + 1;
    await this.state.storage.put("userSeq", seq);
    const user: User = {
      id: headerId && headerName ? headerId : crypto.randomUUID().slice(0, 8),
      name: headerId && headerName ? headerName : `ゲスト${seq}`,
      color: USER_COLORS[(seq - 1) % USER_COLORS.length],
      role,
    };
    server.serializeAttachment(user);
    this.state.acceptWebSocket(server);

    const pages = await this.getPages();
    const users = this.state
      .getWebSockets()
      .map((ws) => ws.deserializeAttachment() as User);
    server.send(JSON.stringify({ type: "init", user, pages, users }));
    this.broadcast({ type: "join", user }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    let m: any;
    try {
      m = JSON.parse(message);
    } catch {
      return;
    }
    const user = ws.deserializeAttachment() as User;
    if (user.role === "viewer" && !VIEWER_ALLOWED_MESSAGE_TYPES.has(m.type)) {
      // 閲覧のみユーザーからは読み取り系以外のメッセージをサーバー側で破棄する
      return;
    }

    switch (m.type) {
      case "load": {
        const pageId = String(m.pageId);
        // load はページ表示の合図なので、在席ページとして記録・通知する
        user.pageId = pageId;
        ws.serializeAttachment(user);
        this.broadcast({ type: "presence", id: user.id, pageId }, ws);
        const strokes = await this.loadStrokes(pageId);
        ws.send(
          JSON.stringify({ type: "pageData", pageId: m.pageId, strokes }),
        );
        break;
      }
      case "stroke:start":
      case "stroke:points":
      // text:update はドラッグ中のライブ反映用。保存はドロップ時の stroke:end で行う
      case "text:update": {
        this.broadcast({ ...m, from: user.id }, ws);
        break;
      }
      case "stroke:end": {
        const s = m.stroke as any;
        const isStroke =
          s &&
          typeof s.id === "string" &&
          Array.isArray(s.pts) &&
          s.pts.length > 0 &&
          s.pts.length <= MAX_STROKE_POINTS;
        const isText =
          s &&
          typeof s.id === "string" &&
          s.kind === "text" &&
          typeof s.text === "string" &&
          s.text.length > 0 &&
          s.text.length <= MAX_TEXT_LEN &&
          typeof s.x === "number" &&
          typeof s.y === "number";
        if (isStroke || isText) {
          await this.state.storage.put(`s:${m.pageId}:${s.id}`, s);
          this.broadcast({ ...m, from: user.id }, ws);
        }
        break;
      }
      case "erase": {
        const ids: string[] = Array.isArray(m.ids)
          ? m.ids.slice(0, 128).map(String)
          : [];
        if (ids.length > 0) {
          await this.state.storage.delete(
            ids.map((id) => `s:${m.pageId}:${id}`),
          );
          this.broadcast({ type: "erase", pageId: m.pageId, ids }, ws);
        }
        break;
      }
      case "page:add": {
        const pages = await this.getPages();
        if (pages.length < MAX_PAGES) {
          pages.push(crypto.randomUUID().slice(0, 8));
          await this.state.storage.put("pages", pages);
          this.broadcast({ type: "pages", pages });
        }
        break;
      }
      case "cursor": {
        this.broadcast(
          {
            type: "cursor",
            id: user.id,
            name: user.name,
            color: user.color,
            pageId: m.pageId,
            x: m.x,
            y: m.y,
          },
          ws,
        );
        break;
      }
    }
  }

  webSocketClose(ws: WebSocket) {
    this.leave(ws);
  }

  webSocketError(ws: WebSocket) {
    this.leave(ws);
  }

  private leave(ws: WebSocket) {
    const user = ws.deserializeAttachment() as User | null;
    if (user) this.broadcast({ type: "leave", id: user.id }, ws);
  }

  private broadcast(msg: unknown, except?: WebSocket) {
    const s = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(s);
      } catch {
        // 切断済みソケットは無視
      }
    }
  }

  private async getPages(): Promise<string[]> {
    let pages = await this.state.storage.get<string[]>("pages");
    if (!pages || pages.length === 0) {
      pages = [crypto.randomUUID().slice(0, 8)];
      await this.state.storage.put("pages", pages);
    }
    return pages;
  }

  private async loadStrokes(pageId: string): Promise<BoardItem[]> {
    const map = await this.state.storage.list<BoardItem>({
      prefix: `s:${pageId}:`,
    });
    return [...map.values()].sort((a, b) => a.t - b.t);
  }
}
