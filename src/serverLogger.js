const { EmbedBuilder, AuditLogEvent, ChannelType } = require("discord.js");
const config = require("./config");
const EMOJIS = require("./emojis");
const { formatVietnameseDate } = require("./utils");
const { isRecentBotNicknameChange } = require("./autoNickname");

/**
 * Lấy kênh log toàn máy chủ
 */
async function getLogChannel(guild) {
  const channelId = config.roleLogChannelId || config.logChannelId;
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
}

/**
 * Lấy kênh log tạm biệt (Goodbye)
 */
async function getGoodbyeChannel(guild) {
  const channelId = config.goodbyeChannelId;
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
}

const recentNicknameLogs = new Map();
const recentRoleLogs = new Map();

// Bộ nhớ đệm Audit Logs ngắn hạn (3.5 giây) để chống dính Rate Limit HTTP 429 của Discord khi đông người
const auditLogCache = new Map();

async function getCachedAuditLogEntry(guild, type, targetId = null, maxAgeMs = 6000) {
  if (!guild) return null;
  const now = Date.now();
  const cacheKey = `${guild.id}_${type}`;
  let entries = null;

  const cached = auditLogCache.get(cacheKey);
  if (cached && (now - cached.timestamp < 3500)) {
    entries = cached.entries;
  } else {
    try {
      const logs = await guild.fetchAuditLogs({ limit: 6, type }).catch(() => null);
      if (logs?.entries) {
        entries = logs.entries;
        auditLogCache.set(cacheKey, { timestamp: now, entries });
      }
    } catch (_) {
      return null;
    }
  }

  if (!entries) return null;

  if (targetId) {
    return entries.find(e => e.target?.id === targetId && (now - e.createdTimestamp < maxAgeMs)) || null;
  }
  const first = entries.first();
  if (first && (now - first.createdTimestamp < maxAgeMs)) {
    return first;
  }
  return null;
}

// Dọn dẹp cache log định kỳ
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of recentRoleLogs.entries()) {
    if (now - v > 15000) recentRoleLogs.delete(k);
  }
  for (const [k, v] of recentNicknameLogs.entries()) {
    if (now - v > 15000) recentNicknameLogs.delete(k);
  }
  for (const [k, v] of auditLogCache.entries()) {
    if (now - v.timestamp > 10000) auditLogCache.delete(k);
  }
}, 30000);

/**
 * Khởi tạo hệ thống Server Audit Logger
 */
function initServerLogger(client) {
  // 1. Log thay đổi Role, Biệt danh, Timeout của thành viên
  client.on("guildMemberUpdate", async (oldMember, newMember) => {
    try {
      const guild = newMember.guild;
      const logChannel = await getLogChannel(guild);
      if (!logChannel) return;

      const nowVn = formatVietnameseDate(new Date());

      // 1.1 Kiểm tra thêm / bớt Role dựa trên Discord Audit Log chính thức
      let finalAddedRoleIds = [];
      let finalRemovedRoleIds = [];
      let executorMention = "Không rõ / Tự động";

      try {
        const entry = await getCachedAuditLogEntry(guild, AuditLogEvent.MemberRoleUpdate, newMember.id, 8000);
        if (entry) {
          executorMention = `<@${entry.executor.id}> (\`${entry.executor.tag || entry.executor.username}\`)`;

          if (entry.changes && Array.isArray(entry.changes)) {
            for (const change of entry.changes) {
              if (change.key === "$add" && Array.isArray(change.new)) {
                finalAddedRoleIds.push(...change.new.map(r => r.id));
              }
              if (change.key === "$remove" && Array.isArray(change.new)) {
                finalRemovedRoleIds.push(...change.new.map(r => r.id));
              }
            }
          }
        }
      } catch (err) {
        console.warn("[Logger Audit Error]", err.message);
      }

      // Nếu Audit Log chưa trả về kết quả (fallback) và cache cũ đầy đủ:
      if (finalAddedRoleIds.length === 0 && finalRemovedRoleIds.length === 0 && oldMember.roles?.cache?.size > 1) {
        const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
        const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
        finalAddedRoleIds = added.map(r => r.id);
        finalRemovedRoleIds = removed.map(r => r.id);
      }

      // Deduplication check: tránh trùng lặp log trong vòng 3s
      if (finalAddedRoleIds.length > 0 || finalRemovedRoleIds.length > 0) {
        const logKey = `${newMember.id}_add:${finalAddedRoleIds.sort().join(",")}_rem:${finalRemovedRoleIds.sort().join(",")}`;
        const nowMs = Date.now();
        if (recentRoleLogs.get(logKey) && nowMs - recentRoleLogs.get(logKey) < 3000) {
          return;
        }
        recentRoleLogs.set(logKey, nowMs);
      }

      if (finalAddedRoleIds.length > 0) {
        const roleList = finalAddedRoleIds.map(id => `<@&${id}>`).join(", ");
        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle(`${EMOJIS.unlock} Cấp Phát / Thêm Role`)
          .setDescription(
            `• **Thành viên:** <@${newMember.id}> ( \`${newMember.user.tag}\` )\n` +
            `• **Role được thêm:** ${roleList}\n` +
            `• **Người thực hiện:** ${executorMention}\n` +
            `• **Thời gian:** ${nowVn}`
          )
          .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: `User ID: ${newMember.id}` });

        await logChannel.send({ embeds: [embed] }).catch(() => null);
      }

      if (finalRemovedRoleIds.length > 0) {
        const roleList = finalRemovedRoleIds.map(id => `<@&${id}>`).join(", ");
        const embed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle(`${EMOJIS.lock} Thu Hồi / Gỡ Role`)
          .setDescription(
            `• **Thành viên:** <@${newMember.id}> ( \`${newMember.user.tag}\` )\n` +
            `• **Role bị gỡ:** ${roleList}\n` +
            `• **Người thực hiện:** ${executorMention}\n` +
            `• **Thời gian:** ${nowVn}`
          )
          .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: `User ID: ${newMember.id}` });

        await logChannel.send({ embeds: [embed] }).catch(() => null);
      }

      // 1.2 Kiểm tra đổi biệt danh (Nickname)
      if (oldMember.nickname !== newMember.nickname) {
        // Bỏ qua log nếu việc đổi tên do Bot tự động thực hiện (autoNickname / bot action)
        if (isRecentBotNicknameChange(newMember.id)) {
          return;
        }

        const oldNick = oldMember.nickname || oldMember.user.username;
        const newNick = newMember.nickname || newMember.user.username;

        let isBotExecutor = false;
        let executorMention = `<@${newMember.id}> (Tự đổi)`;
        try {
          const entry = await getCachedAuditLogEntry(guild, AuditLogEvent.MemberUpdate, newMember.id, 5000);
          if (entry) {
            executorMention = `<@${entry.executor.id}> (\`${entry.executor.tag || entry.executor.username}\`)`;
            if (entry.executor?.bot || entry.executor?.id === guild.members.me?.id) {
              isBotExecutor = true;
            }
          }
        } catch (_) {}

        // Nếu người thực hiện là Bot -> Không bắn log đổi tên theo yêu cầu
        if (isBotExecutor) {
          return;
        }

        const embed = new EmbedBuilder()
          .setColor(0x00A8FF)
          .setTitle(`${EMOJIS.wrench} Thay Đổi Biệt Danh`)
          .setDescription(
            `• **Thành viên:** <@${newMember.id}> ( \`${newMember.user.tag}\` )\n` +
            `• **Biệt danh cũ:** \`${oldNick}\`\n` +
            `• **Biệt danh mới:** \`${newNick}\`\n` +
            `• **Người thực hiện:** ${executorMention}\n` +
            `• **Thời gian:** ${nowVn}`
          )
          .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: `User ID: ${newMember.id}` });

        await logChannel.send({ embeds: [embed] }).catch(() => null);
      }

      // 1.3 Kiểm tra Timeout (Cách ly thành viên)
      const oldTimeout = oldMember.communicationDisabledUntilTimestamp || 0;
      const newTimeout = newMember.communicationDisabledUntilTimestamp || 0;
      if (oldTimeout !== newTimeout) {
        let executorMention = "Không rõ";
        let reason = "Không có lý do";
        try {
          const entry = await getCachedAuditLogEntry(guild, AuditLogEvent.MemberUpdate, newMember.id, 5000);
          if (entry) {
            executorMention = `<@${entry.executor.id}> (\`${entry.executor.tag || entry.executor.username}\`)`;
            if (entry.reason) reason = entry.reason;
          }
        } catch (_) {}

        if (newTimeout > Date.now()) {
          const untilVn = formatVietnameseDate(new Date(newTimeout));
          const embed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle(`⏳ Thành Viên Bị Cách Ly (Timeout)`)
            .setDescription(
              `• **Thành viên:** <@${newMember.id}> ( \`${newMember.user.tag}\` )\n` +
              `• **Thời hạn cách ly:** Đến \`${untilVn}\`\n` +
              `• **Người thực hiện:** ${executorMention}\n` +
              `• **Lý do:** *${reason}*\n` +
              `• **Thời gian:** ${nowVn}`
            )
            .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `User ID: ${newMember.id}` });

          await logChannel.send({ embeds: [embed] }).catch(() => null);
        } else if (oldTimeout > Date.now() && newTimeout <= Date.now()) {
          const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle(`🔓 Thành Viên Được Gỡ Cách Ly`)
            .setDescription(
              `• **Thành viên:** <@${newMember.id}> ( \`${newMember.user.tag}\` )\n` +
              `• **Người thực hiện:** ${executorMention}\n` +
              `• **Thời gian:** ${nowVn}`
            )
            .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `User ID: ${newMember.id}` });

          await logChannel.send({ embeds: [embed] }).catch(() => null);
        }
      }
    } catch (err) {
      console.error("Lỗi serverLogger (guildMemberUpdate):", err.message);
    }
  });

  // 2. Log xóa tin nhắn (Message Delete)
  client.on("messageDelete", async (message) => {
    try {
      if (!message.guild || message.author?.bot) return;

      const logChannel = await getLogChannel(message.guild);
      if (!logChannel || message.channelId === logChannel.id) return;

      const nowVn = formatVietnameseDate(new Date());

      let executorText = "Chính chủ xóa hoặc không rõ";
      try {
        const entry = await getCachedAuditLogEntry(message.guild, AuditLogEvent.MessageDelete, message.author?.id, 5000);
        if (entry) {
          executorText = `<@${entry.executor.id}> (${entry.executor.tag || entry.executor.username})`;
        }
      } catch (_) {}

      const content = message.content ? (message.content.length > 900 ? message.content.substring(0, 900) + "..." : message.content) : "*(Không có nội dung văn bản)*";
      const attachments = message.attachments.size > 0 ? message.attachments.map(a => a.name).join(", ") : null;

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(`${EMOJIS.trash} Tin Nhắn Bị Xóa`)
        .setDescription(
          `• **Người gửi:** <@${message.author?.id}> ( \`${message.author?.tag || "Unknown"}\` )\n` +
          `• **Kênh:** <#${message.channel.id}>\n` +
          `• **Người xóa:** ${executorText}\n` +
          `• **Thời gian:** ${nowVn}\n\n` +
          `**Nội dung đã xóa:**\n\`\`\`\n${content}\n\`\`\`` +
          (attachments ? `\n📎 **Tệp đính kèm:** \`${attachments}\`` : "")
        )
        .setThumbnail(message.author?.displayAvatarURL?.({ dynamic: true }) || null)
        .setFooter({ text: `Message ID: ${message.id} • Author ID: ${message.author?.id}` });

      await logChannel.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      console.error("Lỗi serverLogger (messageDelete):", err.message);
    }
  });

  // 3. Log sửa tin nhắn (Message Update)
  client.on("messageUpdate", async (oldMessage, newMessage) => {
    try {
      if (!newMessage.guild || newMessage.author?.bot) return;
      if (oldMessage.content === newMessage.content) return;

      const logChannel = await getLogChannel(newMessage.guild);
      if (!logChannel || newMessage.channelId === logChannel.id) return;

      const nowVn = formatVietnameseDate(new Date());

      const oldContent = oldMessage.content ? (oldMessage.content.length > 450 ? oldMessage.content.substring(0, 450) + "..." : oldMessage.content) : "*(Không có nội dung cũ)*";
      const newContent = newMessage.content ? (newMessage.content.length > 450 ? newMessage.content.substring(0, 450) + "..." : newMessage.content) : "*(Trống)*";

      const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle(`${EMOJIS.wrench} Tin Nhắn Đã Chỉnh Sửa`)
        .setDescription(
          `• **Người gửi:** <@${newMessage.author?.id}> ( \`${newMessage.author?.tag}\` )\n` +
          `• **Kênh:** <#${newMessage.channel.id}>\n` +
          `• **Liên kết:** [Bấm vào đây để xem tin nhắn](${newMessage.url})\n` +
          `• **Thời gian:** ${nowVn}\n\n` +
          `**Trước khi sửa:**\n\`\`\`\n${oldContent}\n\`\`\`\n` +
          `**Sau khi sửa:**\n\`\`\`\n${newContent}\n\`\`\``
        )
        .setThumbnail(newMessage.author?.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `Message ID: ${newMessage.id}` });

      await logChannel.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      console.error("Lỗi serverLogger (messageUpdate):", err.message);
    }
  });

  // 4. Log toàn diện phòng thoại (Voice State Update)
  client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
      const guild = newState.guild || oldState.guild;
      const logChannel = await getLogChannel(guild);
      if (!logChannel) return;

      const member = newState.member || oldState.member;
      if (!member || member.user.bot) return;

      const nowVn = formatVietnameseDate(new Date());

      // 4.1 Tham gia phòng thoại
      if (!oldState.channelId && newState.channelId) {
        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle(`🔊 Tham Gia Phòng Thoại`)
          .setDescription(
            `• **Thành viên:** <@${member.id}> ( \`${member.user.tag}\` )\n` +
            `• **Phòng thoại:** <#${newState.channelId}>\n` +
            `• **Thời gian:** ${nowVn}`
          )
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: `User ID: ${member.id}` });

        return logChannel.send({ embeds: [embed] }).catch(() => null);
      }

      // 4.2 Rời phòng thoại hoặc BỊ NGẮT KẾT NỐI (Disconnect)
      if (oldState.channelId && !newState.channelId) {
        let isForced = false;
        let executorMention = null;
        try {
          const entry = await getCachedAuditLogEntry(guild, AuditLogEvent.MemberDisconnect, null, 4000);
          if (entry) {
            isForced = true;
            executorMention = `<@${entry.executor.id}> (\`${entry.executor.tag || entry.executor.username}\`)`;
          }
        } catch (_) {}

        const embed = new EmbedBuilder()
          .setColor(isForced ? 0xED4245 : 0x95A5A6)
          .setTitle(isForced ? `🚫 Bị Ngắt Kết Nối Phòng Thoại (Kick Voice)` : `${EMOJIS.reject} Rời Phòng Thoại`)
          .setDescription(
            `• **Thành viên:** <@${member.id}> ( \`${member.user.tag}\` )\n` +
            `• **Phòng thoại:** <#${oldState.channelId}>\n` +
            (isForced ? `• **Người thực hiện:** ${executorMention}\n` : `• **Hành động:** Tự ngắt kết nối\n`) +
            `• **Thời gian:** ${nowVn}`
          )
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: `User ID: ${member.id}` });

        return logChannel.send({ embeds: [embed] }).catch(() => null);
      }

      // 4.3 Chuyển phòng hoặc BỊ DI CHUYỂN (Move Voice)
      if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        let isForced = false;
        let executorMention = null;
        try {
          const auditLogs = await guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberMove
          }).catch(() => null);
          const entry = auditLogs?.entries?.first();
          if (entry && Date.now() - entry.createdTimestamp < 4000) {
            isForced = true;
            executorMention = `<@${entry.executor.id}> (\`${entry.executor.tag || entry.executor.username}\`)`;
          }
        } catch (_) {}

        const embed = new EmbedBuilder()
          .setColor(0x00A8FF)
          .setTitle(isForced ? `🔀 Bị Di Chuyển Phòng Thoại (Move Voice)` : `🔀 Chuyển Phòng Thoại`)
          .setDescription(
            `• **Thành viên:** <@${member.id}> ( \`${member.user.tag}\` )\n` +
            `• **Từ phòng:** <#${oldState.channelId}>\n` +
            `• **Sang phòng:** <#${newState.channelId}>\n` +
            (isForced ? `• **Người thực hiện:** ${executorMention}\n` : `• **Hành động:** Tự chuyển phòng\n`) +
            `• **Thời gian:** ${nowVn}`
          )
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: `User ID: ${member.id}` });

        return logChannel.send({ embeds: [embed] }).catch(() => null);
      }

      // 4.4 Tắt âm máy chủ (Server Mute / Unmute)
      if (oldState.serverMute !== newState.serverMute) {
        let executorMention = "Staff";
        try {
          const auditLogs = await guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberUpdate
          }).catch(() => null);
          const entry = auditLogs?.entries?.first();
          if (entry && entry.target?.id === member.id && Date.now() - entry.createdTimestamp < 4000) {
            executorMention = `<@${entry.executor.id}> (\`${entry.executor.tag || entry.executor.username}\`)`;
          }
        } catch (_) {}

        const embed = new EmbedBuilder()
          .setColor(newState.serverMute ? 0xED4245 : 0x57F287)
          .setTitle(newState.serverMute ? `🔇 Bị Tắt Âm Máy Chủ (Server Mute)` : `🔊 Được Mở Âm Máy Chủ (Server Unmute)`)
          .setDescription(
            `• **Thành viên:** <@${member.id}> ( \`${member.user.tag}\` )\n` +
            `• **Phòng thoại:** <#${newState.channelId || oldState.channelId}>\n` +
            `• **Trạng thái:** ${newState.serverMute ? "**Bị tắt Micro máy chủ**" : "**Được mở lại Micro**"}\n` +
            `• **Người thực hiện:** ${executorMention}\n` +
            `• **Thời gian:** ${nowVn}`
          )
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: `User ID: ${member.id}` });

        return logChannel.send({ embeds: [embed] }).catch(() => null);
      }

      // 4.5 Tắt tiếng máy chủ (Server Deafen / Undeafen)
      if (oldState.serverDeaf !== newState.serverDeaf) {
        let executorMention = "Staff";
        try {
          const auditLogs = await guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberUpdate
          }).catch(() => null);
          const entry = auditLogs?.entries?.first();
          if (entry && entry.target?.id === member.id && Date.now() - entry.createdTimestamp < 4000) {
            executorMention = `<@${entry.executor.id}> (\`${entry.executor.tag || entry.executor.username}\`)`;
          }
        } catch (_) {}

        const embed = new EmbedBuilder()
          .setColor(newState.serverDeaf ? 0xED4245 : 0x57F287)
          .setTitle(newState.serverDeaf ? `🔕 Bị Tắt Tiếng Máy Chủ (Server Deafen)` : `🔔 Được Mở Tiếng Máy Chủ (Server Undeafen)`)
          .setDescription(
            `• **Thành viên:** <@${member.id}> ( \`${member.user.tag}\` )\n` +
            `• **Phòng thoại:** <#${newState.channelId || oldState.channelId}>\n` +
            `• **Trạng thái:** ${newState.serverDeaf ? "**Bị tắt Tai nghe máy chủ**" : "**Được mở lại Tai nghe**"}\n` +
            `• **Người thực hiện:** ${executorMention}\n` +
            `• **Thời gian:** ${nowVn}`
          )
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: `User ID: ${member.id}` });

        return logChannel.send({ embeds: [embed] }).catch(() => null);
      }

      // 4.6 Tắt âm từ phòng này (Suppress / Room Mute)
      if (oldState.suppress !== newState.suppress) {
        const embed = new EmbedBuilder()
          .setColor(newState.suppress ? 0xE67E22 : 0x57F287)
          .setTitle(newState.suppress ? `🔇 Bị Tắt Âm Từ Phòng Này` : `🎙️ Được Quyền Nói Trong Phòng`)
          .setDescription(
            `• **Thành viên:** <@${member.id}> ( \`${member.user.tag}\` )\n` +
            `• **Phòng thoại:** <#${newState.channelId || oldState.channelId}>\n` +
            `• **Thời gian:** ${nowVn}`
          )
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: `User ID: ${member.id}` });

        return logChannel.send({ embeds: [embed] }).catch(() => null);
      }

      // 4.7 Phát trực tiếp màn hình (Live Stream)
      if (oldState.streaming !== newState.streaming) {
        const embed = new EmbedBuilder()
          .setColor(newState.streaming ? 0x9B59B6 : 0x95A5A6)
          .setTitle(newState.streaming ? `📺 Bắt Đầu Phát Trực Tiếp Màn Hình` : `⏹️ Dừng Phát Trực Tiếp Màn Hình`)
          .setDescription(
            `• **Thành viên:** <@${member.id}> ( \`${member.user.tag}\` )\n` +
            `• **Phòng thoại:** <#${newState.channelId || oldState.channelId}>\n` +
            `• **Thời gian:** ${nowVn}`
          )
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: `User ID: ${member.id}` });

        return logChannel.send({ embeds: [embed] }).catch(() => null);
      }

      // 4.8 Bật / Tắt Camera (Video)
      if (oldState.selfVideo !== newState.selfVideo) {
        const embed = new EmbedBuilder()
          .setColor(newState.selfVideo ? 0x9B59B6 : 0x95A5A6)
          .setTitle(newState.selfVideo ? `📹 Bật Camera (Webcam)` : `📷 Tắt Camera`)
          .setDescription(
            `• **Thành viên:** <@${member.id}> ( \`${member.user.tag}\` )\n` +
            `• **Phòng thoại:** <#${newState.channelId || oldState.channelId}>\n` +
            `• **Thời gian:** ${nowVn}`
          )
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: `User ID: ${member.id}` });

        return logChannel.send({ embeds: [embed] }).catch(() => null);
      }
    } catch (err) {
      console.error("Lỗi serverLogger (voiceStateUpdate):", err.message);
    }
  });

  // 5. Log thành viên tham gia / rời server
  client.on("guildMemberAdd", async (member) => {
    try {
      const logChannel = await getLogChannel(member.guild);
      if (!logChannel) return;

      const nowVn = formatVietnameseDate(new Date());
      const createdAtVn = formatVietnameseDate(member.user.createdAt);

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(`${EMOJIS.party} Thành Viên Mới Tham Gia`)
        .setDescription(
          `• **Thành viên:** <@${member.id}> ( \`${member.user.tag}\` )\n` +
          `• **Ngày tạo tài khoản:** ${createdAtVn}\n` +
          `• **Tổng số thành viên:** **${member.guild.memberCount}**\n` +
          `• **Thời gian tham gia:** ${nowVn}`
        )
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `User ID: ${member.id}` });

      await logChannel.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      console.error("Lỗi serverLogger (guildMemberAdd):", err.message);
    }
  });

  client.on("guildMemberRemove", async (member) => {
    try {
      const logChannel = await getLogChannel(member.guild);
      const goodbyeChannel = await getGoodbyeChannel(member.guild);
      if (!logChannel && !goodbyeChannel) return;

      const nowVn = formatVietnameseDate(new Date());

      let reasonText = "Tự rời máy chủ";
      try {
        const auditLogs = await member.guild.fetchAuditLogs({ limit: 1 }).catch(() => null);
        const entry = auditLogs?.entries?.first();
        if (entry && entry.target?.id === member.id && Date.now() - entry.createdTimestamp < 5000) {
          if (entry.action === AuditLogEvent.MemberKick) {
            reasonText = `⚠️ **Bị Kick bởi:** <@${entry.executor.id}> (Lý do: *${entry.reason || "Không có"}*)`;
          } else if (entry.action === AuditLogEvent.MemberBanAdd) {
            reasonText = `⛔ **Bị Ban bởi:** <@${entry.executor.id}> (Lý do: *${entry.reason || "Không có"}*)`;
          }
        }
      } catch (_) {}

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(`${EMOJIS.warning} Thành Viên Đã Rời Máy Chủ`)
        .setDescription(
          `• **Thành viên:** <@${member.id}> ( \`${member.user.tag || member.user.username}\` )\n` +
          `• **Trạng thái:** ${reasonText}\n` +
          `• **Tổng số thành viên còn lại:** **${member.guild.memberCount}**\n` +
          `• **Thời gian:** ${nowVn}`
        )
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `User ID: ${member.id}` });

      if (logChannel) {
        await logChannel.send({ embeds: [embed] }).catch(() => null);
      }
      if (goodbyeChannel && goodbyeChannel.id !== logChannel?.id) {
        await goodbyeChannel.send({ embeds: [embed] }).catch(() => null);
      }
    } catch (err) {
      console.error("Lỗi serverLogger (guildMemberRemove):", err.message);
    }
  });

  // 6. Log Ban & Unban thành viên
  client.on("guildBanAdd", async (ban) => {
    try {
      const logChannel = await getLogChannel(ban.guild);
      if (!logChannel) return;

      const nowVn = formatVietnameseDate(new Date());
      let executorMention = "Không rõ";
      let reason = ban.reason || "Không có lý do";

      try {
        const auditLogs = await ban.guild.fetchAuditLogs({
          limit: 1,
          type: AuditLogEvent.MemberBanAdd
        }).catch(() => null);
        const entry = auditLogs?.entries?.first();
        if (entry && entry.target?.id === ban.user.id) {
          executorMention = `<@${entry.executor.id}> (\`${entry.executor.tag || entry.executor.username}\`)`;
          if (entry.reason) reason = entry.reason;
        }
      } catch (_) {}

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(`⛔ Thành Viên Bị Cấm (Ban) Khỏi Máy Chủ`)
        .setDescription(
          `• **Thành viên bị Ban:** <@${ban.user.id}> ( \`${ban.user.tag || ban.user.username}\` )\n` +
          `• **Người thực hiện:** ${executorMention}\n` +
          `• **Lý do:** *${reason}*\n` +
          `• **Thời gian:** ${nowVn}`
        )
        .setThumbnail(ban.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `User ID: ${ban.user.id}` });

      await logChannel.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      console.error("Lỗi serverLogger (guildBanAdd):", err.message);
    }
  });

  client.on("guildBanRemove", async (ban) => {
    try {
      const logChannel = await getLogChannel(ban.guild);
      if (!logChannel) return;

      const nowVn = formatVietnameseDate(new Date());
      let executorMention = "Không rõ";

      try {
        const auditLogs = await ban.guild.fetchAuditLogs({
          limit: 1,
          type: AuditLogEvent.MemberBanRemove
        }).catch(() => null);
        const entry = auditLogs?.entries?.first();
        if (entry && entry.target?.id === ban.user.id) {
          executorMention = `<@${entry.executor.id}> (\`${entry.executor.tag || entry.executor.username}\`)`;
        }
      } catch (_) {}

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(`🟢 Thành Viên Được Gỡ Cấm (Unban)`)
        .setDescription(
          `• **Thành viên:** <@${ban.user.id}> ( \`${ban.user.tag || ban.user.username}\` )\n` +
          `• **Người thực hiện:** ${executorMention}\n` +
          `• **Thời gian:** ${nowVn}`
        )
        .setThumbnail(ban.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `User ID: ${ban.user.id}` });

      await logChannel.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      console.error("Lỗi serverLogger (guildBanRemove):", err.message);
    }
  });

  // 7. Log tạo / xóa / sửa kênh
  client.on("channelCreate", async (channel) => {
    try {
      if (!channel.guild) return;
      const logChannel = await getLogChannel(channel.guild);
      if (!logChannel || channel.id === logChannel.id) return;

      const nowVn = formatVietnameseDate(new Date());
      const typeStr = channel.type === ChannelType.GuildVoice ? "Kênh Thoại (Voice)" : (channel.type === ChannelType.GuildCategory ? "Danh Mục (Category)" : "Kênh Văn Bản (Text)");

      let executorMention = "Không rõ";
      try {
        const auditLogs = await channel.guild.fetchAuditLogs({
          limit: 1,
          type: AuditLogEvent.ChannelCreate
        }).catch(() => null);
        const entry = auditLogs?.entries?.first();
        if (entry && entry.target?.id === channel.id && Date.now() - entry.createdTimestamp < 5000) {
          executorMention = `<@${entry.executor.id}> (\`${entry.executor.tag || entry.executor.username}\`)`;
        }
      } catch (_) {}

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(`${EMOJIS.pin} Kênh Mới Được Tạo`)
        .setDescription(
          `• **Tên kênh:** \`#${channel.name}\` ( <#${channel.id}> )\n` +
          `• **Loại kênh:** ${typeStr}\n` +
          `• **Người tạo:** ${executorMention}\n` +
          `• **Thời gian:** ${nowVn}`
        )
        .setFooter({ text: `Channel ID: ${channel.id}` });

      await logChannel.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      console.error("Lỗi serverLogger (channelCreate):", err.message);
    }
  });

  client.on("channelDelete", async (channel) => {
    try {
      if (!channel.guild) return;
      const logChannel = await getLogChannel(channel.guild);
      if (!logChannel || channel.id === logChannel.id) return;

      const nowVn = formatVietnameseDate(new Date());
      const typeStr = channel.type === ChannelType.GuildVoice ? "Kênh Thoại (Voice)" : (channel.type === ChannelType.GuildCategory ? "Danh Mục (Category)" : "Kênh Văn Bản (Text)");

      let executorMention = "Không rõ";
      try {
        const auditLogs = await channel.guild.fetchAuditLogs({
          limit: 1,
          type: AuditLogEvent.ChannelDelete
        }).catch(() => null);
        const entry = auditLogs?.entries?.first();
        if (entry && entry.target?.id === channel.id && Date.now() - entry.createdTimestamp < 5000) {
          executorMention = `<@${entry.executor.id}> (\`${entry.executor.tag || entry.executor.username}\`)`;
        }
      } catch (_) {}

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(`${EMOJIS.trash} Kênh Đã Bị Xóa`)
        .setDescription(
          `• **Tên kênh đã xóa:** \`#${channel.name}\`\n` +
          `• **Loại kênh:** ${typeStr}\n` +
          `• **Người xóa:** ${executorMention}\n` +
          `• **Thời gian:** ${nowVn}`
        )
        .setFooter({ text: `Channel ID: ${channel.id}` });

      await logChannel.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      console.error("Lỗi serverLogger (channelDelete):", err.message);
    }
  });

  client.on("channelUpdate", async (oldChannel, newChannel) => {
    try {
      if (!newChannel.guild) return;
      if (oldChannel.name === newChannel.name) return; // Chỉ log khi đổi tên kênh

      const logChannel = await getLogChannel(newChannel.guild);
      if (!logChannel || newChannel.id === logChannel.id) return;

      const nowVn = formatVietnameseDate(new Date());

      const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle(`📝 Kênh Đã Đổi Tên`)
        .setDescription(
          `• **Kênh:** <#${newChannel.id}>\n` +
          `• **Tên cũ:** \`#${oldChannel.name}\`\n` +
          `• **Tên mới:** \`#${newChannel.name}\`\n` +
          `• **Thời gian:** ${nowVn}`
        )
        .setFooter({ text: `Channel ID: ${newChannel.id}` });

      await logChannel.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      console.error("Lỗi serverLogger (channelUpdate):", err.message);
    }
  });

  // 8. Log Quản lý Role (Tạo / Xóa Role)
  client.on("roleCreate", async (role) => {
    try {
      const logChannel = await getLogChannel(role.guild);
      if (!logChannel) return;

      const nowVn = formatVietnameseDate(new Date());
      let executorMention = "Không rõ";
      try {
        const auditLogs = await role.guild.fetchAuditLogs({
          limit: 1,
          type: AuditLogEvent.RoleCreate
        }).catch(() => null);
        const entry = auditLogs?.entries?.first();
        if (entry && entry.target?.id === role.id && Date.now() - entry.createdTimestamp < 5000) {
          executorMention = `<@${entry.executor.id}> (\`${entry.executor.tag || entry.executor.username}\`)`;
        }
      } catch (_) {}

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(`🛡️ Role Mới Được Tạo`)
        .setDescription(
          `• **Tên Role:** <@&${role.id}> ( \`${role.name}\` )\n` +
          `• **Màu sắc:** \`${role.hexColor}\`\n` +
          `• **Người tạo:** ${executorMention}\n` +
          `• **Thời gian:** ${nowVn}`
        )
        .setFooter({ text: `Role ID: ${role.id}` });

      await logChannel.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      console.error("Lỗi serverLogger (roleCreate):", err.message);
    }
  });

  client.on("roleDelete", async (role) => {
    try {
      const logChannel = await getLogChannel(role.guild);
      if (!logChannel) return;

      const nowVn = formatVietnameseDate(new Date());
      let executorMention = "Không rõ";
      try {
        const auditLogs = await role.guild.fetchAuditLogs({
          limit: 1,
          type: AuditLogEvent.RoleDelete
        }).catch(() => null);
        const entry = auditLogs?.entries?.first();
        if (entry && entry.target?.id === role.id && Date.now() - entry.createdTimestamp < 5000) {
          executorMention = `<@${entry.executor.id}> (\`${entry.executor.tag || entry.executor.username}\`)`;
        }
      } catch (_) {}

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(`🗑️ Role Đã Bị Xóa`)
        .setDescription(
          `• **Tên Role đã xóa:** \`${role.name}\`\n` +
          `• **Người xóa:** ${executorMention}\n` +
          `• **Thời gian:** ${nowVn}`
        )
        .setFooter({ text: `Role ID: ${role.id}` });

      await logChannel.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      console.error("Lỗi serverLogger (roleDelete):", err.message);
    }
  });

  console.log("✅ Hệ thống Server Audit Logger toàn diện đã sẵn sàng!");
}

module.exports = {
  initServerLogger
};
