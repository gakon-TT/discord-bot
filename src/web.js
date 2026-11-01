const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { EmbedBuilder } = require("discord.js");
const config = require("./config");
const { query, execute } = require("./db");
const { parseUserAgent, lookupIpInfo, generateRandomString } = require("./utils");

function startWebServer(client) {
  const app = express();

  // Rate limiting đơn giản trong bộ nhớ để bảo vệ Web OAuth2 chống spam / DDoS khi đông người truy cập
  const rateLimitMap = new Map();
  const RATE_LIMIT_WINDOW = 60 * 1000; // 1 phút
  const MAX_REQUESTS_PER_WINDOW = 35;  // 35 requests / phút / IP

  function rateLimiter(req, res, next) {
    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
                     req.headers["cf-connecting-ip"] ||
                     req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = rateLimitMap.get(clientIp) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };

    if (now > entry.resetTime) {
      entry.count = 1;
      entry.resetTime = now + RATE_LIMIT_WINDOW;
    } else {
      entry.count++;
    }
    rateLimitMap.set(clientIp, entry);

    if (entry.count > MAX_REQUESTS_PER_WINDOW) {
      return res.status(429).send("Bạn đang gửi quá nhiều yêu cầu. Vui lòng đợi 1 phút và thử lại.");
    }
    next();
  }

  // Dọn dẹp map rate limit định kỳ
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap.entries()) {
      if (now > entry.resetTime) rateLimitMap.delete(ip);
    }
  }, 5 * 60 * 1000);

  app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    next();
  });

  // Host trang web cá nhân từ thư mục gakon
  app.use(express.static(path.join(__dirname, "../gakon")));

  app.get("/verify", rateLimiter, async (req, res) => {
    const state = crypto.randomBytes(32).toString("hex");
    await execute(
      "INSERT INTO oauth_states (state, expires_at) VALUES (?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))",
      [state]
    );

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: `${config.baseUrl}${config.oauthCallbackPath}`,
      response_type: "code",
      scope: config.oauthScopes,
      state
    });

    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
  });

  app.get(config.oauthCallbackPath, rateLimiter, async (req, res) => {
    try {
      const { code, state } = req.query;
      if (!code) return res.status(400).send("Thiếu code xác thực từ Discord.");

      if (state) {
        await execute("DELETE FROM oauth_states WHERE state = ?", [state]).catch(() => {});
      }

      console.log(`[OAuth] Nhận code từ Discord, đang lấy token...`);

      const tokenBody = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${config.baseUrl}${config.oauthCallbackPath}`
      });

      const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody
      });

      if (!tokenResponse.ok) {
        const errText = await tokenResponse.text();
        throw new Error(`OAuth token error (${tokenResponse.status}): ${errText}`);
      }
      const token = await tokenResponse.json();

      const userResponse = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${token.access_token}` }
      });

      if (!userResponse.ok) throw new Error(`Discord user error: ${userResponse.status}`);
      const user = await userResponse.json();

      console.log(`[OAuth] Xác thực thành công tài khoản Discord: ${user.username} (${user.id})`);

      const rawIp = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
                    req.headers["cf-connecting-ip"] ||
                    req.headers["x-real-ip"] ||
                    req.socket.remoteAddress || "127.0.0.1";
      const ipInfo = await lookupIpInfo(rawIp);
      const device = parseUserAgent(req.headers["user-agent"]);

      const ua = req.headers["user-agent"] || "";
      const lang = req.headers["accept-language"] || "";
      const fingerprint = crypto.createHash("sha256").update(`${ua}_${lang}_${ipInfo.ip}`).digest("hex").slice(0, 11);

      let cookie = null;
      const cookieMatch = (req.headers.cookie || "").match(/mcr_sess=([a-z0-9]+)/i);
      if (cookieMatch) {
        cookie = cookieMatch[1];
      } else {
        cookie = crypto.randomBytes(11).toString("hex").slice(0, 21);
        res.setHeader("Set-Cookie", `mcr_sess=${cookie}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
      }

      const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;

      let connections = [];
      try {
        const connResponse = await fetch("https://discord.com/api/users/@me/connections", {
          headers: { Authorization: `Bearer ${token.access_token}` }
        });
        if (connResponse.ok) {
          connections = await connResponse.json();
          console.log(`[OAuth] Lấy thành công ${connections.length} liên kết mạng xã hội cho user ${user.username}`);
        }
      } catch (err) {
        console.warn("[OAuth] Không thể lấy connections:", err.message);
      }

      await execute(
        `INSERT INTO users (discord_id, discord_username, discord_email, ip, geo_location, isp, device, fingerprint, cookie, access_token, refresh_token, token_expires_at, oauth_scope, connections, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           discord_username = VALUES(discord_username),
           discord_email = VALUES(discord_email),
           ip = VALUES(ip),
           geo_location = VALUES(geo_location),
           isp = VALUES(isp),
           device = VALUES(device),
           fingerprint = VALUES(fingerprint),
           cookie = VALUES(cookie),
           access_token = VALUES(access_token),
           refresh_token = VALUES(refresh_token),
           token_expires_at = VALUES(token_expires_at),
           oauth_scope = VALUES(oauth_scope),
           connections = VALUES(connections),
           verified_at = NOW()`,
        [
          user.id,
          user.username,
          user.email || null,
          ipInfo.ip,
          ipInfo.location,
          ipInfo.isp,
          device,
          fingerprint,
          cookie,
          token.access_token || null,
          token.refresh_token || null,
          expiresAt,
          token.scope || null,
          JSON.stringify(connections)
        ]
      );

      // Cập nhật ngay tin nhắn Verify trên Discord của người dùng thành trạng thái Đã xác thực thành công
      if (client && client.pendingVerifyInteractions && client.pendingVerifyInteractions.has(user.id)) {
        const item = client.pendingVerifyInteractions.get(user.id);
        client.pendingVerifyInteractions.delete(user.id);
        if (item?.timeoutId) clearTimeout(item.timeoutId);
        const pendingInteraction = item?.interaction || item;
        try {
          await pendingInteraction.editReply({
            content: `✅ **Xác thực thành công!** Tài khoản <@${user.id}> đã được liên kết hệ thống.\nBây giờ bạn đã có thể bấm vào nút **Đăng Ký** trên bảng để nộp đơn Whitelist.`,
            embeds: [],
            components: []
          });
        } catch (e) {
          console.warn("[OAuth] Không thể cập nhật interaction verify trên Discord:", e.message);
        }
      }

      // Tự động cấp role verified nếu server có cấu hình VERIFIED_ROLE_ID
      if (config.verifiedRoleId && client) {
        try {
          const guild = client.guilds.cache.get(config.guildId) || await client.guilds.fetch(config.guildId).catch(() => null);
          if (guild) {
            const member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null);
            if (member && !member.roles.cache.has(config.verifiedRoleId)) {
              await member.roles.add(config.verifiedRoleId).catch(console.error);
              console.log(`[OAuth] Đã cấp role verified (${config.verifiedRoleId}) cho ${user.username}`);
            }
          }
        } catch (err) {
          console.warn("[OAuth] Lỗi khi cấp verified role:", err.message);
        }
      }

      const discordUrl = config.whitelistChannelId
        ? `discord://-/channels/${config.guildId}/${config.whitelistChannelId}`
        : `discord://-/channels/${config.guildId}`;

      res.send(`
        <!doctype html>
        <html lang="vi">
        <head>
          <meta charset="utf-8">
          <title>Xác thực thành công - ${config.serverName}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: #111214;
              color: #f2f3f5;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              padding: 20px;
            }
            .card {
              background: #2b2d31;
              border-radius: 14px;
              padding: 32px 28px;
              text-align: center;
              max-width: 420px;
              width: 100%;
              border: 1px solid #3f4147;
              box-shadow: 0 12px 30px rgba(0,0,0,0.4);
            }
            .icon {
              font-size: 44px;
              margin-bottom: 12px;
            }
            h2 {
              color: #57f287;
              font-size: 20px;
              margin-bottom: 8px;
              font-weight: 700;
            }
            .desc {
              font-size: 14px;
              color: #dbdee1;
              margin-bottom: 18px;
            }
            .desc b {
              color: #fff;
            }
            .btn {
              display: inline-block;
              width: 100%;
              padding: 11px 18px;
              background: #5865f2;
              color: #fff;
              text-decoration: none;
              border-radius: 8px;
              font-size: 14px;
              font-weight: 600;
              transition: background 0.2s;
              margin-bottom: 12px;
            }
            .btn:hover {
              background: #4752c4;
            }
            .note {
              font-size: 12px;
              color: #949ba4;
              line-height: 1.4;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">✅</div>
            <h2>Xác Thực Thành Công!</h2>
            <div class="desc">Tài khoản <b>${user.username}</b> đã được liên kết với Discord.</div>
            <a class="btn" href="${discordUrl}" onclick="tryCloseTab(event)">Quay Lại Discord</a>
            <div class="note">Đã tự động chuyển về Discord! Bạn có thể nhấn <b>Ctrl + W</b> hoặc bấm <b>✕</b> để đóng tab này.</div>
          </div>
          <script>
            function tryCloseTab(e) {
              if (e) e.preventDefault();
              window.location.href = "${discordUrl}";
              setTimeout(function() {
                try {
                  window.open('', '_self', '');
                  window.close();
                } catch (_) {}
              }, 200);
            }

            window.addEventListener("DOMContentLoaded", function() {
              // 1. Chờ DOM vẽ xong rồi nhảy về ứng dụng Discord
              setTimeout(function() {
                window.location.href = "${discordUrl}";
              }, 250);

              // 2. Thử tự động đóng tab
              setTimeout(function() {
                try {
                  window.open('', '_self', '');
                  window.close();
                } catch (_) {}
              }, 500);
            });
          </script>
        </body>
        </html>
      `);
    } catch (error) {
      console.error("[OAuth Lỗi]", error.message);
      res.status(500).send(`
        <!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Lỗi xác thực</title>
        <style>body{font-family:sans-serif;background:#111214;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}
        .card{background:#2b2d31;padding:30px;border-radius:12px;max-width:400px;border:1px solid #da373c;}</style></head>
        <body><div class="card"><h2 style="color:#da373c">❌ Xác thực thất bại</h2><p style="margin:12px 0;color:#dbdee1">${error.message}</p><p><a href="/verify" style="color:#5865f2">Thử lại</a></p></div></body></html>
      `);
    }
  });

  app.get("/health", (req, res) => res.json({ ok: true, service: "whitelist-bot" }));

  app.listen(config.port, () => {
    console.log(`Web server: ${config.baseUrl}`);
    console.log(`Listening on port ${config.port}`);
  });
}

module.exports = { startWebServer };
