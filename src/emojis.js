const { parseEmoji } = require("discord.js");
const emojisData = require("./emojis.json");

const EMOJIS = {
  // Existing core
  trash: emojisData.swag_trash || "🗑️",
  party: emojisData.swag_party || "🎉",
  verify: emojisData.swag_verify || "✅",
  rules: emojisData.swag_rules || "📜",
  crown: emojisData.swag_crown || "👑",
  ticket: emojisData.swag_ticket || "🎟️",
  police: emojisData.swag_police || "👮",
  medic: emojisData.swag_medic || "👨‍⚕️",
  wrench: emojisData.swag_wrench || "🔧",
  warning: emojisData.swag_warning || "⚠️",
  arrow: emojisData.swag_arrow || "👉",
  star: emojisData.swag_star || "⭐",
  loading: emojisData.swag_loading || "⏳",

  // New specialized emojis
  num1: emojisData.swag_num1 || "1️⃣",
  num2: emojisData.swag_num2 || "2️⃣",
  num3: emojisData.swag_num3 || "3️⃣",
  clipboard: emojisData.swag_clipboard || "📋",
  discord: emojisData.swag_discord || "🔗",
  male: emojisData.swag_male || "👨",
  female: emojisData.swag_female || "👩",
  key: emojisData.swag_key || "🔑",
  chart: emojisData.swag_chart || "📊",
  lock: emojisData.swag_lock || "🔒",
  unlock: emojisData.swag_unlock || "🔓",
  pin: emojisData.swag_pin || "📌",
  chat: emojisData.swag_chat || "💬",
  shop: emojisData.swag_shop || "🛒",
  gavel: emojisData.swag_gavel || "⚖️",
  siren: emojisData.swag_siren || "🚨",
  bug: emojisData.swag_bug || "🐛",
  briefcase: emojisData.swag_briefcase || "💼",
  airplane: emojisData.swag_airplane || "✈️",
  city: emojisData.swag_city || "🏙️",
  reject: emojisData.swag_reject || "❌",
  block: emojisData.swag_block || "⛔",
  bell: emojisData.swag_bell || "🔔",
  heart: emojisData.swag_heart || "💖",

  // Social & Platform logos
  facebook: emojisData.swag_facebook || "🌐",
  spotify: emojisData.swag_spotify || "🎧",
  steam: emojisData.swag_steam || "🎮",
  youtube: emojisData.swag_youtube || "▶️",
  twitch: emojisData.swag_twitch || "👾",
  twitter: emojisData.swag_twitter || "🐦",
  tiktok: emojisData.swag_tiktok || "🎵",
  github: emojisData.swag_github || "💻",
  reddit: emojisData.swag_reddit || "🤖",
  riotgames: emojisData.swag_riotgames || "⚔️",
  battlenet: emojisData.swag_battlenet || "🔷",
  epicgames: emojisData.swag_epicgames || "⬛",

  raw: emojisData,
  parse(emojiStr) {
    if (!emojiStr) return undefined;
    return parseEmoji(emojiStr) || emojiStr;
  }
};

module.exports = EMOJIS;
