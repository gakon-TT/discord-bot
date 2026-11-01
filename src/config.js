require("dotenv").config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

module.exports = {
  token: required("DISCORD_TOKEN"),
  clientId: required("CLIENT_ID"),
  clientSecret: required("CLIENT_SECRET"),
  guildId: required("GUILD_ID"),
  reviewChannelId: required("WHITELIST_REVIEW_CHANNEL_ID"),
  logChannelId: process.env.LOG_CHANNEL_ID || "",
  verifiedRoleId: process.env.VERIFIED_ROLE_ID || "",
  memberRoleId: process.env.MEMBER_ROLE_ID || "1508651628599836703",
  whitelistRoleId: process.env.WHITELIST_ROLE_ID || "1551960590010810398",
  babyRoleId: process.env.BABY_ROLE_ID || "1551981933364383855",
  guaranteeRoleId: process.env.GUARANTEE_ROLE_ID || "1551990077335408650",
  autoRoleId: process.env.AUTO_ROLE_ID || "1551998559761735820",
  staffRoleId: process.env.STAFF_ROLE_ID || "",
  adminRoleId: process.env.ADMIN_ROLE_ID || process.env.STAFF_ROLE_ID || "",
  baseUrl: required("BASE_URL").replace(/\/$/, ""),
  oauthCallbackPath: process.env.OAUTH_CALLBACK_PATH || "/oauth/callback",
  port: Number(process.env.PORT || 3000),
  serverName: process.env.SERVER_NAME || "FiveM Server",
  guaranteeSlots: Number(process.env.GUARANTEE_SLOTS_PER_PLAYER || 1),
  panelImageUrl: process.env.PANEL_IMAGE_URL || "",
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID || "1503089696035573782",
  goodbyeChannelId: process.env.GOODBYE_CHANNEL_ID || "1553657504326615050",
  rulesChannelId: process.env.RULES_CHANNEL_ID || "",
  whitelistChannelId: process.env.WHITELIST_CHANNEL_ID || "1551243279490617385",
  checkWhitelistChannelId: process.env.CHECK_WHITELIST_CHANNEL_ID || "1552775242781564958",
  oauthScopes: process.env.OAUTH_SCOPES || "identify email guilds.join",
  policeManagerRoleId: process.env.POLICE_MANAGER_ROLE_ID || "",
  policeRoleId: process.env.POLICE_ROLE_ID || "",
  policeLogChannelId: process.env.POLICE_LOG_CHANNEL_ID || "",
  medicManagerRoleId: process.env.MEDIC_MANAGER_ROLE_ID || "",
  medicRoleId: process.env.MEDIC_ROLE_ID || "",
  medicLogChannelId: process.env.MEDIC_LOG_CHANNEL_ID || "",
  cardealerManagerRoleId: process.env.CARDEALER_MANAGER_ROLE_ID || "1553662004970127440",
  cardealerRoleId: process.env.CARDEALER_ROLE_ID || "1540617259897069696",
  cardealerLogChannelId: process.env.CARDEALER_LOG_CHANNEL_ID || "1553673688400924742",
  roleLogChannelId: process.env.ROLE_LOG_CHANNEL_ID || process.env.LOG_CHANNEL_ID || "",
  ticketLogChannelId: process.env.TICKET_LOG_CHANNEL_ID || process.env.LOG_CHANNEL_ID || "",
  ticketChannelId: process.env.TICKET_CHANNEL_ID || "",
  archiveGuildId: process.env.ARCHIVE_GUILD_ID || "1551999325226278912",
  db: {
    host: required("DB_HOST"),
    port: Number(process.env.DB_PORT || 3306),
    user: required("DB_USER"),
    password: process.env.DB_PASSWORD || "",
    database: required("DB_NAME")
  }
};
