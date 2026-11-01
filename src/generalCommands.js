const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
} = require("discord.js");
const config = require("./config");
const { query, execute } = require("./db");

/**
 * Làm mới và lấy Access Token OAuth2 hợp lệ của người dùng
 */
async function getValidAccessToken(userRow) {
  if (!userRow.access_token && !userRow.refresh_token) return null;

  const isExpired = !userRow.token_expires_at || new Date(userRow.token_expires_at).getTime() < Date.now() + 60 * 1000;
  if (!isExpired && userRow.access_token) {
    return userRow.access_token;
  }

  if (!userRow.refresh_token) {
    return userRow.access_token;
  }

  try {
    const params = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: userRow.refresh_token
    });

    const res = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });

    if (!res.ok) {
      console.error(`Không thể làm mới token cho ${userRow.discord_id}:`, await res.text());
      return null;
    }

    const data = await res.json();
    const newExpiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null;

    await execute(
      "UPDATE users SET access_token = ?, refresh_token = ?, token_expires_at = ?, oauth_scope = ? WHERE discord_id = ?",
      [data.access_token, data.refresh_token || userRow.refresh_token, newExpiresAt, data.scope || userRow.oauth_scope, userRow.discord_id]
    ).catch(() => null);

    return data.access_token;
  } catch (err) {
    console.error(`Lỗi refresh token ${userRow.discord_id}:`, err.message);
    return null;
  }
}

/**
 * Gửi thông báo Log quản trị vào kênh LOG_CHANNEL_ID
 */
async function sendModLog(guild, { title, color = 0x5865f2, fields = [] }) {
  if (!config.logChannelId) return;
  try {
    const channel = guild.channels.cache.get(config.logChannelId)
      || await guild.channels.fetch(config.logChannelId).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .addFields(fields)
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => null);
  } catch (err) {
    console.error("Lỗi khi gửi mod log:", err.message);
  }
}

/**
 * Danh sách định nghĩa các Slash Command cơ bản
 */
const generalCommandBuilders = [
  // 1. /clear
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Xóa tin nhắn hàng loạt trong kênh")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(opt =>
      opt
        .setName("amount")
        .setDescription("Số lượng tin nhắn cần xóa (1 - 100)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .addUserOption(opt =>
      opt
        .setName("user")
        .setDescription("Chỉ xóa tin nhắn của thành viên này (tùy chọn)")
        .setRequired(false)
    ),

  // 2. /kick
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Trục xuất một thành viên khỏi server")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(opt =>
      opt
        .setName("user")
        .setDescription("Thành viên cần trục xuất")
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName("reason")
        .setDescription("Lý do trục xuất")
        .setRequired(false)
        .setMaxLength(500)
    ),

  // 3. /ban
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Cấm một thành viên khỏi server")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(opt =>
      opt
        .setName("user")
        .setDescription("Thành viên cần cấm")
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName("reason")
        .setDescription("Lý do cấm")
        .setRequired(false)
        .setMaxLength(500)
    )
    .addIntegerOption(opt =>
      opt
        .setName("delete_days")
        .setDescription("Xóa tin nhắn của người này trong vòng bao nhiêu ngày?")
        .setRequired(false)
        .addChoices(
          { name: "Không xóa tin nhắn", value: 0 },
          { name: "1 ngày trước", value: 1 },
          { name: "7 ngày trước", value: 7 }
        )
    ),

  // 4. /unban
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Gỡ cấm một người dùng khỏi server bằng ID")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(opt =>
      opt
        .setName("user_id")
        .setDescription("Discord ID của người dùng cần gỡ ban")
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName("reason")
        .setDescription("Lý do gỡ ban")
        .setRequired(false)
    ),

  // 5. /timeout
  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Cách ly (mute/timeout) một thành viên")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(opt =>
      opt
        .setName("user")
        .setDescription("Thành viên cần cách ly")
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt
        .setName("duration")
        .setDescription("Thời gian cách ly")
        .setRequired(true)
        .addChoices(
          { name: "1 phút", value: 60 },
          { name: "5 phút", value: 300 },
          { name: "10 phút", value: 600 },
          { name: "1 giờ", value: 3600 },
          { name: "1 ngày", value: 86400 },
          { name: "1 tuần", value: 604800 }
        )
    )
    .addStringOption(opt =>
      opt
        .setName("reason")
        .setDescription("Lý do cách ly")
        .setRequired(false)
        .setMaxLength(500)
    ),

  // 6. /untimeout
  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Hủy cách ly (bỏ mute/timeout) cho thành viên")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(opt =>
      opt
        .setName("user")
        .setDescription("Thành viên cần gỡ cách ly")
        .setRequired(true)
    ),

  // 7. /userinfo
  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Xem thông tin chi tiết của một thành viên")
    .addUserOption(opt =>
      opt
        .setName("user")
        .setDescription("Thành viên cần xem (để trống nếu muốn xem của bạn)")
        .setRequired(false)
    ),

  // 8. /serverinfo
  new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Xem thông tin tổng quan của server"),

  // 9. /avatar
  new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Xem và tải ảnh đại diện của một thành viên")
    .addUserOption(opt =>
      opt
        .setName("user")
        .setDescription("Thành viên cần xem ảnh đại diện")
        .setRequired(false)
    ),

  // 10. /ping
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Kiểm tra độ trễ mạng và trạng thái kết nối của bot"),

  // 11. /botinfo
  new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription("Xem thông tin kỹ thuật, thời gian hoạt động và tài nguyên của bot"),

  // 12. /say
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Gửi thông báo hoặc phát ngôn qua bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(opt =>
      opt
        .setName("message")
        .setDescription("Nội dung tin nhắn")
        .setRequired(true)
    )
    .addChannelOption(opt =>
      opt
        .setName("channel")
        .setDescription("Kênh cần gửi đến (mặc định là kênh hiện tại)")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt
        .setName("as_embed")
        .setDescription("Gửi dưới dạng khung Embed đẹp mắt (mặc định: Không)")
        .setRequired(false)
    ),

  // 13. /poll
  new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Tạo cuộc bình chọn nhanh cho các thành viên trong server")
    .addStringOption(opt =>
      opt
        .setName("question")
        .setDescription("Câu hỏi bình chọn")
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName("options")
        .setDescription("Các lựa chọn (phân tách bằng dấu chấm phẩy ';' hoặc dấu '|')")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // 14. /join
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Kéo thành viên đã cấp quyền OAuth2 (guilds.join) vào server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(opt =>
      opt
        .setName("user")
        .setDescription("Thành viên cụ thể cần kéo vào server")
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt
        .setName("all")
        .setDescription("Kéo tất cả thành viên trong database vào server (True)")
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName("guild_id")
        .setDescription("ID server đích (để trống: server hiện tại, nhập 'archive': server lưu trữ)")
        .setRequired(false)
    )
];

const POLL_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

/**
 * Xử lý thực thi các Slash Command
 */
async function handleGeneralCommand(interaction) {
  const { commandName, guild, member, user, channel } = interaction;

  // ==========================================
  // 1. /clear
  // ==========================================
  if (commandName === "clear") {
    const amount = interaction.options.getInteger("amount");
    const targetUser = interaction.options.getUser("user");

    await interaction.deferReply({ ephemeral: true });

    try {
      const messages = await channel.messages.fetch({ limit: 100 });
      let messagesToDelete;

      if (targetUser) {
        messagesToDelete = messages.filter(m => m.author.id === targetUser.id).first(amount);
      } else {
        messagesToDelete = messages.first(amount);
      }

      if (!messagesToDelete || messagesToDelete.length === 0) {
        return interaction.editReply({
          content: "⚠️ Không tìm thấy tin nhắn phù hợp trong 100 tin nhắn gần nhất để xóa."
        });
      }

      const deleted = await channel.bulkDelete(messagesToDelete, true);

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle("🧹 Xóa Tin Nhắn Hoàn Tất")
        .setDescription(
          `• Đã xóa thành công: **${deleted.size}** tin nhắn.\n` +
          `• Kênh: <#${channel.id}>\n` +
          (targetUser ? `• Lọc theo người dùng: <@${targetUser.id}>\n` : "") +
          `• Người thực hiện: <@${user.id}>`
        );

      await interaction.editReply({ embeds: [embed] });

      sendModLog(guild, {
        title: "🧹 Tin Nhắn Bị Xóa Hàng Loạt (/clear)",
        color: 0xED4245,
        fields: [
          { name: "🛡️ Người thực hiện", value: `<@${user.id}>`, inline: true },
          { name: "📁 Kênh", value: `<#${channel.id}>`, inline: true },
          { name: "🔢 Số lượng", value: `${deleted.size} tin nhắn`, inline: true },
          { name: "🎯 Mục tiêu", value: targetUser ? `<@${targetUser.id}>` : "Tất cả", inline: true }
        ]
      });
    } catch (err) {
      console.error("Lỗi /clear:", err);
      return interaction.editReply({
        content: `❌ Lỗi khi xóa tin nhắn: ${err.message}. Lưu ý không thể xóa tin nhắn cũ hơn 14 ngày bằng bulk delete.`
      });
    }
    return;
  }

  // ==========================================
  // 2. /kick
  // ==========================================
  if (commandName === "kick") {
    const targetUser = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "Không nêu lý do.";

    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return interaction.reply({ content: "❌ Không tìm thấy thành viên này trong server.", ephemeral: true });
    }

    if (targetMember.id === guild.ownerId) {
      return interaction.reply({ content: "❌ Không thể kick Chủ sở hữu Server!", ephemeral: true });
    }

    if (targetMember.id === interaction.client.user.id) {
      return interaction.reply({ content: "❌ Bạn không thể tự kick Bot bằng lệnh này!", ephemeral: true });
    }

    if (targetMember.roles.highest.position >= member.roles.highest.position && member.id !== guild.ownerId) {
      return interaction.reply({
        content: "❌ Bạn không thể kick thành viên có role cao hơn hoặc ngang bằng bạn!",
        ephemeral: true
      });
    }

    if (!targetMember.kickable) {
      return interaction.reply({
        content: "❌ Bot không đủ quyền hạn để kick thành viên này (role của bot thấp hơn role của họ).",
        ephemeral: true
      });
    }

    await interaction.deferReply();

    // Gửi tin nhắn riêng trước khi kick
    await targetMember.send({
      content: `⚠️ Bạn đã bị trục xuất (**kick**) khỏi server **${guild.name}**.\n• **Lý do:** ${reason}\n• **Người thực hiện:** ${user.tag}`
    }).catch(() => null);

    try {
      await targetMember.kick(`${user.tag}: ${reason}`);

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle("👢 Đã Trục Xuất Thành Viên")
        .setDescription(
          `• **Thành viên:** <@${targetUser.id}> (${targetUser.tag})\n` +
          `• **Lý do:** ${reason}\n` +
          `• **Người thực hiện:** <@${user.id}>`
        )
        .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      sendModLog(guild, {
        title: "👢 Thành Viên Bị Trục Xuất (/kick)",
        color: 0xE67E22,
        fields: [
          { name: "👤 Người bị kick", value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
          { name: "🛡️ Người thực hiện", value: `<@${user.id}>`, inline: true },
          { name: "📝 Lý do", value: reason, inline: false }
        ]
      });
    } catch (err) {
      console.error("Lỗi /kick:", err);
      return interaction.editReply({ content: `❌ Thao tác kick thất bại: ${err.message}` });
    }
    return;
  }

  // ==========================================
  // 3. /ban
  // ==========================================
  if (commandName === "ban") {
    const targetUser = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "Không nêu lý do.";
    const deleteDays = interaction.options.getInteger("delete_days") || 0;

    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

    if (targetMember) {
      if (targetMember.id === guild.ownerId) {
        return interaction.reply({ content: "❌ Không thể cấm Chủ sở hữu Server!", ephemeral: true });
      }
      if (targetMember.id === interaction.client.user.id) {
        return interaction.reply({ content: "❌ Bạn không thể tự ban Bot bằng lệnh này!", ephemeral: true });
      }
      if (targetMember.roles.highest.position >= member.roles.highest.position && member.id !== guild.ownerId) {
        return interaction.reply({
          content: "❌ Bạn không thể cấm thành viên có role cao hơn hoặc ngang bằng bạn!",
          ephemeral: true
        });
      }
      if (!targetMember.bannable) {
        return interaction.reply({
          content: "❌ Bot không đủ quyền hạn để ban thành viên này (role của bot thấp hơn role của họ).",
          ephemeral: true
        });
      }
    }

    await interaction.deferReply();

    // Gửi tin nhắn DM nếu có thể
    if (targetMember) {
      await targetMember.send({
        content: `⛔ Bạn đã bị **CẤM (BAN)** vĩnh viễn khỏi server **${guild.name}**.\n• **Lý do:** ${reason}\n• **Người thực hiện:** ${user.tag}`
      }).catch(() => null);
    }

    try {
      await guild.bans.create(targetUser.id, {
        reason: `${user.tag}: ${reason}`,
        deleteMessageSeconds: deleteDays * 86400
      });

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle("⛔ Đã Cấm Thành Viên (Ban)")
        .setDescription(
          `• **Thành viên:** <@${targetUser.id}> (${targetUser.tag})\n` +
          `• **Lý do:** ${reason}\n` +
          `• **Xóa tin nhắn:** ${deleteDays > 0 ? `${deleteDays} ngày qua` : "Không xóa"}\n` +
          `• **Người thực hiện:** <@${user.id}>`
        )
        .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      sendModLog(guild, {
        title: "⛔ Thành Viên Bị Cấm (/ban)",
        color: 0xED4245,
        fields: [
          { name: "👤 Người bị ban", value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
          { name: "🛡️ Người thực hiện", value: `<@${user.id}>`, inline: true },
          { name: "📝 Lý do", value: reason, inline: false }
        ]
      });
    } catch (err) {
      console.error("Lỗi /ban:", err);
      return interaction.editReply({ content: `❌ Thao tác ban thất bại: ${err.message}` });
    }
    return;
  }

  // ==========================================
  // 4. /unban
  // ==========================================
  if (commandName === "unban") {
    const userId = interaction.options.getString("user_id").trim();
    const reason = interaction.options.getString("reason") || "Gỡ cấm bởi BQT";

    await interaction.deferReply();

    try {
      const banInfo = await guild.bans.fetch(userId).catch(() => null);
      if (!banInfo) {
        return interaction.editReply({ content: `❌ Người dùng có ID \`${userId}\` hiện không nằm trong danh sách cấm của server.` });
      }

      await guild.bans.remove(userId, `${user.tag}: ${reason}`);

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle("🔓 Đã Gỡ Cấm (Unban)")
        .setDescription(
          `• **Người dùng:** ${banInfo.user.tag} (\`${userId}\`)\n` +
          `• **Lý do:** ${reason}\n` +
          `• **Người thực hiện:** <@${user.id}>`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      sendModLog(guild, {
        title: "🔓 Thành Viên Được Gỡ Cấm (/unban)",
        color: 0x57F287,
        fields: [
          { name: "👤 Người được unban", value: `${banInfo.user.tag} (\`${userId}\`)`, inline: true },
          { name: "🛡️ Người thực hiện", value: `<@${user.id}>`, inline: true },
          { name: "📝 Lý do", value: reason, inline: false }
        ]
      });
    } catch (err) {
      console.error("Lỗi /unban:", err);
      return interaction.editReply({ content: `❌ Gỡ cấm thất bại: ${err.message}` });
    }
    return;
  }

  // ==========================================
  // 5. /timeout
  // ==========================================
  if (commandName === "timeout") {
    const targetUser = interaction.options.getUser("user");
    const seconds = interaction.options.getInteger("duration");
    const reason = interaction.options.getString("reason") || "Không nêu lý do.";

    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return interaction.reply({ content: "❌ Không tìm thấy thành viên này trong server.", ephemeral: true });
    }

    if (targetMember.id === guild.ownerId) {
      return interaction.reply({ content: "❌ Không thể timeout Chủ sở hữu Server!", ephemeral: true });
    }

    if (targetMember.roles.highest.position >= member.roles.highest.position && member.id !== guild.ownerId) {
      return interaction.reply({
        content: "❌ Bạn không thể timeout thành viên có role cao hơn hoặc ngang bằng bạn!",
        ephemeral: true
      });
    }

    if (!targetMember.moderatable) {
      return interaction.reply({
        content: "❌ Bot không đủ quyền hạn để timeout thành viên này.",
        ephemeral: true
      });
    }

    await interaction.deferReply();

    try {
      await targetMember.timeout(seconds * 1000, `${user.tag}: ${reason}`);

      const expireTimestamp = Math.floor((Date.now() + seconds * 1000) / 1000);

      const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle("⏳ Đã Cách Ly Thành Viên (Timeout)")
        .setDescription(
          `• **Thành viên:** <@${targetUser.id}>\n` +
          `• **Thời hạn:** <t:${expireTimestamp}:R> (kết thúc lúc <t:${expireTimestamp}:F>)\n` +
          `• **Lý do:** ${reason}\n` +
          `• **Người thực hiện:** <@${user.id}>`
        )
        .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      sendModLog(guild, {
        title: "⏳ Thành Viên Bị Cách Ly (/timeout)",
        color: 0xFEE75C,
        fields: [
          { name: "👤 Người bị timeout", value: `<@${targetUser.id}> (${targetUser.tag})`, inline: true },
          { name: "🛡️ Người thực hiện", value: `<@${user.id}>`, inline: true },
          { name: "⏱️ Hết hạn", value: `<t:${expireTimestamp}:R>`, inline: true },
          { name: "📝 Lý do", value: reason, inline: false }
        ]
      });
    } catch (err) {
      console.error("Lỗi /timeout:", err);
      return interaction.editReply({ content: `❌ Thao tác timeout thất bại: ${err.message}` });
    }
    return;
  }

  // ==========================================
  // 6. /untimeout
  // ==========================================
  if (commandName === "untimeout") {
    const targetUser = interaction.options.getUser("user");
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

    if (!targetMember) {
      return interaction.reply({ content: "❌ Không tìm thấy thành viên này trong server.", ephemeral: true });
    }

    if (!targetMember.isCommunicationDisabled()) {
      return interaction.reply({ content: `⚠️ Thành viên <@${targetUser.id}> hiện không bị timeout.`, ephemeral: true });
    }

    await interaction.deferReply();

    try {
      await targetMember.timeout(null, `Gỡ timeout bởi ${user.tag}`);

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle("🔊 Đã Gỡ Cách Ly (Untimeout)")
        .setDescription(
          `• **Thành viên:** <@${targetUser.id}>\n` +
          `• **Trạng thái:** Đã khôi phục quyền trò chuyện\n` +
          `• **Người thực hiện:** <@${user.id}>`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      sendModLog(guild, {
        title: "🔊 Thành Viên Được Gỡ Cách Ly (/untimeout)",
        color: 0x57F287,
        fields: [
          { name: "👤 Thành viên", value: `<@${targetUser.id}>`, inline: true },
          { name: "🛡️ Người thực hiện", value: `<@${user.id}>`, inline: true }
        ]
      });
    } catch (err) {
      console.error("Lỗi /untimeout:", err);
      return interaction.editReply({ content: `❌ Gỡ timeout thất bại: ${err.message}` });
    }
    return;
  }

  // ==========================================
  // 7. /userinfo
  // ==========================================
  if (commandName === "userinfo") {
    const targetUser = interaction.options.getUser("user") || user;
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

    const createdUnix = Math.floor(targetUser.createdTimestamp / 1000);
    const joinedUnix = targetMember ? Math.floor(targetMember.joinedTimestamp / 1000) : null;

    const roles = targetMember
      ? targetMember.roles.cache
          .filter(r => r.id !== guild.id)
          .sort((a, b) => b.position - a.position)
          .map(r => `<@&${r.id}>`)
      : [];

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(`👤 Thông Tin Thành Viên: ${targetUser.tag}`)
      .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "🆔 Discord ID", value: `\`${targetUser.id}\``, inline: true },
        { name: "🤖 Loại tài khoản", value: targetUser.bot ? "Bot" : "Người dùng", inline: true },
        { name: "⭐ Biệt danh (Nickname)", value: targetMember?.nickname || "Không có", inline: true },
        { name: "📅 Ngày tạo tài khoản", value: `<t:${createdUnix}:F> (<t:${createdUnix}:R>)`, inline: false },
        { name: "📥 Ngày gia nhập server", value: joinedUnix ? `<t:${joinedUnix}:F> (<t:${joinedUnix}:R>)` : "Không có dữ liệu", inline: false },
        { name: `🎭 Vai trò (${roles.length})`, value: roles.length > 0 ? (roles.length > 15 ? `${roles.slice(0, 15).join(" ")} ... (+${roles.length - 15} role)` : roles.join(" ")) : "Không có role nào", inline: false }
      )
      .setFooter({ text: `${config.serverName} • Yêu cầu bởi ${user.tag}` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ==========================================
  // 8. /serverinfo
  // ==========================================
  if (commandName === "serverinfo") {
    const owner = await guild.fetchOwner().catch(() => null);
    const channels = guild.channels.cache;
    const textChannels = channels.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement).size;
    const voiceChannels = channels.filter(c => c.type === ChannelType.GuildVoice).size;
    const categories = channels.filter(c => c.type === ChannelType.GuildCategory).size;

    const createdUnix = Math.floor(guild.createdTimestamp / 1000);
    const members = guild.members.cache;
    const botCount = members.filter(m => m.user.bot).size;
    const humanCount = guild.memberCount - botCount;

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(`🏰 Thông Tin Máy Chủ: ${guild.name}`)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: "🆔 Server ID", value: `\`${guild.id}\``, inline: true },
        { name: "👑 Chủ sở hữu (Owner)", value: owner ? `<@${owner.id}> (${owner.user.tag})` : "Không rõ", inline: true },
        { name: "📅 Ngày thành lập", value: `<t:${createdUnix}:F> (<t:${createdUnix}:R>)`, inline: false },
        {
          name: `👥 Thành viên (${guild.memberCount})`,
          value: `• Người thật: **${humanCount}**\n• Bot: **${botCount}**`,
          inline: true
        },
        {
          name: `📁 Kênh (${channels.size})`,
          value: `• Văn bản: **${textChannels}**\n• Thoại: **${voiceChannels}**\n• Danh mục: **${categories}**`,
          inline: true
        },
        {
          name: `🚀 Server Boost`,
          value: `• Cấp độ: **Level ${guild.premiumTier}**\n• Lượt Boost: **${guild.premiumSubscriptionCount || 0}** lượt`,
          inline: true
        }
      )
      .setFooter({ text: `${config.serverName} • Yêu cầu bởi ${user.tag}` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ==========================================
  // 9. /avatar
  // ==========================================
  if (commandName === "avatar") {
    const targetUser = interaction.options.getUser("user") || user;
    const avatarUrl = targetUser.displayAvatarURL({ size: 1024, dynamic: true });

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(`🖼️ Ảnh Đại Diện Của ${targetUser.tag}`)
      .setDescription(
        `[PNG](${targetUser.displayAvatarURL({ extension: "png", size: 1024 })}) | ` +
        `[JPG](${targetUser.displayAvatarURL({ extension: "jpg", size: 1024 })}) | ` +
        `[WEBP](${targetUser.displayAvatarURL({ extension: "webp", size: 1024 })})`
      )
      .setImage(avatarUrl)
      .setFooter({ text: `${config.serverName} • ID: ${targetUser.id}` });

    return interaction.reply({ embeds: [embed] });
  }

  // ==========================================
  // 10. /ping
  // ==========================================
  if (commandName === "ping") {
    const sent = await interaction.reply({ content: "🏓 Đang kiểm tra độ trễ...", fetchReply: true });
    const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
    const wsPing = interaction.client.ws.ping;

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle("🏓 Pong! Trạng Thái Kết Nối")
      .addFields(
        { name: "⚡ Độ trễ API (Roundtrip)", value: `\`${roundtrip}ms\``, inline: true },
        { name: "🌐 Độ trễ WebSocket", value: `\`${wsPing}ms\``, inline: true },
        { name: "🟢 Tình trạng", value: wsPing < 150 ? "Tuyệt vời (Rất mượt)" : (wsPing < 300 ? "Bình thường" : "Chậm / Lag"), inline: true }
      )
      .setTimestamp();

    return interaction.editReply({ content: null, embeds: [embed] });
  }

  // ==========================================
  // 11. /botinfo
  // ==========================================
  if (commandName === "botinfo") {
    const uptimeSec = Math.floor(process.uptime());
    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const seconds = uptimeSec % 60;
    const uptimeString = `${days > 0 ? `${days} ngày ` : ""}${hours} giờ ${minutes} phút ${seconds} giây`;

    const memUsageMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
    const totalMemMB = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(`🤖 Thông Tin Kỹ Thuật: ${interaction.client.user.username}`)
      .setThumbnail(interaction.client.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "🕒 Thời gian hoạt động (Uptime)", value: `\`${uptimeString}\``, inline: false },
        { name: "💾 Bộ nhớ RAM sử dụng", value: `\`${memUsageMB} MB\` (RSS: \`${totalMemMB} MB\`)`, inline: true },
        { name: "⚙️ Phiên bản Node.js", value: `\`${process.version}\``, inline: true },
        { name: "📦 Thư viện Discord.js", value: `\`v${require("discord.js").version}\``, inline: true },
        { name: "🏰 Máy chủ phục vụ", value: `\`${interaction.client.guilds.cache.size}\` server`, inline: true },
        { name: "👥 Thành viên theo dõi", value: `\`${guild.memberCount}\` thành viên`, inline: true },
        { name: "🟢 Trạng thái hệ thống", value: "Hoạt động bình thường (Online)", inline: true }
      )
      .setFooter({ text: `${config.serverName} System` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ==========================================
  // 12. /say
  // ==========================================
  if (commandName === "say") {
    const messageContent = interaction.options.getString("message");
    const targetChannel = interaction.options.getChannel("channel") || channel;
    const asEmbed = interaction.options.getBoolean("as_embed") || false;

    try {
      if (asEmbed) {
        const embed = new EmbedBuilder()
          .setColor(0x2b2d31)
          .setDescription(messageContent)
          .setFooter({ text: `${config.serverName} Thông Báo` })
          .setTimestamp();

        await targetChannel.send({ embeds: [embed] });
      } else {
        await targetChannel.send({ content: messageContent });
      }

      await interaction.reply({
        content: `✅ Đã gửi thông báo thành công đến <#${targetChannel.id}>!`,
        ephemeral: true
      });

      sendModLog(guild, {
        title: "📢 Lệnh Phát Ngôn /say",
        color: 0x5865f2,
        fields: [
          { name: "🛡️ Người gửi", value: `<@${user.id}> (${user.tag})`, inline: true },
          { name: "📁 Kênh", value: `<#${targetChannel.id}>`, inline: true },
          { name: "📝 Nội dung", value: messageContent.slice(0, 1024), inline: false }
        ]
      });
    } catch (err) {
      console.error("Lỗi /say:", err);
      return interaction.reply({
        content: `❌ Không thể gửi tin nhắn đến kênh đó: ${err.message}`,
        ephemeral: true
      });
    }
    return;
  }

  // ==========================================
  // 13. /poll
  // ==========================================
  if (commandName === "poll") {
    if (!member.permissions.has(PermissionFlagsBits.Administrator) && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "❌ Bạn cần có quyền **Administrator** hoặc **Manage Server** để sử dụng lệnh này.",
        ephemeral: true
      });
    }

    const question = interaction.options.getString("question");
    const rawOptions = interaction.options.getString("options");

    // Tách các lựa chọn bằng ; hoặc |
    const options = rawOptions
      .split(/[;|]/)
      .map(o => o.trim())
      .filter(o => o.length > 0);

    if (options.length < 2) {
      return interaction.reply({
        content: "❌ Cuộc bình chọn cần có ít nhất **2 lựa chọn** (phân tách bằng dấu chấm phẩy `;` hoặc dấu gạch `|`).\n*Ví dụ:* `/poll question: Tối nay đi đâu? options: Đi bơi ; Đi bar ; Ở nhà`",
        ephemeral: true
      });
    }

    if (options.length > 10) {
      return interaction.reply({
        content: "❌ Cuộc bình chọn hỗ trợ tối đa **10 lựa chọn**.",
        ephemeral: true
      });
    }

    const optionsDescription = options
      .map((opt, idx) => `${POLL_EMOJIS[idx]} **${opt}**`)
      .join("\n\n");

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📊 BÌNH CHỌN: ${question}`)
      .setDescription(
        `${optionsDescription}\n\n` +
        `───────────────────────────────\n` +
        `*Bấm vào các biểu tượng cảm xúc bên dưới để tham gia bỏ phiếu!*`
      )
      .setFooter({ text: `Tạo bởi ${user.tag} • ${config.serverName}` })
      .setTimestamp();

    const pollMessage = await interaction.reply({ embeds: [embed], fetchReply: true });

    for (let i = 0; i < options.length; i++) {
      await pollMessage.react(POLL_EMOJIS[i]).catch(() => null);
    }
    return;
  }

  // ==========================================
  // 14. /join
  // ==========================================
  if (commandName === "join") {
    if (!member.permissions.has(PermissionFlagsBits.Administrator) && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "❌ Bạn cần có quyền **Administrator** hoặc **Manage Server** để sử dụng lệnh này.",
        ephemeral: true
      });
    }

    const targetUser = interaction.options.getUser("user");
    const pullAll = interaction.options.getBoolean("all");
    const customGuildId = interaction.options.getString("guild_id")?.trim();

    if (!targetUser && !pullAll) {
      return interaction.reply({
        content:
          "⚠️ **Vui lòng chọn cách thức thực hiện lệnh /join:**\n" +
          "• `/join user: @member` — Kéo 1 thành viên cụ thể đã xác thực vào server.\n" +
          "• `/join all: True` — Kéo tất cả thành viên trong database vào server.\n" +
          "*(Mẹo: Bạn có thể nhập thêm `guild_id: <ID>` hoặc `guild_id: archive` để kéo vào server đích khác)*",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const targetGuildId = (customGuildId?.toLowerCase() === "archive" ? config.archiveGuildId : customGuildId) || guild.id;
    let targetGuild = interaction.client.guilds.cache.get(targetGuildId);
    if (!targetGuild) {
      try {
        targetGuild = await interaction.client.guilds.fetch(targetGuildId);
      } catch {
        targetGuild = null;
      }
    }

    if (!targetGuild) {
      return interaction.editReply({
        content: `❌ Bot không tìm thấy hoặc không có mặt trong server có ID \`${targetGuildId}\`.\nVui lòng kiểm tra lại ID server hoặc mời bot vào server đó trước!`
      });
    }

    // Kiểm tra quyền bot trong server đích
    const botMember = targetGuild.members.me || await targetGuild.members.fetchMe().catch(() => null);
    if (botMember && !botMember.permissions.has(PermissionFlagsBits.CreateInstantInvite)) {
      return interaction.editReply({
        content: `❌ Bot không có quyền **Tạo lời mời** (Create Instant Invite) trên server **${targetGuild.name}** (\`${targetGuild.id}\`). Vui lòng cấp quyền này cho bot trong Server Settings!`
      });
    }

    const putMember = async (userId, token) => {
      try {
        const res = await fetch(`https://discord.com/api/v10/guilds/${targetGuildId}/members/${userId}`, {
          method: "PUT",
          headers: {
            "Authorization": `Bot ${config.token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ access_token: token })
        });
        return res;
      } catch (err) {
        return { status: 500, statusText: err.message };
      }
    };

    // Trường hợp 1: Kéo 1 user cụ thể
    if (targetUser && !pullAll) {
      const userRows = await query(
        "SELECT * FROM users WHERE discord_id = ? LIMIT 1",
        [targetUser.id]
      );

      if (!userRows || userRows.length === 0 || (!userRows[0].access_token && !userRows[0].refresh_token)) {
        return interaction.editReply({
          content: `❌ Người dùng <@${targetUser.id}> (**${targetUser.tag}**) chưa xác thực OAuth2 hoặc chưa cấp quyền \`guilds.join\` cho bot.`
        });
      }

      const validToken = await getValidAccessToken(userRows[0]);
      if (!validToken) {
        return interaction.editReply({
          content: `❌ Không thể lấy hoặc làm mới OAuth Token cho <@${targetUser.id}> (token có thể đã bị người dùng thu hồi trong Discord Settings).`
        });
      }

      const res = await putMember(targetUser.id, validToken);

      if (res.status === 201) {
        const embed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("🎉 Kéo Thành Viên Thành Công")
          .setDescription(`Đã kéo thành viên <@${targetUser.id}> (**${targetUser.tag}**) vào server **${targetGuild.name}** thành công!`)
          .addFields(
            { name: "🏰 Server đích", value: `\`${targetGuild.name}\` (\`${targetGuild.id}\`)`, inline: true },
            { name: "🛡️ Quản trị viên", value: `<@${user.id}>`, inline: true }
          )
          .setFooter({ text: `${config.serverName} OAuth2 System` })
          .setTimestamp();

        sendModLog(guild, {
          title: "📥 Kéo Thành Viên (/join)",
          color: 0x57f287,
          fields: [
            { name: "🛡️ Người thực hiện", value: `<@${user.id}> (${user.tag})`, inline: true },
            { name: "👤 Thành viên", value: `<@${targetUser.id}> (${targetUser.tag})`, inline: true },
            { name: "🏰 Server đích", value: `${targetGuild.name} (\`${targetGuild.id}\`)`, inline: true }
          ]
        });

        return interaction.editReply({ embeds: [embed] });
      } else if (res.status === 204) {
        return interaction.editReply({
          content: `ℹ️ Thành viên <@${targetUser.id}> (**${targetUser.tag}**) **đã có mặt** trong server **${targetGuild.name}** từ trước.`
        });
      } else if (res.status === 400) {
        return interaction.editReply({
          content: `❌ Không thể thêm <@${targetUser.id}>: Tài khoản này đã đạt giới hạn tối đa 100/200 server hoặc token không hợp lệ.`
        });
      } else if (res.status === 403) {
        return interaction.editReply({
          content: `❌ Bot thiếu quyền **Tạo lời mời** (Create Instant Invite) trên server **${targetGuild.name}**.`
        });
      } else {
        const errBody = await res.text().catch(() => "");
        return interaction.editReply({
          content: `❌ Lỗi khi thêm thành viên (HTTP ${res.status}): ${errBody || res.statusText}`
        });
      }
    }

    // Trường hợp 2: Kéo toàn bộ database (all: true)
    if (pullAll) {
      const allUsers = await query(
        "SELECT * FROM users WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL"
      );

      if (!allUsers || allUsers.length === 0) {
        return interaction.editReply({
          content: "⚠️ Không tìm thấy tài khoản nào có dữ liệu OAuth2 trong cơ sở dữ liệu."
        });
      }

      let added = 0;
      let alreadyIn = 0;
      let failed = 0;
      const total = allUsers.length;

      const progressEmbed = (current) =>
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("🔄 Đang Kéo Thành Viên Vào Server...")
          .setDescription(
            `Đang xử lý kéo thành viên vào **${targetGuild.name}** (\`${targetGuild.id}\`)\n\n` +
            `• Tiến độ: **${current}/${total}** tài khoản\n` +
            `• ✅ Đã thêm mới: **${added}**\n` +
            `• ℹ️ Đã có sẵn: **${alreadyIn}**\n` +
            `• ❌ Thất bại / Hết hạn: **${failed}**`
          )
          .setFooter({ text: "Hệ thống đang gửi yêu cầu với khoảng nghỉ để bảo vệ Rate Limit..." })
          .setTimestamp();

      await interaction.editReply({ embeds: [progressEmbed(0)] });

      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      let lastEditTime = Date.now();

      for (let i = 0; i < total; i++) {
        const u = allUsers[i];
        try {
          const token = await getValidAccessToken(u);
          if (!token) {
            failed++;
          } else {
            let res = await putMember(u.discord_id, token);

            if (res.status === 429) {
              const rateData = await res.json().catch(() => ({}));
              const waitSec = Math.ceil(rateData.retry_after || 5);
              await sleep(waitSec * 1000);
              res = await putMember(u.discord_id, token);
            }

            if (res.status === 201) {
              added++;
            } else if (res.status === 204) {
              alreadyIn++;
            } else {
              failed++;
            }
          }
        } catch {
          failed++;
        }

        // Cập nhật Embed tiến độ mỗi 5 người hoặc sau mỗi 3 giây
        const now = Date.now();
        if ((i + 1) % 5 === 0 || i === total - 1 || now - lastEditTime > 3000) {
          lastEditTime = now;
          await interaction.editReply({ embeds: [progressEmbed(i + 1)] }).catch(() => null);
        }

        // Tạm dừng 800ms giữa mỗi user để tránh spam Discord API
        await sleep(800);
      }

      const summaryEmbed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("🎉 Hoàn Tất Kéo Thành Viên")
        .setDescription(`Đã hoàn tất quá trình kéo thành viên vào server **${targetGuild.name}**!`)
        .addFields(
          { name: "🏰 Server đích", value: `\`${targetGuild.name}\` (${targetGuild.id})`, inline: true },
          { name: "👥 Tổng tài khoản duyệt", value: `\`${total}\` người dùng`, inline: true },
          { name: "🛡️ Quản trị viên", value: `<@${user.id}>`, inline: true },
          { name: "✅ Đã thêm mới", value: `**${added}** thành viên`, inline: true },
          { name: "ℹ️ Đã có sẵn trong server", value: `**${alreadyIn}** thành viên`, inline: true },
          { name: "❌ Thất bại / Hết hạn token", value: `**${failed}** thành viên`, inline: true }
        )
        .setFooter({ text: `${config.serverName} OAuth2 Restore System` })
        .setTimestamp();

      await interaction.editReply({ embeds: [summaryEmbed] });

      sendModLog(guild, {
        title: "📥 Kéo Hàng Loạt Thành Viên (/join all)",
        color: 0x5865f2,
        fields: [
          { name: "🛡️ Người thực hiện", value: `<@${user.id}> (${user.tag})`, inline: true },
          { name: "🏰 Server đích", value: `${targetGuild.name} (\`${targetGuild.id}\`)`, inline: true },
          { name: "📊 Kết quả", value: `Tổng: ${total} | Thêm mới: ${added} | Đã có sẵn: ${alreadyIn} | Lỗi: ${failed}`, inline: false }
        ]
      });
      return;
    }
  }
}

module.exports = {
  generalCommandBuilders,
  handleGeneralCommand,
  getValidAccessToken
};
