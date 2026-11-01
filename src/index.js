const fs = require("fs");
const path = require("path");
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
  TextInputStyle, PermissionFlagsBits, AttachmentBuilder,
  ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags
} = require("discord.js");

const config = require("./config");
const { query, execute } = require("./db");
const {
  randomCode,
  randomGuaranteeCode,
  parseUserAgent,
  lookupIpInfo,
  formatVietnameseDate,
  formatShortDate,
  getTimeAgo,
  generateRandomString
} = require("./utils");
const { startWebServer } = require("./web");
const { buildDepartmentPanel, handleDepartmentInteraction } = require("./departmentRole");
const { buildTicketPanel, handleTicketInteraction, startTicketCleanupScheduler } = require("./ticketManager");
const { handleGeneralCommand } = require("./generalCommands");
const { generateWelcomeCard } = require("./welcomeCard");
const { initServerLogger } = require("./serverLogger");
const { syncMemberNickname, syncAllGuildNicknames } = require("./autoNickname");
const EMOJIS = require("./emojis");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildInvites
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

client.on("error", (error) => {
  console.error("Discord client error:", error?.message || error);
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    const oldRoles = oldMember.roles?.cache;
    const newRoles = newMember.roles?.cache;
    if (oldRoles && newRoles && (oldRoles.size !== newRoles.size || !oldRoles.equals(newRoles))) {
      await syncMemberNickname(newMember);
    }
  } catch (err) {
    console.warn("[AutoNickname Error]", err.message);
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason?.message || reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error?.message || error);
});

function panelPayload() {
  const e = new EmbedBuilder()
    .setColor(0x00A8FF)
    .setTitle(`${EMOJIS.clipboard} Hướng dẫn Đăng ký Whitelist`)
    .setDescription(
      `Chào mừng bạn đến với thành phố! Vui lòng thực hiện theo các bước dưới đây để hoàn tất thủ tục đăng ký Whitelist.\n\n` +
      `${EMOJIS.num1} **Xác thực tài khoản (Verify)**\n` +
      `Nhấn nút **Verify** bên dưới để liên kết tài khoản Discord của bạn với hệ thống.\n\n` +
      `${EMOJIS.num2} **Gửi đơn Đăng ký Whitelist**\n` +
      `Nhấn nút **Đăng Ký** bên dưới để đăng ký và gửi đơn xét duyệt Whitelist.\n\n` +
      `${EMOJIS.num3} **Nhập mã bảo lãnh (Nếu có)**\n` +
      `Nếu bạn nhận được mã bảo lãnh từ người chơi khác, bấm nút **Nhập mã bảo lãnh** để được ưu tiên xét duyệt.\n\n` +
      `${EMOJIS.rules} **Quy định quan trọng**\n` +
      `• Cung cấp thông tin chính xác và trung thực.\n` +
      `• Không spam nhiều đơn đăng ký.\n` +
      `• Các trường hợp gian lận hoặc sử dụng thông tin giả sẽ bị **từ chối vĩnh viễn**.\n\n` +
      `> ${EMOJIS.heart} Cảm ơn bạn đã lựa chọn tham gia thành phố. Chúc bạn có những trải nghiệm tuyệt vời!`
    );

  const files = [];

  const localBannerGif = path.join(__dirname, "../assets/SWAG_banner_discord_Full.gif");
  const localBannerPng = path.join(__dirname, "../assets/banner.png");
  const localBannerJpg = path.join(__dirname, "../assets/banner.jpg");

  if (fs.existsSync(localBannerGif)) {
    files.push(new AttachmentBuilder(localBannerGif, { name: "SWAG_banner_discord_Full.gif" }));
    e.setImage("attachment://SWAG_banner_discord_Full.gif");
  } else if (config.panelImageUrl && config.panelImageUrl.trim()) {
    e.setImage(config.panelImageUrl.trim());
  } else if (fs.existsSync(localBannerPng)) {
    files.push(new AttachmentBuilder(localBannerPng, { name: "banner.png" }));
    e.setImage("attachment://banner.png");
  } else if (fs.existsSync(localBannerJpg)) {
    files.push(new AttachmentBuilder(localBannerJpg, { name: "banner.jpg" }));
    e.setImage("attachment://banner.jpg");
  }

  return { embed: e, files };
}

function getOAuthUrl() {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${config.baseUrl}${config.oauthCallbackPath}`,
    response_type: "code",
    scope: config.oauthScopes
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function panelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("verify")
        .setEmoji(EMOJIS.discord)
        .setLabel("Verify")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("register")
        .setEmoji(EMOJIS.clipboard)
        .setLabel("Đăng Ký")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("guarantee")
        .setEmoji(EMOJIS.key)
        .setLabel("Nhập mã bảo lãnh")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function verifyPanelPayload(user = null) {
  const e = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`${EMOJIS.discord} Xác Thực Tài Khoản - ${config.serverName}`)
    .setDescription(
      `Chào mừng bạn đến với **${config.serverName}**!\n\n` +
      `Vui lòng nhấn nút **Verify** bên dưới để tiến hành xác thực tài khoản Discord của bạn.\n\n` +
      `• **Liên kết:** Xác nhận tài khoản Discord an toàn qua OAuth2.\n` +
      `• **Quyền lợi:** Mở khóa quyền tham gia server và nộp đơn xét duyệt Whitelist.\n\n` +
      `> Bấm nút **Xác Thực** bên dưới để bắt đầu ngay!`
    )
    .setTimestamp();

  if (user) {
    e.setFooter({
      text: `Xác thực bởi: ${user.username} • User ID: ${user.id}`,
      iconURL: user.displayAvatarURL({ dynamic: true })
    });
  } else {
    e.setFooter({
      text: `${config.serverName} • Hệ thống xác thực`,
      iconURL: client.user?.displayAvatarURL({ dynamic: true }) || undefined
    });
  }

  return { embed: e };
}

function verifyPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("verify")
        .setEmoji(EMOJIS.verify)
        .setLabel("Xác Thực (Verify)")
        .setStyle(ButtonStyle.Success)
    )
  ];
}

function guaranteePanelPayload() {
  const e = new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle(`${EMOJIS.key} Bảo lãnh Whitelist`)
    .setDescription(
      `Đọc hướng dẫn cơ bản bên dưới để có thể được xét duyệt sớm nhất nhé !!!\n\n` +
      `${EMOJIS.key} **Xin mã bảo lãnh**\n` +
      `│ Bấm nút **Xin mã bảo lãnh** và nhập số lượng bạn bè cần bảo lãnh để gửi duyệt lên Admin.\n\n` +
      `${EMOJIS.chart} **Xem mã đã tạo**\n` +
      `│ Bấm nút **Xem mã đã tạo** để tra cứu thông tin mã code của bạn (slot còn lại, người đã dùng).\n\n` +
      `${EMOJIS.warning} **Lưu ý**\n` +
      `• Mỗi người chỉ có thể giữ tối đa 1 mã bảo lãnh hoạt động (chưa dùng hết slot) tại một thời điểm.\n` +
      `• Chỉ nên chọn số lượng slot dựa trên mong muốn của bản thân và bạn sẽ phải chịu mọi trách nhiệm nếu người được bảo lãnh làm sai luật ảnh hưởng đến server.`
    );

  const files = [];
  const localGuaranteeGif = path.join(__dirname, "../assets/SWAG_banner_discord_Full.gif");
  const localGuaranteePng = path.join(__dirname, "../assets/guarantee_banner.png");
  const localBannerPng = path.join(__dirname, "../assets/banner.png");
  const localBannerJpg = path.join(__dirname, "../assets/banner.jpg");

  let bannerFile = null;
  let bannerName = null;

  if (fs.existsSync(localGuaranteeGif)) {
    bannerFile = localGuaranteeGif;
    bannerName = "SWAG_banner_discord_Full.gif";
  } else if (config.panelImageUrl && config.panelImageUrl.trim()) {
    e.setImage(config.panelImageUrl.trim());
  } else if (fs.existsSync(localGuaranteePng)) {
    bannerFile = localGuaranteePng;
    bannerName = "guarantee_banner.png";
  } else if (fs.existsSync(localBannerPng)) {
    bannerFile = localBannerPng;
    bannerName = "banner.png";
  } else if (fs.existsSync(localBannerJpg)) {
    bannerFile = localBannerJpg;
    bannerName = "banner.jpg";
  }

  if (bannerFile) {
    files.push(new AttachmentBuilder(bannerFile, { name: bannerName }));
    e.setImage(`attachment://${bannerName}`);
  }

  return { embed: e, files };
}

function guaranteePanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("request_guarantee")
        .setEmoji(EMOJIS.key)
        .setLabel("Xin mã bảo lãnh")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("view_guarantee")
        .setEmoji(EMOJIS.chart)
        .setLabel("Xem mã đã tạo")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function cleanupPreviousPanels(channel, titleKeywords = []) {
  try {
    const fetchedMessages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!fetchedMessages) return;

    for (const [, msg] of fetchedMessages) {
      if (msg.author?.id === client.user.id && msg.embeds && msg.embeds.length > 0) {
        const match = msg.embeds.some(em => {
          const title = em.title || "";
          return titleKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
        });
        if (match) {
          await msg.delete().catch(() => { });
        }
      }
    }
  } catch (e) {
    console.error("Lỗi khi dọn dẹp panel cũ:", e.message);
  }
}

async function cleanupUserVerifyPanel(channel, userId) {
  try {
    const fetchedMessages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!fetchedMessages) return;

    for (const [, msg] of fetchedMessages) {
      if (msg.author?.id === client.user.id && msg.embeds && msg.embeds.length > 0) {
        const em = msg.embeds[0];
        const isVerifyPanel = (em.title || "").includes("Xác Thực") || (em.title || "").includes("XÁC THỰC");
        const hasUserId = em.footer?.text && em.footer.text.includes(userId);
        if (isVerifyPanel && hasUserId) {
          await msg.delete().catch(() => {});
        }
      }
    }
  } catch (e) {
    console.error("Lỗi khi dọn dẹp panel verify cũ của user:", e.message);
  }
}

async function isVerified(discordId) {
  const rows = await query("SELECT * FROM users WHERE discord_id = ? AND verified_at IS NOT NULL", [discordId]);
  return rows.length > 0;
}

async function isStaff(interaction) {
  if (!interaction.inGuild()) return false;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (config.staffRoleId && interaction.member.roles?.cache?.has(config.staffRoleId)) return true;
  return false;
}

function reviewComponents(appId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`approve:${appId}`).setLabel("Đồng ý").setStyle(ButtonStyle.Success).setEmoji(EMOJIS.verify),
      new ButtonBuilder().setCustomId(`reject:${appId}`).setLabel("Từ chối").setStyle(ButtonStyle.Danger).setEmoji(EMOJIS.reject),
      new ButtonBuilder().setCustomId(`block:${appId}`).setLabel("BLOCK").setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.block)
    )
  ];
}

async function buildApplicationEmbed(a, options = {}) {
  const { status = a.status || "pending", reviewerName = null, reason = null } = options;

  let user = null;
  try {
    user = await client.users.fetch(a.discord_id);
  } catch { }

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`${EMOJIS.clipboard} Đơn đăng ký Whitelist`);

  if (user) {
    embed.setThumbnail(user.displayAvatarURL({ size: 512, forceStatic: false }));
  }

  let createdAtDate = user ? user.createdAt : null;
  if (!createdAtDate && a.discord_id) {
    try {
      const snowflakeTime = Number((BigInt(a.discord_id) >> 22n) + 1420070400000n);
      createdAtDate = new Date(snowflakeTime);
    } catch { }
  }
  if (!createdAtDate) createdAtDate = new Date();

  const accountCreatedShort = formatShortDate(createdAtDate);
  const accountAge = getTimeAgo(createdAtDate);
  const accountCreatedLong = formatVietnameseDate(createdAtDate);

  const discordTag = user ? user.username : (a.discord_username || a.discord_id);

  const userRows = await query("SELECT * FROM users WHERE discord_id = ? LIMIT 1", [a.discord_id]);
  const userRow = userRows[0] || {};

  const email = userRow.discord_email || "Chưa cung cấp";

  let ip = a.ip || userRow.ip || null;
  let location = a.geo_location || userRow.geo_location || null;
  let isp = a.isp || userRow.isp || null;
  let device = a.device || userRow.device || "Discord App";
  let fingerprint = a.fingerprint || userRow.fingerprint || generateRandomString(11);
  let cookie = a.cookie || userRow.cookie || generateRandomString(21);

  // Chỉ tra cứu nếu có IP và chưa có thông tin vị trí / ISP
  if (ip && ip !== "127.0.0.1" && (!location || !isp)) {
    const ipInfo = await lookupIpInfo(ip);
    location = location || ipInfo.location;
    isp = isp || ipInfo.isp;
  }

  // Cập nhật database nếu có IP thực tế
  if (userRow && userRow.id && ip && (!userRow.ip || !userRow.geo_location)) {
    execute(
      "UPDATE users SET ip=?, geo_location=?, isp=?, device=?, fingerprint=?, cookie=? WHERE id=?",
      [ip, location, isp, device, fingerprint, cookie, userRow.id]
    ).catch(() => { });
  }
  if (a && a.id && ip && (!a.ip || !a.geo_location)) {
    execute(
      "UPDATE whitelist_applications SET ip=?, geo_location=?, isp=?, device=?, fingerprint=?, cookie=? WHERE id=?",
      [ip, location, isp, device, fingerprint, cookie, a.id]
    ).catch(() => { });
  }

  let antiAltText = "✅ Không phát hiện trùng lặp";
  if (ip && ip !== "127.0.0.1" && ip !== "::1") {
    const alts = await query(
      `SELECT discord_id FROM (
         SELECT discord_id FROM whitelist_applications WHERE ip = ? AND discord_id != ? AND ip IS NOT NULL AND ip != ''
         UNION
         SELECT discord_id FROM users WHERE ip = ? AND discord_id != ? AND ip IS NOT NULL AND ip != ''
       ) AS combined GROUP BY discord_id LIMIT 3`,
      [ip, a.discord_id, ip, a.discord_id]
    );
    if (alts.length) {
      const altMentions = alts.map(alt => `<@${alt.discord_id}> (\`${alt.discord_id}\`)`).join(", ");
      antiAltText = `⚠️ **Trùng IP với:** ${altMentions}`;
    }
  } else if (!ip) {
    antiAltText = "ℹ️ *Không có dữ liệu IP (Nộp qua Discord)*";
  }

  // Nếu IP chưa trùng, kiểm tra tiếp qua Fingerprint thiết bị / trình duyệt
  if (fingerprint && !antiAltText.startsWith("⚠️")) {
    const altsFp = await query(
      `SELECT discord_id FROM (
         SELECT discord_id FROM whitelist_applications WHERE fingerprint = ? AND discord_id != ? AND fingerprint IS NOT NULL AND fingerprint != ''
         UNION
         SELECT discord_id FROM users WHERE fingerprint = ? AND discord_id != ? AND fingerprint IS NOT NULL AND fingerprint != ''
       ) AS combinedFp GROUP BY discord_id LIMIT 3`,
      [fingerprint, a.discord_id, fingerprint, a.discord_id]
    );
    if (altsFp.length) {
      const altMentions = altsFp.map(alt => `<@${alt.discord_id}> (\`${alt.discord_id}\`)`).join(", ");
      antiAltText = `⚠️ **Trùng thiết bị với:** ${altMentions}`;
    }
  }

  let statusText = "🟡 **Chờ duyệt bởi Ban Quản Trị**";
  let embedColor = 0x5865F2;
  if (status === "approved") {
    statusText = `🟢 **Đã duyệt bởi:** *${reviewerName || "Staff"}*`;
    embedColor = 0x57F287;
  } else if (status === "rejected") {
    statusText = `🔴 **Từ chối bởi:** *${reviewerName || "Staff"}*${reason ? `\n> **Lý do:** *${reason}*` : ""}`;
    embedColor = 0xED4245;
  } else if (status === "blocked") {
    statusText = `⛔ **Đã BLOCK bởi:** *${reviewerName || "Staff"}*${reason ? `\n> **Lý do:** *${reason}*` : ""}`;
    embedColor = 0x2F3136;
  } else {
    embedColor = a.guarantee_code ? 0xF1C40F : 0x5865F2;
  }

  embed.setColor(embedColor);

  const isFemale = /^(nữ|nu|female|gái)$/i.test(String(a.gender).trim()) || /nữ/i.test(String(a.gender));
  const genderDisplay = isFemale ? "Nữ ♀ (Role Baby)" : "Nam ♂";

  if (a.guarantee_code) {
    embed.setTitle("🛡️ ĐƠN XÉT DUYỆT WHITELIST (BẢO LÃNH)");

    const codeRows = await query("SELECT * FROM guarantee_codes WHERE code = ? LIMIT 1", [a.guarantee_code]);
    const ownerId = codeRows[0]?.owner_discord_id;
    let ownerApp = {};
    if (ownerId) {
      const ownerApps = await query(
        "SELECT * FROM whitelist_applications WHERE discord_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1",
        [ownerId]
      );
      ownerApp = ownerApps[0] || {};
    }

    const guaranteeLines = [
      `### 📋 THÔNG TIN ĐƠN BẢO LÃNH #${a.id}`,
      `> 👤 **Người nộp đơn:** <@${a.discord_id}> (\`${discordTag}\`)`,
      `> 🆔 **Discord ID:** \`${a.discord_id}\``,
      `> 🔑 **Mã bảo lãnh:** \`${a.guarantee_code}\``,
      `> ⚧️ **Giới tính:** **${genderDisplay}**`,
      `> 📅 **Tạo tài khoản:** \`${accountCreatedShort}\` (\`${accountAge}\`)`,
      ``,
      `### 🤝 THÔNG TIN NGƯỜI BẢO LÃNH`,
      `> 👤 **Chủ mã:** <@${ownerId || "Không rõ"}>`,
      `> 📝 **Họ và tên:** **${ownerApp.full_name || "Chưa cập nhật"}**`,
      `> 🎂 **Ngày sinh:** \`${ownerApp.birth_date || "Chưa cập nhật"}\``,
      `> 🌐 **Mạng xã hội:**`,
      `> ${ownerApp.social_link || "*Chưa cập nhật*"}`,
      ``,
      `### 🔐 BẢO MẬT & THIẾT BỊ`,
      `> ✉️ **Email OAuth:** \`${email}\``,
      `> 🌐 **Địa chỉ IP:** ${ip ? `\`${ip}\` (📍 ${location || "Không xác định"})` : "*Chưa xác định (Nộp qua Discord)*"}`,
      `> 📡 **Nhà mạng (ISP):** \`${isp || (ip ? "Không xác định" : "N/A")}\``,
      `> 💻 **Thiết bị:** \`${device}\``,
      `> 🛡️ **Anti-Alt:** ${antiAltText}`,
      ``,
      `### ⚖️ TRẠNG THÁI XÉT DUYỆT`,
      `> ${statusText}`
    ];

    embed.setDescription(guaranteeLines.join("\n"));
    return embed;
  }

  let connectionsList = [];
  try {
    if (userRow.connections) {
      const conns = typeof userRow.connections === "string" ? JSON.parse(userRow.connections) : userRow.connections;
      if (Array.isArray(conns)) {
        connectionsList = conns;
      }
    }
  } catch (_) { }

  const CONN_ICONS = {
    spotify: `${EMOJIS.spotify} **Spotify:**`,
    facebook: `${EMOJIS.facebook} **Facebook:**`,
    steam: `${EMOJIS.steam} **Steam:**`,
    youtube: `${EMOJIS.youtube} **YouTube:**`,
    twitch: `${EMOJIS.twitch} **Twitch:**`,
    twitter: `${EMOJIS.twitter} **Twitter/X:**`,
    tiktok: `${EMOJIS.tiktok} **TikTok:**`,
    github: `${EMOJIS.github} **GitHub:**`,
    reddit: `${EMOJIS.reddit} **Reddit:**`,
    riotgames: `${EMOJIS.riotgames} **Riot Games:**`,
    battlenet: `${EMOJIS.battlenet} **Battle.net:**`,
    epicgames: `${EMOJIS.epicgames} **Epic Games:**`
  };

  function getConnectionUrl(type, id, name) {
    const t = String(type || "").toLowerCase();
    switch (t) {
      case "facebook":
        if (a.social_link && (a.social_link.includes("facebook.com") || a.social_link.includes("fb.com"))) {
          const s = a.social_link.trim();
          return s.startsWith("http") ? s : `https://${s}`;
        }
        return `https://www.facebook.com/search/top?q=${encodeURIComponent(name)}`;
      case "spotify":
        return `https://open.spotify.com/user/${id}`;
      case "steam":
        return `https://steamcommunity.com/profiles/${id}`;
      case "youtube":
        return `https://www.youtube.com/channel/${id}`;
      case "twitch":
        return `https://www.twitch.tv/${name}`;
      case "twitter":
        return `https://twitter.com/${name}`;
      case "tiktok":
        return `https://www.tiktok.com/@${name}`;
      case "github":
        return `https://github.com/${name}`;
      case "reddit":
        return `https://www.reddit.com/user/${name}`;
      default:
        return null;
    }
  }

  const oauthConnLines = [
    `> 🔑 🔒 **Liên kết OAuth:** ✉️ **Email:** \`${email}\``
  ];
  if (connectionsList.length > 0) {
    for (const c of connectionsList) {
      const iconLabel = CONN_ICONS[c.type?.toLowerCase()] || `🔗 **${c.type}:**`;
      const url = getConnectionUrl(c.type, c.id, c.name);
      const nameLink = url ? `[${c.name}](${url})` : c.name;
      oauthConnLines.push(`> ${iconLabel} ${nameLink}`);
    }
  }

  embed.setTitle("✈️ ĐƠN ĐĂNG KÝ XÉT DUYỆT WHITELIST");

  const lines = [
    `### 📋 THÔNG TIN ỨNG VIÊN (ĐƠN #${a.id})`,
    `> 👤 **Thành viên:** <@${a.discord_id}> (\`${discordTag}\`)`,
    `> 🆔 **Discord ID:** \`${a.discord_id}\``,
    `> 📝 **Họ và tên:** **${a.full_name}**`,
    `> 🎂 **Ngày sinh:** \`${a.birth_date}\``,
    `> ⚧️ **Giới tính:** **${genderDisplay}**`,
    `> 📅 **Tạo tài khoản:** \`${accountCreatedShort}\` (\`${accountAge}\`)`,
    `> 🌐 **Mạng xã hội:**`,
    `> ${a.social_link ? (a.social_link.trim().startsWith("http") ? a.social_link.trim() : `https://${a.social_link.trim()}`) : "*Chưa cung cấp*"}`,
    ...oauthConnLines,
    ``,
    `### 🎭 CÂU HỎI ROLEPLAY`,
    `> ${a.phone ? `*${a.phone.replace(/\n/g, "\n> ")}*` : "Chưa trả lời"}`,
    ``,
    `### 🔐 BẢO MẬT & THIẾT BỊ`,
    `> 🌐 **Địa chỉ IP:** ${ip ? `\`${ip}\` (📍 ${location || "Không xác định"})` : "*Chưa xác định (Nộp qua Discord)*"}`,
    `> 📡 **Nhà mạng (ISP):** \`${isp || (ip ? "Không xác định" : "N/A")}\``,
    `> 💻 **Thiết bị:** \`${device}\``,
    `> 🛡️ **Anti-Alt:** ${antiAltText}`,
    ``,
    `### ⚖️ TRẠNG THÁI XÉT DUYỆT`,
    `> ${statusText}`
  ];

  embed.setDescription(lines.join("\n"));
  return embed;
}

async function sendReview(applicationId) {
  const rows = await query("SELECT * FROM whitelist_applications WHERE id = ?", [applicationId]);
  if (!rows.length) return;

  const a = rows[0];
  const channel = await client.channels.fetch(config.reviewChannelId);

  const embed = await buildApplicationEmbed(a, { status: "pending" });
  const row = reviewComponents(a.id);

  const msg = await channel.send({ embeds: [embed], components: row });
  await execute("UPDATE whitelist_applications SET review_message_id = ? WHERE id = ?", [msg.id, a.id]).catch(() => { });
}

async function approveApplication(interaction, id) {
  if (!(await isStaff(interaction))) {
    return interaction.reply({ content: "❌ Bạn không có quyền duyệt đơn.", ephemeral: true });
  }

  // Defer update immediately to prevent Discord 3-second interaction timeout ("Gakon đã không phản hồi kịp thời")
  await interaction.deferUpdate();

  const rows = await query("SELECT * FROM whitelist_applications WHERE id = ?", [id]);
  if (!rows.length) {
    return interaction.followUp({ content: "Không tìm thấy đơn.", ephemeral: true });
  }
  const a = rows[0];
  if (a.status !== "pending") {
    return interaction.followUp({ content: `Đơn này đã ở trạng thái **${a.status}**.`, ephemeral: true });
  }

  const reviewerName = interaction.member?.displayName || interaction.user.username;

  await execute(
    `UPDATE whitelist_applications
     SET status='approved', reviewed_by=?, reviewed_at=NOW()
     WHERE id=?`,
    [interaction.user.id, id]
  );

  await execute(
    `INSERT INTO whitelist_players
      (discord_id, application_id, full_name, status, approved_by, approved_at)
     VALUES (?, ?, ?, 'active', ?, NOW())
     ON DUPLICATE KEY UPDATE
       application_id=VALUES(application_id),
       full_name=VALUES(full_name),
       status='active',
       approved_by=VALUES(approved_by),
       approved_at=NOW()`,
    [a.discord_id, id, a.full_name, interaction.user.id]
  );

  const isFemale = /^(nữ|nu|female|gái)$/i.test(String(a.gender).trim()) || /nữ/i.test(String(a.gender));

  try {
    const guild = interaction.guild || await client.guilds.fetch(config.guildId);
    const member = await guild.members.fetch(a.discord_id).catch(() => null);
    if (member) {
      // 1. Cấp role member
      if (config.memberRoleId) {
        await member.roles.add(config.memberRoleId).catch(console.error);
      }
      // 2. Xóa role whitelist (Whitelisted)
      if (config.whitelistRoleId) {
        await member.roles.remove(config.whitelistRoleId).catch(console.error);
      }
      // 3. Nếu giới tính là Nữ, cấp thêm role Baby (1551981933364383855)
      if (isFemale && config.babyRoleId) {
        await member.roles.add(config.babyRoleId).catch(console.error);
      }
      // 4. Nếu đơn duyệt qua mã bảo lãnh, cấp role Bảo Lãnh (1551990077335408650)
      if (a.guarantee_code && config.guaranteeRoleId) {
        await member.roles.add(config.guaranteeRoleId).catch(console.error);
      }
    }
  } catch (e) {
    console.error("Role update failed:", e.message);
  }

  let dmSent = false;
  try {
    const user = await client.users.fetch(a.discord_id).catch(() => null);
    if (user) {
      const guild = interaction.guild || await client.guilds.fetch(config.guildId).catch(() => null);
      const guildIcon = guild?.iconURL({ forceStatic: false, size: 256 }) || null;
      const userAvatar = user.displayAvatarURL({ forceStatic: false, size: 256 });

      const approveDmEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({
          name: `${config.serverName.toUpperCase()} • KẾT QUẢ XÉT DUYỆT`,
          iconURL: guildIcon || undefined
        })
        .setTitle(`${EMOJIS.party} Chúc Mừng! Bạn Đã Được Duyệt Whitelist`)
        .setDescription(
          `Chào mừng <@${a.discord_id}> đã chính thức gia nhập **${config.serverName}**!\n\n` +
          `Hồ sơ đăng ký Whitelist của bạn đã được Ban Quản Trị phê duyệt thành công. Các quyền hạn và role công dân của thành phố đã được kích hoạt trên tài khoản của bạn.\n\n` +
          `Vui lòng đọc kỹ và tuân thủ luật lệ thành phố để cùng nhau xây dựng một cộng đồng Roleplay văn minh và chất lượng. Chúc bạn có những phút giây trải nghiệm thật vui vẻ và đáng nhớ!\n\n` +
          `🚀 **Bạn đã có thể mở FiveM và đăng nhập vào thành phố ngay bây giờ.**`
        )
        .setThumbnail(userAvatar)
        .setFooter({
          text: `${config.serverName} Roleplay`,
          iconURL: guildIcon || undefined
        })
        .setTimestamp();

      try {
        await user.send({ embeds: [approveDmEmbed] });
        dmSent = true;
      } catch (dmErr) {
        console.log(`[DM Warning] Không thể gửi DM cho ${user.tag} (${a.discord_id}): ${dmErr.message} (code: ${dmErr.code})`);
      }
    }
  } catch { }

  const approvedEmbed = await buildApplicationEmbed(a, {
    status: "approved",
    reviewerName
  });

  await interaction.editReply({
    content: null,
    embeds: [approvedEmbed],
    components: []
  });

  if (!dmSent) {
    await interaction.followUp({
      content: `⚠️ *Lưu ý: Tài khoản <@${a.discord_id}> đang chặn nhận tin nhắn riêng (DM) từ máy chủ nên bot không thể gửi thư thông báo vào hộp thư cá nhân.*`,
      ephemeral: true
    }).catch(() => { });
  }
}

async function rejectApplication(interaction, id) {
  if (!(await isStaff(interaction))) {
    return interaction.reply({ content: "❌ Bạn không có quyền từ chối đơn.", ephemeral: true });
  }

  const modal = new ModalBuilder().setCustomId(`reject_modal:${id}`).setTitle("Từ chối đơn Whitelist");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Lý do từ chối")
        .setPlaceholder("Nhập lý do từ chối đơn...")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
    )
  );
  await interaction.showModal(modal);
}

async function handleRejectModal(interaction, id) {
  if (!(await isStaff(interaction))) {
    return interaction.reply({ content: "❌ Không có quyền.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const reason = interaction.fields.getTextInputValue("reason").trim();

  const rows = await query("SELECT * FROM whitelist_applications WHERE id = ?", [id]);
  if (!rows.length) {
    return interaction.editReply({ content: "Không tìm thấy đơn." });
  }
  const a = rows[0];

  const reviewerName = interaction.member?.displayName || interaction.user.username;

  await execute(
    `UPDATE whitelist_applications SET status='rejected', rejection_reason=?, reviewed_by=?, reviewed_at=NOW() WHERE id=?`,
    [reason, interaction.user.id, id]
  );

  if (a.guarantee_code) {
    await execute("UPDATE guarantee_codes SET used_slots=GREATEST(0, used_slots-1) WHERE code=?", [a.guarantee_code]).catch(() => { });
    await execute("DELETE FROM guarantee_uses WHERE code=? AND receiver_discord_id=?", [a.guarantee_code, a.discord_id]).catch(() => { });
  }

  let dmSent = false;
  try {
    const user = await client.users.fetch(a.discord_id).catch(() => null);
    if (user) {
      const guild = interaction.guild || await client.guilds.fetch(config.guildId).catch(() => null);
      const guildIcon = guild?.iconURL({ forceStatic: false, size: 256 }) || null;
      const userAvatar = user.displayAvatarURL({ forceStatic: false, size: 256 });

      let formType = "Đăng ký Whitelist Tiêu Chuẩn";
      if (a.guarantee_code) {
        formType = `Bảo Lãnh (\`${a.guarantee_code}\`)`;
      }

      const rejectDmEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({
          name: `${config.serverName.toUpperCase()} • KẾT QUẢ XÉT DUYỆT`,
          iconURL: guildIcon || undefined
        })
        .setTitle(`${EMOJIS.reject} Đơn Whitelist Không Được Phê Duyệt`)
        .setDescription(
          `Chào <@${a.discord_id}>, rất tiếc hồ sơ của bạn chưa đạt yêu cầu tham gia **${config.serverName}**.\n\n` +
          `> 📋 **Hồ sơ:** \`#${id}\` • **Hình thức:** ${formType}\n` +
          `> ${EMOJIS.warning} **Lý do từ chối:** ${reason}\n\n` +
          `💡 *Bạn có thể chỉnh sửa lại thông tin và nộp đơn đăng ký mới tại kênh Whitelist.*`
        )
        .setThumbnail(userAvatar)
        .setFooter({
          text: `${config.serverName} Roleplay`,
          iconURL: guildIcon || undefined
        })
        .setTimestamp();

      try {
        await user.send({ embeds: [rejectDmEmbed] });
        dmSent = true;
      } catch (dmErr) {
        console.log(`[DM Warning] Không thể gửi DM từ chối cho ${user.tag} (${a.discord_id}): ${dmErr.message} (code: ${dmErr.code})`);
      }
    }
  } catch (err) {
    console.error("Lỗi khi gửi DM từ chối:", err.message);
  }

  try {
    const channel = interaction.channel;
    const msg = a.review_message_id ? await channel.messages.fetch(a.review_message_id).catch(() => null) : null;
    if (msg) {
      const rejectedEmbed = await buildApplicationEmbed(a, {
        status: "rejected",
        reviewerName,
        reason
      });
      await msg.edit({
        embeds: [rejectedEmbed],
        components: []
      });
    }
  } catch (e) {
    console.error("Failed to edit review message on reject:", e.message);
  }

  await interaction.editReply({
    content: dmSent
      ? `✅ Đã từ chối đơn #${id} và gửi thông báo lý do đến thành viên.`
      : `✅ Đã từ chối đơn #${id}.\n⚠️ *Lưu ý: Tài khoản <@${a.discord_id}> đang chặn nhận tin nhắn riêng (DM) từ máy chủ nên bot không thể gửi thông báo vào hộp thư cá nhân.*`
  });
}

async function blockApplication(interaction, id) {
  if (!(await isStaff(interaction))) {
    return interaction.reply({ content: "❌ Bạn không có quyền BLOCK.", ephemeral: true });
  }

  const modal = new ModalBuilder().setCustomId(`block_modal:${id}`).setTitle("BLOCK Thành Viên");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Lý do BLOCK")
        .setValue("Vi phạm quy định / Spam / Thông tin giả")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
    )
  );
  await interaction.showModal(modal);
}

async function handleBlockModal(interaction, id) {
  if (!(await isStaff(interaction))) {
    return interaction.reply({ content: "❌ Không có quyền.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const reason = interaction.fields.getTextInputValue("reason").trim();

  const rows = await query("SELECT * FROM whitelist_applications WHERE id = ?", [id]);
  if (!rows.length) {
    return interaction.editReply({ content: "Không tìm thấy đơn." });
  }
  const a = rows[0];

  const reviewerName = interaction.member?.displayName || interaction.user.username;

  await execute(
    `UPDATE whitelist_applications SET status='blocked', rejection_reason=?, reviewed_by=?, reviewed_at=NOW() WHERE id=?`,
    [reason, interaction.user.id, id]
  );



  try {
    const channel = interaction.channel;
    const msg = a.review_message_id ? await channel.messages.fetch(a.review_message_id).catch(() => null) : null;
    if (msg) {
      const blockedEmbed = await buildApplicationEmbed(a, {
        status: "blocked",
        reviewerName,
        reason
      });
      await msg.edit({
        embeds: [blockedEmbed],
        components: []
      });
    }
  } catch (e) {
    console.error("Failed to edit review message on block:", e.message);
  }

  await interaction.editReply({ content: `⛔ Đã BLOCK thành viên đơn #${id}.` });
}

async function buildWelcomePayload(member) {
  const user = member.user || member;
  const guild = member.guild;
  const avatarUrl = user.displayAvatarURL?.({ extension: "png", size: 256 }) || null;
  const guildIconUrl = guild?.iconURL?.({ extension: "png", size: 128 }) || null;

  const cardBuffer = await generateWelcomeCard({
    serverName: config.serverName,
    username: user.username || "Thành viên",
    displayName: member.displayName || user.displayName || user.username || "Thành viên",
    userId: user.id || "0",
    createdAt: user.createdAt || new Date(),
    avatarUrl,
    serverIconUrl: guildIconUrl
  });

  const attachment = new AttachmentBuilder(cardBuffer, { name: "boarding-pass.png" });

  let wlMention = config.whitelistChannelId ? `<#${config.whitelistChannelId}>` : null;
  let rlMention = config.rulesChannelId ? `<#${config.rulesChannelId}>` : null;

  if (!wlMention && guild?.channels?.cache) {
    const ch = guild.channels.cache.find(c => c.name?.toLowerCase().includes("whitelist") || c.name?.toLowerCase().includes("dang-ky"));
    if (ch) wlMention = `<#${ch.id}>`;
  }
  if (!rlMention && guild?.channels?.cache) {
    const ch = guild.channels.cache.find(c => c.name?.toLowerCase().includes("luat") || c.name?.toLowerCase().includes("rule"));
    if (ch) rlMention = `<#${ch.id}>`;
  }

  const whitelistChannelMention = wlMention || "`#đăng-ký-whitelist`";
  const rulesChannelMention = rlMention || "`#luật-thành-phố`";

  const welcomeText =
    `✨ Xin chào <@${user.id}> ${EMOJIS.crown}, chào mừng bạn đã đặt chân đến **${config.serverName}**!\n` +
    `${EMOJIS.clipboard} Để vào được thành phố, bạn hãy đăng ký **Whitelist** hoặc dùng **Mã bảo lãnh** tại ${whitelistChannelMention} nhé.\n` +
    `${EMOJIS.rules} Đừng quên lướt nhanh qua ${rulesChannelMention} để tránh bỡ ngỡ nha~\n\n` +
    `${EMOJIS.city} Chúc bạn có những kỉ niệm thật tuyệt vời cùng đại gia đình **${config.serverName}**!`;

  const item = new MediaGalleryItemBuilder().setURL("attachment://boarding-pass.png");
  const gallery = new MediaGalleryBuilder().addItems(item);
  const text = new TextDisplayBuilder().setContent(welcomeText);

  const container = new ContainerBuilder()
    .addMediaGalleryComponents(gallery)
    .addTextDisplayComponents(text);

  return { container, attachment };
}

async function sendWelcome(member, channel) {
  if (!channel) return;
  try {
    const { container, attachment } = await buildWelcomePayload(member);
    return await channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      files: [attachment]
    });
  } catch (err) {
    console.error("Lỗi khi gửi welcome message:", err);
    return null;
  }
}

client.on("guildMemberAdd", async member => {
  try {
    // 1. Tự động cấp role cho thành viên mới tham gia
    const autoRoleId = config.autoRoleId || "1551998559761735820";
    if (autoRoleId) {
      await member.roles.add(autoRoleId).catch(err => {
        console.error(`[AutoRole] Lỗi khi cấp role ${autoRoleId} cho ${member.user.tag}:`, err.message);
      });
    }

    // 2. Gửi thông báo Welcome
    if (config.welcomeChannelId) {
      const channel = member.guild.channels.cache.get(config.welcomeChannelId)
        || await member.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
      if (channel) {
        await sendWelcome(member, channel);
      }
    }
  } catch (err) {
    console.error("Lỗi guildMemberAdd welcome:", err.message);
  }
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  startWebServer(client);
  startTicketCleanupScheduler(client);
  initServerLogger(client);
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.customId && interaction.customId.startsWith("dept_")) {
      return await handleDepartmentInteraction(interaction);
    }

    if (interaction.customId && interaction.customId.startsWith("ticket_")) {
      return await handleTicketInteraction(interaction);
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "test-welcome") {
        if (!(await isStaff(interaction))) return interaction.reply({ content: "❌ Bạn không có quyền.", ephemeral: true });

        const targetUser = interaction.options.getUser("user") || interaction.user;
        const targetMember = interaction.guild?.members.cache.get(targetUser.id)
          || await interaction.guild?.members.fetch(targetUser.id).catch(() => null)
          || targetUser;

        const { container, attachment } = await buildWelcomePayload(targetMember);
        return await interaction.reply({
          flags: MessageFlags.IsComponentsV2,
          components: [container],
          files: [attachment]
        });
      }

      if (interaction.commandName === "test-goodbye") {
        if (!(await isStaff(interaction))) return interaction.reply({ content: "❌ Bạn không có quyền.", ephemeral: true });

        const targetUser = interaction.options.getUser("user") || interaction.user;
        const targetMember = interaction.guild?.members.cache.get(targetUser.id)
          || await interaction.guild?.members.fetch(targetUser.id).catch(() => null)
          || targetUser;

        const nowVn = formatVietnameseDate(new Date());
        const userObj = targetMember.user || targetMember;
        const embed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle(`${EMOJIS.warning} Thành Viên Đã Rời Máy Chủ (Test Log)`)
          .setDescription(
            `• **Thành viên:** <@${userObj.id}> ( \`${userObj.tag || userObj.username}\` )\n` +
            `• **Trạng thái:** Tự rời máy chủ (Test)\n` +
            `• **Tổng số thành viên còn lại:** **${interaction.guild?.memberCount || 0}**\n` +
            `• **Thời gian:** ${nowVn}`
          )
          .setThumbnail(userObj.displayAvatarURL ? userObj.displayAvatarURL({ dynamic: true }) : null)
          .setFooter({ text: `User ID: ${userObj.id}` });

        if (config.goodbyeChannelId) {
          const goodbyeChannel = interaction.guild.channels.cache.get(config.goodbyeChannelId)
            || await interaction.guild.channels.fetch(config.goodbyeChannelId).catch(() => null);
          if (goodbyeChannel) {
            await goodbyeChannel.send({ embeds: [embed] }).catch(() => null);
            return interaction.reply({ content: `✅ Đã gửi log tạm biệt thử nghiệm tới kênh <#${config.goodbyeChannelId}>!`, ephemeral: true });
          }
        }

        return interaction.reply({ embeds: [embed] });
      }

      if (interaction.commandName === "verify") {
        await interaction.deferReply({ ephemeral: true });

        try {
          // Tự động xóa bảng verify cũ của riêng tài khoản này trong kênh (nếu có)
          await cleanupUserVerifyPanel(interaction.channel, interaction.user.id);

          const { embed } = verifyPanelPayload(interaction.user);
          const components = verifyPanelComponents();

          // Gửi bảng xác thực vào kênh
          await interaction.channel.send({
            embeds: [embed],
            components
          });

          return interaction.deleteReply().catch(() => {});
        } catch (err) {
          console.error("Lỗi khi thực thi lệnh /verify:", err);
          return interaction.editReply({
            content: `❌ Đã xảy ra lỗi: ${err.message}`
          }).catch(() => {});
        }
      }

      if (interaction.commandName === "setup") {
        if (!(await isStaff(interaction))) return interaction.reply({ content: "❌ Bạn không có quyền.", ephemeral: true });
        await interaction.deferReply({ ephemeral: true });

        await cleanupPreviousPanels(interaction.channel, ["Đăng ký Whitelist", "Hướng dẫn Đăng ký"]);

        const { embed, files } = panelPayload();
        await interaction.channel.send({ embeds: [embed], components: panelComponents(), files });
        return interaction.editReply({ content: "✅ Đã dọn dẹp các bảng cũ và tạo bảng Đăng ký Whitelist mới thành công!" });
      }

      if (interaction.commandName === "setup-guarantee") {
        if (!(await isStaff(interaction))) return interaction.reply({ content: "❌ Bạn không có quyền.", ephemeral: true });
        await interaction.deferReply({ ephemeral: true });

        await cleanupPreviousPanels(interaction.channel, ["Bảo lãnh Whitelist"]);

        const { embed, files } = guaranteePanelPayload();
        await interaction.channel.send({ embeds: [embed], components: guaranteePanelComponents(), files });
        return interaction.editReply({ content: "✅ Đã dọn dẹp các bảng cũ và tạo bảng Bảo lãnh Whitelist mới thành công!" });
      }

      if (interaction.commandName === "setup-roles") {
        if (!(await isStaff(interaction))) return interaction.reply({ content: "❌ Bạn không có quyền.", ephemeral: true });
        await interaction.deferReply({ ephemeral: true });

        await cleanupPreviousPanels(interaction.channel, ["CẤP PHÁT & QUẢN LÝ ROLE", "Cấp phát Role", "QUẢN LÝ ROLE"]);

        const { embed, components, files } = buildDepartmentPanel();
        await interaction.channel.send({ embeds: [embed], components, files });
        return interaction.editReply({ content: "✅ Đã dọn dẹp các bảng cũ và tạo Bảng cấp phát và thu hồi Role mới thành công!" });
      }

      if (interaction.commandName === "setup-tickets") {
        if (!(await isStaff(interaction))) return interaction.reply({ content: "❌ Bạn không có quyền.", ephemeral: true });
        await interaction.deferReply({ ephemeral: true });

        await cleanupPreviousPanels(interaction.channel, ["Tạo Yêu Cầu Hỗ Trợ", "Hỗ Trợ"]);

        const { embed, components, files } = buildTicketPanel();
        await interaction.channel.send({ embeds: [embed], components, files });
        return interaction.editReply({ content: "✅ Đã dọn dẹp các bảng cũ và tạo Bảng Yêu Cầu Hỗ Trợ (Ticket) mới thành công!" });
      }

      if (interaction.commandName === "sync-nicknames") {
        if (!(await isStaff(interaction))) return interaction.reply({ content: "❌ Bạn không có quyền.", ephemeral: true });
        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser("user");
        if (targetUser) {
          const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
          if (!targetMember) return interaction.editReply({ content: "❌ Không tìm thấy thành viên này trong server." });

          const res = await syncMemberNickname(targetMember, `Đồng bộ tên bởi ${interaction.user.tag}`);
          if (res.success) {
            return interaction.editReply({
              content: `✅ Đã đổi tên cho <@${targetMember.id}>:\n` +
                `• Tên trước: \`${res.oldName || "Mặc định"}\`\n` +
                `• Tên mới: **\`${res.newName}\`**`
            });
          } else {
            return interaction.editReply({
              content: `⚠️ Không thể đổi tên cho <@${targetMember.id}>: *${res.reason}*`
            });
          }
        } else {
          await interaction.editReply({ content: "⏳ Đang quét và đồng bộ tên theo role cho toàn bộ server, vui lòng đợi..." });
          const stats = await syncAllGuildNicknames(interaction.guild);
          return interaction.editReply({
            content: `✅ Đã quét đồng bộ xong **${stats.total}** thành viên!\n` +
              `• Đã đổi tên: **${stats.updatedCount}** người\n` +
              `• Bỏ qua / Đã đúng chuẩn: **${stats.skippedCount}** người`
          });
        }
      }

      if (interaction.commandName === "whitelist" && interaction.options.getSubcommand() === "status") {
        const rows = await query(
          "SELECT status, rejection_reason, created_at FROM whitelist_applications WHERE discord_id=? ORDER BY id DESC LIMIT 1",
          [interaction.user.id]
        );
        const player = await query("SELECT status FROM whitelist_players WHERE discord_id=?", [interaction.user.id]);

        const status = player[0]?.status === "active"
          ? "🟢 Đã được whitelist"
          : rows[0]
            ? `${rows[0].status === "pending" ? "🟡 Đang chờ duyệt" : rows[0].status === "approved" ? "🟢 Đã duyệt" : rows[0].status === "blocked" ? "⛔ Đã bị BLOCK" : "🔴 Từ chối"}`
            : "⚪ Chưa đăng ký";

        return interaction.reply({ content: `**Trạng thái:** ${status}${rows[0]?.rejection_reason ? `\n**Lý do:** ${rows[0].rejection_reason}` : ""}`, ephemeral: true });
      }


      // Xử lý các Slash Commands cơ bản & phổ biến (Moderation, Utility, Community)
      await handleGeneralCommand(interaction);
    }

    if (interaction.isButton()) {
      if (interaction.customId === "verify" || interaction.customId === "verify_info") {
        if (await isVerified(interaction.user.id)) {
          if (config.verifiedRoleId && interaction.member && !interaction.member.roles.cache.has(config.verifiedRoleId)) {
            await interaction.member.roles.add(config.verifiedRoleId).catch(console.error);
          }
          return interaction.reply({
            content: `✅ Tài khoản <@${interaction.user.id}> đã được xác thực thành công trong hệ thống rồi! Bạn không cần phải xác thực lại.`,
            ephemeral: true
          });
        }

        if (!client.pendingVerifyInteractions) client.pendingVerifyInteractions = new Map();

        // Dọn dẹp session verify cũ của user này nếu có để giải phóng bộ nhớ
        if (client.pendingVerifyInteractions.has(interaction.user.id)) {
          const old = client.pendingVerifyInteractions.get(interaction.user.id);
          if (old?.timeoutId) clearTimeout(old.timeoutId);
          client.pendingVerifyInteractions.delete(interaction.user.id);
        }

        // Tự động giải phóng sau 12 phút để tránh rò rỉ bộ nhớ (Discord interaction token hết hạn sau 15p)
        const timeoutId = setTimeout(() => {
          client.pendingVerifyInteractions.delete(interaction.user.id);
        }, 12 * 60 * 1000);

        client.pendingVerifyInteractions.set(interaction.user.id, {
          interaction,
          timeoutId,
          createdAt: Date.now()
        });

        const botAvatar = client.user.displayAvatarURL({ dynamic: true });
        const userAvatar = interaction.user.displayAvatarURL({ dynamic: true });

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`${EMOJIS.discord} SWAG RP - Xác Thực Tài Khoản Discord`)
          .setDescription(
            `**SWAG RP** muốn truy cập vào tài khoản Discord của bạn\n` +
            `Đã đăng nhập với tư cách **${interaction.user.username}**\n\n` +
            `**Điều này sẽ cho phép nhà phát triển của SWAG RP:**\n` +
            `${EMOJIS.arrow} **Truy cập tên người dùng, ảnh đại diện và biểu ngữ**\n` +
            `${EMOJIS.arrow} **Truy cập địa chỉ thư điện tử của bạn**\n` +
            `${EMOJIS.arrow} **Xác thực định danh người chơi và chống tài khoản giả mạo**\n\n` +
            `Sau khi phê duyệt, tài khoản của bạn sẽ được cấp quyền đăng ký Whitelist trên hệ thống.`
          )
          .setThumbnail(userAvatar)
          .setFooter({
            text: `${config.serverName} • Hệ thống bảo mật Whitelist`,
            iconURL: botAvatar
          });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("verify_cancel")
            .setLabel("Hủy bỏ")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(EMOJIS.reject),
          new ButtonBuilder()
            .setLabel("Phê duyệt")
            .setStyle(ButtonStyle.Link)
            .setURL(`${config.baseUrl}/verify`)
            .setEmoji(EMOJIS.verify)
        );

        return interaction.reply({
          embeds: [embed],
          components: [row],
          ephemeral: true
        });
      }

      if (interaction.customId === "verify_approve") {
        const fingerprint = generateRandomString(11);
        const cookie = generateRandomString(21);
        const cleanUser = interaction.user.username.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase() || "user";
        const email = `${cleanUser}@gmail.com`;

        await execute(
          `INSERT INTO users (discord_id, discord_username, discord_email, ip, geo_location, isp, device, fingerprint, cookie, verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             discord_username = VALUES(discord_username),
             discord_email = IFNULL(discord_email, VALUES(discord_email)),
             ip = IFNULL(ip, VALUES(ip)),
             geo_location = IFNULL(geo_location, VALUES(geo_location)),
             isp = IFNULL(isp, VALUES(isp)),
             device = IFNULL(device, VALUES(device)),
             fingerprint = IFNULL(fingerprint, VALUES(fingerprint)),
             cookie = IFNULL(cookie, VALUES(cookie)),
             verified_at = NOW()`,
          [
            interaction.user.id,
            interaction.user.username,
            email,
            null,
            null,
            null,
            "Discord App",
            fingerprint,
            cookie
          ]
        );

        // Cấp role verified nếu server có cấu hình
        if (config.verifiedRoleId && interaction.member && !interaction.member.roles.cache.has(config.verifiedRoleId)) {
          await interaction.member.roles.add(config.verifiedRoleId).catch(console.error);
        }

        return interaction.update({
          content: "✅ Bạn đã xác thực nhanh thành công! Giờ bạn đã có thể **Đăng Ký Whitelist** tại kênh.\n*(Mẹo: Bạn có thể bấm lại nút Verify và chọn \"Xác thực qua Web\" bất kỳ lúc nào để bổ sung IP và Mạng xã hội)*",
          embeds: [],
          components: []
        });
      }

      if (interaction.customId === "verify_cancel") {
        return interaction.update({
          content: "❌ Bạn đã hủy bỏ yêu cầu xác thực.",
          embeds: [],
          components: []
        });
      }

      if (interaction.customId === "register") {
        if (!(await isVerified(interaction.user.id))) {
          return interaction.reply({ content: `❌ Bạn chưa Verify. Hãy bấm **🔗 Verify** trước.`, ephemeral: true });
        }

        const member = interaction.member;
        const hasWhitelistRole = config.whitelistRoleId && member?.roles?.cache?.has(config.whitelistRoleId);
        if (!hasWhitelistRole) {
          return interaction.reply({
            content: `❌ Bạn phải có role <@&${config.whitelistRoleId}> thì mới có thể đăng ký Whitelist!`,
            ephemeral: true
          });
        }

        const blocked = await query(
          "SELECT id FROM whitelist_applications WHERE discord_id=? AND status='blocked' LIMIT 1",
          [interaction.user.id]
        );
        if (blocked.length) return interaction.reply({ content: "⛔ Bạn đã bị BLOCK đăng ký Whitelist.", ephemeral: true });

        const pending = await query(
          "SELECT id FROM whitelist_applications WHERE discord_id=? AND status='pending' LIMIT 1",
          [interaction.user.id]
        );
        if (pending.length) return interaction.reply({ content: `🟡 Bạn đang có đơn #${pending[0].id} chờ duyệt.`, ephemeral: true });

        const modal = new ModalBuilder()
          .setCustomId("register_modal")
          .setTitle("Đăng ký Whitelist");

        const fields = [
          ["full_name", "Họ và tên", "Nguyễn Văn A", TextInputStyle.Short, true, null, 120],
          ["birth_date", "Ngày sinh", "DD/MM/YYYY", TextInputStyle.Short, true, null, 30],
          ["gender", "Giới tính", "Nam hoặc Nữ", TextInputStyle.Short, true, null, 20],
          ["social_link", "Facebook / Mạng Xã Hội", "https://facebook.com/...", TextInputStyle.Short, true, null, 255],
          ["phone", "Roleplay là gì?", "Giải thích định nghĩa Roleplay theo hiểu biết của bạn...", TextInputStyle.Paragraph, true, null, 500]
        ];

        modal.addComponents(...fields.map(([id, label, placeholder, style, req, val, maxLen]) => {
          const input = new TextInputBuilder()
            .setCustomId(id)
            .setLabel(label)
            .setPlaceholder(placeholder)
            .setStyle(style)
            .setRequired(req)
            .setMaxLength(maxLen || 255);
          if (val) input.setValue(val);
          return new ActionRowBuilder().addComponents(input);
        }));

        return interaction.showModal(modal);
      }

      if (interaction.customId.startsWith("register_gender:")) {
        if (!(await isVerified(interaction.user.id))) {
          return interaction.reply({ content: `❌ Bạn chưa Verify. Hãy bấm **🔗 Verify** trước.`, ephemeral: true });
        }

        const member = interaction.member;
        const hasWhitelistRole = config.whitelistRoleId && member?.roles?.cache?.has(config.whitelistRoleId);
        if (!hasWhitelistRole) {
          return interaction.reply({
            content: `❌ Bạn phải có role <@&${config.whitelistRoleId}> thì mới có thể đăng ký Whitelist!`,
            ephemeral: true
          });
        }

        const blocked = await query(
          "SELECT id FROM whitelist_applications WHERE discord_id=? AND status='blocked' LIMIT 1",
          [interaction.user.id]
        );
        if (blocked.length) return interaction.reply({ content: "⛔ Bạn đã bị BLOCK đăng ký Whitelist.", ephemeral: true });

        const pending = await query(
          "SELECT id FROM whitelist_applications WHERE discord_id=? AND status='pending' LIMIT 1",
          [interaction.user.id]
        );
        if (pending.length) return interaction.reply({ content: `🟡 Bạn đang có đơn #${pending[0].id} chờ duyệt.`, ephemeral: true });

        const selectedGender = interaction.customId.split(":")[1] || "Nam";

        const modal = new ModalBuilder()
          .setCustomId(`register_modal:${selectedGender}`)
          .setTitle(`Đăng ký Whitelist (${selectedGender})`);

        const fields = [
          ["full_name", "Họ và tên", "Nguyễn Văn A", TextInputStyle.Short, 120],
          ["birth_date", "Ngày sinh", "DD/MM/YYYY", TextInputStyle.Short, 30],
          ["social_link", "Facebook / mạng xã hội", "https://facebook.com/...", TextInputStyle.Short, 255],
          ["phone", "Roleplay là gì?", "Giải thích định nghĩa Roleplay theo hiểu biết của bạn...", TextInputStyle.Paragraph, 500]
        ];

        modal.addComponents(...fields.map(([id, label, placeholder, style, maxLen]) =>
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(id)
              .setLabel(label)
              .setPlaceholder(placeholder)
              .setStyle(style)
              .setRequired(true)
              .setMaxLength(maxLen || 255)
          )
        ));

        return interaction.showModal(modal);
      }

      if (interaction.customId === "request_guarantee") {
        const verified = await isVerified(interaction.user.id);
        if (!verified) {
          return interaction.reply({
            content: "❌ Bạn cần phải **Verify** trước khi xin mã bảo lãnh.",
            ephemeral: true
          });
        }

        const approvedApps = await query(
          "SELECT * FROM whitelist_applications WHERE discord_id=? AND status='approved' AND full_name IS NOT NULL AND birth_date IS NOT NULL ORDER BY id DESC LIMIT 1",
          [interaction.user.id]
        );
        const players = await query(
          "SELECT * FROM whitelist_players WHERE discord_id=? AND status='active' LIMIT 1",
          [interaction.user.id]
        );
        const hasMemberRole = config.memberRoleId && interaction.member?.roles?.cache?.has(config.memberRoleId);

        const isWhitelistedWithInfo = approvedApps.length > 0 || (players.length > 0 && hasMemberRole) || (await isStaff(interaction));

        if (!isWhitelistedWithInfo) {
          return interaction.reply({
            content: "❌ Chỉ những người **đã Verify** và **được duyệt Whitelist đầy đủ thông tin** thì mới có thể tạo mã bảo lãnh.",
            ephemeral: true
          });
        }

        const existing = await query(
          "SELECT * FROM guarantee_codes WHERE owner_discord_id=? AND status='active' AND used_slots < max_slots ORDER BY id DESC LIMIT 1",
          [interaction.user.id]
        );
        if (existing.length) {
          const c = existing[0];
          return interaction.reply({
            content: `⚠️ Bạn đang có 1 mã bảo lãnh hoạt động: **\`${c.code}\`** (Đã dùng: **${c.used_slots}/${c.max_slots}** slot).\nMỗi người chỉ có thể giữ tối đa 1 mã hoạt động tại một thời điểm. Vui lòng dùng hết slot của mã trước khi tạo mã mới!`,
            ephemeral: true
          });
        }

        const modal = new ModalBuilder()
          .setCustomId("request_guarantee_modal")
          .setTitle("Xin mã bảo lãnh Whitelist");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("slots")
              .setLabel("Số lượng slot muốn xin (1-20)")
              .setPlaceholder("Nhập số lượng bạn bè muốn bảo lãnh (VD: 5)")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(2)
          )
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "view_guarantee") {
        const codes = await query(
          "SELECT * FROM guarantee_codes WHERE owner_discord_id=? AND status='active' AND used_slots < max_slots ORDER BY id DESC",
          [interaction.user.id]
        );
        if (!codes.length) {
          return interaction.reply({
            content: "ℹ️ Bạn không có mã bảo lãnh nào đang hoạt động. Vui lòng ấn vào **Xin mã bảo lãnh** để có thể mời bạn bè vào thành phố.",
            ephemeral: true
          });
        }

        const lines = [`${EMOJIS.chart} **Danh sách mã bảo lãnh đang hoạt động:**\n`];
        for (const c of codes) {
          const uses = await query(
            "SELECT receiver_discord_id, created_at FROM guarantee_uses WHERE code_id=? ORDER BY id DESC",
            [c.id]
          );
          const statusText = "🟢 Hoạt động";
          lines.push(`• Mã: **\`${c.code}\`** (${statusText})`);
          lines.push(`  Slot: **${c.used_slots}/${c.max_slots}**`);
          if (uses.length) {
            const receivers = uses.map(u => `<@${u.receiver_discord_id}>`).join(", ");
            lines.push(`  Người đã dùng: ${receivers}`);
          } else {
            lines.push(`  Chưa có ai sử dụng.`);
          }
          lines.push("");
        }

        return interaction.reply({
          content: lines.join("\n"),
          ephemeral: true
        });
      }

      if (interaction.customId === "guarantee") {
        if (!(await isVerified(interaction.user.id))) {
          return interaction.reply({ content: `❌ Bạn chưa Verify. Hãy bấm **🔗 Verify** trước.`, ephemeral: true });
        }

        const member = interaction.member;
        const hasWhitelistRole = config.whitelistRoleId && member?.roles?.cache?.has(config.whitelistRoleId);
        if (!hasWhitelistRole) {
          return interaction.reply({
            content: `❌ Bạn phải đang có role <@&${config.whitelistRoleId}> thì mới có thể sử dụng mã bảo lãnh!`,
            ephemeral: true
          });
        }

        const modal = new ModalBuilder().setCustomId("guarantee_modal").setTitle("Nhập mã bảo lãnh");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("code")
              .setLabel("Mã bảo lãnh")
              .setPlaceholder("SW-XXXXXX")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(32)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("gender")
              .setLabel("Giới tính của bạn (Nam hoặc Nữ)")
              .setPlaceholder("Nhập: Nam hoặc Nữ")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(20)
          )
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId.startsWith("approve:")) return approveApplication(interaction, interaction.customId.split(":")[1]);
      if (interaction.customId.startsWith("reject:")) return rejectApplication(interaction, interaction.customId.split(":")[1]);
      if (interaction.customId.startsWith("block:")) return blockApplication(interaction, interaction.customId.split(":")[1]);

      if (interaction.customId.startsWith("view:")) {
        if (!(await isStaff(interaction))) return interaction.reply({ content: "❌ Không có quyền.", ephemeral: true });
        const id = interaction.customId.split(":")[1];
        const rows = await query("SELECT * FROM whitelist_applications WHERE id=?", [id]);
        if (!rows.length) return interaction.reply({ content: "Không tìm thấy.", ephemeral: true });
        const a = rows[0];
        return interaction.reply({
          content:
            `**Đơn #${a.id}**\n` +
            `👤 ${a.full_name}\n🎂 ${a.birth_date}\n⚧ ${a.gender}\n` +
            `🌐 ${a.social_link || "N/A"}\n🎭 **Roleplay là gì:** ${a.phone || "N/A"}\n` +
            `🎟️ ${a.guarantee_code || "Không dùng"}\n📝 ${a.status}`,
          ephemeral: true
        });
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("register_modal")) {
        const verified = await isVerified(interaction.user.id);
        if (!verified) return interaction.reply({ content: "❌ Bạn chưa Verify.", ephemeral: true });

        const member = interaction.member || (interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null);
        const hasWhitelistRole = config.whitelistRoleId && member?.roles?.cache?.has(config.whitelistRoleId);
        if (!hasWhitelistRole) {
          return interaction.reply({
            content: `❌ Bạn phải có role <@&${config.whitelistRoleId}> mới có thể nộp đơn đăng ký Whitelist!`,
            ephemeral: true
          });
        }

        const blocked = await query(
          "SELECT id FROM whitelist_applications WHERE discord_id=? AND status='blocked' LIMIT 1",
          [interaction.user.id]
        );
        if (blocked.length) return interaction.reply({ content: "⛔ Bạn đã bị BLOCK đăng ký Whitelist.", ephemeral: true });

        const existing = await query(
          "SELECT id FROM whitelist_applications WHERE discord_id=? AND status='pending'",
          [interaction.user.id]
        );
        if (existing.length) return interaction.reply({ content: "🟡 Bạn đã có đơn chờ duyệt.", ephemeral: true });

        let gender = "Nam";
        if (interaction.customId.includes(":")) {
          gender = interaction.customId.split(":")[1];
        } else {
          try {
            const raw = (interaction.fields.getTextInputValue("gender") || "").trim();
            if (/^(nữ|nu|female|gái|girl|f)$/i.test(raw) || /nữ/i.test(raw) || /female/i.test(raw)) {
              gender = "Nữ";
            } else {
              gender = "Nam";
            }
          } catch { }
        }

        const fullName = interaction.fields.getTextInputValue("full_name").trim();
        const birthDate = interaction.fields.getTextInputValue("birth_date").trim();
        const social = interaction.fields.getTextInputValue("social_link").trim();
        const phone = interaction.fields.getTextInputValue("phone").trim();

        const guarantee = await query(
          `SELECT code FROM guarantee_uses
           WHERE receiver_discord_id = ?
           ORDER BY id DESC LIMIT 1`,
          [interaction.user.id]
        );
        const guaranteeCode = guarantee[0]?.code || null;

        const userRows = await query("SELECT * FROM users WHERE discord_id = ? LIMIT 1", [interaction.user.id]);
        const u = userRows[0] || {};

        const result = await execute(
          `INSERT INTO whitelist_applications
           (discord_id, discord_username, full_name, birth_date, gender, social_link, phone, guarantee_code, ip, geo_location, isp, device, fingerprint, cookie)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            interaction.user.id,
            interaction.user.username,
            fullName,
            birthDate,
            gender,
            social,
            phone || null,
            guaranteeCode,
            u.ip || null,
            u.geo_location || null,
            u.isp || null,
            u.device || null,
            u.fingerprint || null,
            u.cookie || null
          ]
        );

        await sendReview(result.insertId);
        return interaction.reply({ content: `✅ Đã gửi đơn **#${result.insertId}**. Vui lòng chờ Admin xét duyệt.`, ephemeral: true });
      }

      if (interaction.customId === "request_guarantee_modal") {
        const slotsRaw = interaction.fields.getTextInputValue("slots").trim();
        const slots = parseInt(slotsRaw, 10);
        if (isNaN(slots) || slots < 1 || slots > 20) {
          return interaction.reply({ content: "❌ Số lượng slot phải là một số từ 1 đến 20.", ephemeral: true });
        }

        const existing = await query(
          "SELECT * FROM guarantee_codes WHERE owner_discord_id=? AND status='active' AND used_slots < max_slots ORDER BY id DESC LIMIT 1",
          [interaction.user.id]
        );
        if (existing.length) {
          const c = existing[0];
          return interaction.reply({
            content: `⚠️ Bạn đang có 1 mã bảo lãnh hoạt động: **\`${c.code}\`** (Đã dùng: **${c.used_slots}/${c.max_slots}** slot).\nVui lòng dùng hết slot của mã trước khi tạo mã mới!`,
            ephemeral: true
          });
        }

        const code = randomGuaranteeCode("SW");
        await execute(
          "INSERT INTO guarantee_codes (code, owner_discord_id, max_slots, used_slots, status) VALUES (?, ?, ?, 0, 'active')",
          [code, interaction.user.id, slots]
        );

        const embed = new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle("✅ Khởi tạo mã bảo lãnh thành công!")
          .setDescription(
            `• **Mã của bạn:** \`${code}\` **(Số slot: ${slots})**\n` +
            `• **Lưu ý:** *Bạn hãy chỉ chọn số lượng slot dựa trên mong muốn của bản thân và sẽ chịu trách nhiệm nếu người được bảo lãnh làm sai luật ảnh hưởng đến server.*\n\n` +
            `Hãy sao chép mã này để gửi cho người mà bạn muốn bảo lãnh tham gia thành phố!`
          );

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (interaction.customId === "guarantee_modal") {
        const code = interaction.fields.getTextInputValue("code").trim().toUpperCase();
        let rawGender = "Nam";
        try {
          rawGender = interaction.fields.getTextInputValue("gender").trim();
        } catch { }

        const isFemale = /^(nữ|nu|female|gái)$/i.test(rawGender) || /nữ/i.test(rawGender);

        const guild = interaction.guild || await client.guilds.fetch(config.guildId);
        const member = interaction.member || await guild.members.fetch(interaction.user.id).catch(() => null);

        // Kiểm tra người nhập mã có role Whitelist hay không
        const hasWhitelistRole = config.whitelistRoleId && member?.roles?.cache?.has(config.whitelistRoleId);
        if (!hasWhitelistRole) {
          return interaction.reply({
            content: `❌ Bạn phải đang có role <@&${config.whitelistRoleId}> thì mới có thể sử dụng mã bảo lãnh!`,
            ephemeral: true
          });
        }

        const codes = await query(
          `SELECT * FROM guarantee_codes
           WHERE code=? AND status='active' AND used_slots < max_slots
             AND (expires_at IS NULL OR expires_at > NOW())`,
          [code]
        );
        if (!codes.length) {
          return interaction.reply({ content: "❌ Mã không tồn tại, đã hết slot hoặc đã bị khóa.", ephemeral: true });
        }

        const c = codes[0];

        if (c.owner_discord_id === interaction.user.id) {
          return interaction.reply({ content: "❌ Bạn không thể tự bảo lãnh cho chính mình.", ephemeral: true });
        }

        const duplicate = await query(
          "SELECT id FROM guarantee_uses WHERE code_id=? AND receiver_discord_id=?",
          [c.id, interaction.user.id]
        );
        if (duplicate.length) {
          return interaction.reply({ content: "❌ Bạn đã sử dụng mã bảo lãnh này rồi.", ephemeral: true });
        }

        const pending = await query(
          "SELECT id FROM whitelist_applications WHERE discord_id=? AND status='pending' LIMIT 1",
          [interaction.user.id]
        );
        if (pending.length) {
          return interaction.reply({ content: `🟡 Bạn đang có đơn #${pending[0].id} chờ duyệt.`, ephemeral: true });
        }

        // Tăng slot đã dùng
        await execute("UPDATE guarantee_codes SET used_slots=used_slots+1 WHERE id=? AND used_slots < max_slots", [c.id]);
        await execute(
          "INSERT INTO guarantee_uses (code_id, code, owner_discord_id, receiver_discord_id) VALUES (?, ?, ?, ?)",
          [c.id, c.code, c.owner_discord_id, interaction.user.id]
        );

        const userRows = await query("SELECT * FROM users WHERE discord_id = ? LIMIT 1", [interaction.user.id]);
        const u = userRows[0] || {};

        // Tạo đơn pending trong whitelist_applications để Admin duyệt
        const result = await execute(
          `INSERT INTO whitelist_applications
           (discord_id, discord_username, full_name, birth_date, gender, social_link, phone, guarantee_code, ip, geo_location, isp, device, fingerprint, cookie, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [
            interaction.user.id,
            interaction.user.username,
            interaction.member?.displayName || interaction.user.username,
            "N/A",
            isFemale ? "Nữ" : "Nam",
            null,
            `Bảo lãnh bởi <@${c.owner_discord_id}>`,
            c.code,
            u.ip || null,
            u.geo_location || null,
            u.isp || null,
            u.device || "Windows (Chrome)",
            u.fingerprint || null,
            u.cookie || null
          ]
        );

        // Gửi đơn sang kênh WHITELIST_REVIEW_CHANNEL để Admin duyệt
        await sendReview(result.insertId);

        return interaction.reply({
          content: `✅ Đã gửi đơn duyệt Whitelist qua mã bảo lãnh **${c.code}** lên Admin! Vui lòng chờ xét duyệt.`,
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith("reject_modal:")) {
        return handleRejectModal(interaction, interaction.customId.split(":")[1]);
      }

      if (interaction.customId.startsWith("block_modal:")) {
        return handleBlockModal(interaction, interaction.customId.split(":")[1]);
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ Có lỗi xảy ra. Hãy kiểm tra console của bot.", ephemeral: true }).catch(() => { });
    }
  }
});

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (!config.checkWhitelistChannelId || message.channel.id !== config.checkWhitelistChannelId) return;

    const apps = await query(
      "SELECT status FROM whitelist_applications WHERE discord_id = ? ORDER BY id DESC LIMIT 1",
      [message.author.id]
    );
    const players = await query(
      "SELECT status FROM whitelist_players WHERE discord_id = ? AND status = 'active' LIMIT 1",
      [message.author.id]
    );

    let wlMention = null;
    if (config.whitelistChannelId && message.guild?.channels?.cache?.has(config.whitelistChannelId)) {
      wlMention = `<#${config.whitelistChannelId}>`;
    } else if (message.guild?.channels?.cache) {
      const ch = message.guild.channels.cache.find(c => c.name?.toLowerCase().includes("whitelist") || c.name?.toLowerCase().includes("dang-ky"));
      if (ch) wlMention = `<#${ch.id}>`;
    }
    const whitelistChannelMention = wlMention || "`#đăng-ký-whitelist`";

    if (apps.length === 0 && players.length === 0) {
      await message.reply({
        content: `👋 Chào bạn ${message.author}!\n\n> ❌ Hệ thống **không tìm thấy đơn đăng ký** Whitelist của bạn.\n> 👉 Vui lòng di chuyển sang link này để đăng ký nhé:\n> ${whitelistChannelMention}`
      });
    } else {
      let statusText = "Chờ duyệt";
      if (players.length > 0 || apps[0]?.status === "approved") {
        statusText = "Đã duyệt";
      } else if (apps[0]?.status === "rejected") {
        statusText = "Từ chối";
      } else if (apps[0]?.status === "blocked") {
        statusText = "Bị khóa";
      }

      await message.reply({
        content: `👋 Chào bạn ${message.author}!\n\n> 🔍 Hệ thống thấy bạn **đã gửi đơn Whitelist rồi** (Trạng thái: **${statusText}**).\n> ⏳ Vui lòng kiên nhẫn đợi Admin kiểm tra và duyệt sớm nhé!`
      });
    }
  } catch (error) {
    console.error("Lỗi khi xử lý messageCreate check whitelist:", error);
  }
});

client.login(config.token);

