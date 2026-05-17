import http from "node:http";

export async function startMockIlinkServer(options = {}) {
  const requests = [];
  const qrcodeResponse = options.qrcodeResponse ?? {
    qrcode: "qr_fixture_token",
    qrcode_img_url: "https://example.test/qr.png",
    qrcode_img_content: "https://example.test/qr-content"
  };
  const statusResponses = [...(options.statusResponses ?? [
    { status: "confirmed", bot_token: "bot_token_fixture", ilink_bot_id: "bot_fixture", ilink_user_id: "owner_fixture" }
  ])];
  const getUpdatesResponses = [...(options.getUpdatesResponses ?? [])];
  const sendMessageResponses = [...(options.sendMessageResponses ?? [{ ret: 0 }])];
  const mediaResponses = options.mediaResponses ?? {};

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    requests.push({
      method: req.method,
      pathname: url.pathname,
      searchParams: Object.fromEntries(url.searchParams.entries()),
      headers: req.headers,
      body
    });

    if (req.method === "GET" && url.pathname === "/ilink/bot/get_bot_qrcode") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(qrcodeResponse));
      return;
    }

    if (req.method === "GET" && url.pathname === "/ilink/bot/get_qrcode_status") {
      const response = statusResponses.length > 1 ? statusResponses.shift() : statusResponses[0];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
      return;
    }

    if (req.method === "POST" && url.pathname === "/ilink/bot/getupdates") {
      const response = getUpdatesResponses.length > 1 ? getUpdatesResponses.shift() : getUpdatesResponses[0];
      const status = response?.httpStatus ?? 200;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response?.body ?? response ?? { ret: 0, msgs: [], get_updates_buf: body?.get_updates_buf ?? "" }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/ilink/bot/sendmessage") {
      const response = sendMessageResponses.length > 1 ? sendMessageResponses.shift() : sendMessageResponses[0];
      const status = response?.httpStatus ?? 200;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response?.body ?? response ?? { ret: 0 }));
      return;
    }

    if (req.method === "GET" && Object.hasOwn(mediaResponses, url.pathname)) {
      const response = mediaResponses[url.pathname];
      const status = response?.httpStatus ?? 200;
      const content = response?.body ?? response ?? Buffer.alloc(0);
      res.writeHead(status, { "Content-Type": response?.contentType ?? "application/octet-stream" });
      res.end(content);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ret: 404, errmsg: "not found" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}
