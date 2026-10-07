const PAGE = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Koçum — e-posta onaylandı</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: #F4F1EA;
      color: #142033;
    }
    main {
      width: min(420px, calc(100% - 40px));
      background: #1B2B44;
      color: #F4F1EA;
      border-radius: 22px;
      padding: 36px 28px;
      text-align: center;
    }
    h1 { margin: 0 0 12px; font-size: 28px; letter-spacing: -0.4px; }
    p { margin: 0; font-size: 16px; line-height: 1.5; color: #E8E3D8; }
    .accent { color: #E07A3D; font-weight: 600; margin-top: 18px; }
  </style>
</head>
<body>
  <main>
    <h1>E-postan onaylandı</h1>
    <p>Koçum’a dön, giriş yap.</p>
    <p class="accent">Koçun hazır.</p>
  </main>
</body>
</html>
`;

export default {
  fetch(req: Request) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }
    return new Response(PAGE, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  },
};
