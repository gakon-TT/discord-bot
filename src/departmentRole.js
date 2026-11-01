const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  AttachmentBuilder
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const EMOJIS = require("./emojis");
const { syncMemberNickname } = require("./autoNickname");

// In-memory store for pending confirmation sessions (auto expires after 10 mins)
const pendingSessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of pendingSessions.entries()) {
    if (now - session.createdAt > 10 * 60 * 1000) {
      pendingSessions.delete(key);
    }
  }
}, 60 * 1000);

/**
 * Danh sách cấu hình các Role có thể quản lý:
 * Sau này bạn có thể thêm các role doanh nghiệp, nhà hàng, cứu hộ... vào danh sách này.
 * Mỗi role gồm:
 * - id: Mã định danh
 * - name: Tên hiển thị
 * - emoji: Biểu tượng
 * - managerRoleId: ID role của người quản lý (người có quyền cấp/gỡ)
 * - targetRoleId: ID role sẽ được cấp hoặc gỡ cho thành viên
 */
function getDepartments() {
  return [
    {
      id: "police",
      name: "Cảnh Sát",
      type: "ban ngành",
      emoji: EMOJIS.police,
      managerRoleId: config.policeManagerRoleId,
      targetRoleId: config.policeRoleId,
      logChannelId: config.policeLogChannelId || config.roleLogChannelId
    },
    {
      id: "medic",
      name: "Bác Sĩ",
      type: "ban ngành",
      emoji: EMOJIS.medic,
      managerRoleId: config.medicManagerRoleId,
      targetRoleId: config.medicRoleId,
      logChannelId: config.medicLogChannelId || config.roleLogChannelId
    },
    {
      id: "cardealer",
      name: "Car Dealer",
      type: "doanh nghiệp",
      emoji: EMOJIS.shop || "🏎️",
      managerRoleId: config.cardealerManagerRoleId,
      targetRoleId: config.cardealerRoleId,
      logChannelId: config.cardealerLogChannelId || config.roleLogChannelId
    }
    // Sau này có thể thêm:
    // {
    //   id: "restaurant",
    //   name: "Nhà Hàng",
    //   emoji: "🍽️",
    //   managerRoleId: process.env.RESTAURANT_MANAGER_ROLE_ID,
    //   targetRoleId: process.env.RESTAURANT_ROLE_ID
    // },
    // {
    //   id: "rescue",
    //   name: "Cứu Hộ",
    //   emoji: "🔧",
    //   managerRoleId: process.env.RESCUE_MANAGER_ROLE_ID,
    //   targetRoleId: process.env.RESCUE_ROLE_ID
    // }
  ];
}

function buildDepartmentPanel() {
  const bannerGifPath = path.join(__dirname, "../assets/SWAG_banner_discord_Full.gif");
  const bannerPath = path.join(__dirname, "../assets/department_banner.png");
  const files = [];

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`${EMOJIS.briefcase} HỆ THỐNG CẤP PHÁT & QUẢN LÝ ROLE`)
    .setDescription(
      `Tự chủ quản lý chức vụ và role cho **Doanh nghiệp / Tổ chức** của bạn — nhanh chóng, chủ động, không bị động trong việc điều phối nhân sự.\n\n` +
      `${EMOJIS.verify} **Cấp phát Role**\n` +
      `> Nhấn nút **Cấp phát Role** để gán role cho thành viên mới gia nhập tổ chức, doanh nghiệp hoặc đơn vị của bạn.\n\n` +
      `${EMOJIS.trash} **Thu hồi Role**\n` +
      `> Nhấn nút **Thu hồi Role** để gỡ bỏ role khi nhân sự nghỉ việc, chuyển đơn vị hoặc không còn hoạt động.\n\n` +
      `${EMOJIS.rules} **Hướng dẫn sử dụng**\n` +
      `> **Bước 1:** Nhấn nút **Cấp phát Role** hoặc **Thu hồi Role** bên dưới.\n` +
      `> **Bước 2:** Tại ô chọn, tích chọn danh sách các thành viên (tối đa 25 người).\n` +
      `> **Bước 3: Click chuột ra ngoài ô chọn** để đóng menu và hiện nút bấm Xác nhận.\n` +
      `> **Bước 4:** Nhấn nút **Xác nhận** để hoàn tất hoặc **Hủy bỏ** để dừng thao tác.\n\n` +
      `${EMOJIS.warning} **Lưu ý**\n` +
      `> • Chỉ người có role quản lý tương ứng mới có thể thao tác.\n` +
      `> • Mọi thao tác cấp/gỡ đều được **ghi log tự động** nhằm đảm bảo minh bạch.`
    );

  if (fs.existsSync(bannerGifPath)) {
    files.push(new AttachmentBuilder(bannerGifPath, { name: "SWAG_banner_discord_Full.gif" }));
    embed.setImage("attachment://SWAG_banner_discord_Full.gif");
  } else if (fs.existsSync(bannerPath)) {
    files.push(new AttachmentBuilder(bannerPath, { name: "department_banner.png" }));
    embed.setImage("attachment://department_banner.png");
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("dept_action:grant")
      .setLabel("Cấp phát Role")
      .setStyle(ButtonStyle.Success)
      .setEmoji(EMOJIS.verify),
    new ButtonBuilder()
      .setCustomId("dept_action:revoke")
      .setLabel("Thu hồi Role")
      .setStyle(ButtonStyle.Danger)
      .setEmoji(EMOJIS.trash)
  );

  return { embed, components: [row], files };
}

function getAuthorizedDepartments(member) {
  if (!member) return [];
  const depts = getDepartments();
  const hasRole = (roleId) => {
    if (!roleId) return false;
    if (Array.isArray(member.roles)) {
      return member.roles.includes(roleId);
    }
    return member.roles?.cache?.has(roleId);
  };

  // Chỉ người thực tế sở hữu role quản lý tương ứng mới có quyền cấp/gỡ role đó
  return depts.filter(d => d.managerRoleId && hasRole(d.managerRoleId));
}

function buildMemberSelectMessage(action, dept) {
  const actionText = action === "grant" ? "CẤP PHÁT" : "THU HỒI";
  const actionVerb = action === "grant" ? "cấp phát" : "thu hồi";

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`👤 Quản lý Role: ${actionText} @${dept.name}`)
    .setDescription(
      `Hãy chọn các thành viên trong ô dưới đây (gõ tên để tìm kiếm), sau đó **click ra ngoài ô chọn** để hiện nút xác nhận:`
    );

  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`dept_users_select:${action}:${dept.id}`)
      .setPlaceholder(`Chọn thành viên cần ${actionVerb} role...`)
      .setMinValues(1)
      .setMaxValues(25)
  );

  return { embeds: [embed], components: [row] };
}

async function handleDepartmentInteraction(interaction) {
  // 1. Initial Button Click (Cấp phát Role / Thu hồi Role)
  if (interaction.isButton() && interaction.customId.startsWith("dept_action:")) {
    const action = interaction.customId.split(":")[1];
    const authorized = getAuthorizedDepartments(interaction.member);

    if (authorized.length === 0) {
      return interaction.reply({
        content: "❌ **Bạn không có Role Quản Lý!**\n> Bạn cần phải sở hữu role quản lý tương ứng (ví dụ: Quản Lý Cảnh Sát, Quản Lý Bác Sĩ,...) mới có thể thực hiện thao tác này.",
        ephemeral: true
      });
    }

    // Tự động nhận định role nếu người dùng có role quản lý tương ứng (không cần chọn qua dropdown)
    if (authorized.length === 1) {
      const dept = authorized[0];
      const payload = buildMemberSelectMessage(action, dept);
      return interaction.reply({ ...payload, ephemeral: true });
    }

    // Nếu người dùng quản lý nhiều role khác nhau (ví dụ vừa quản lý Cảnh sát vừa quản lý Nhà Hàng), hiển thị menu chọn role
    const actionVerb = action === "grant" ? "cấp phát" : "thu hồi";
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`dept_choose:${action}`)
      .setPlaceholder(`Chọn role muốn ${actionVerb}...`)
      .addOptions(
        authorized.map(d => ({
          label: d.name,
          value: d.id,
          emoji: EMOJIS.parse(d.emoji),
          description: `Quản lý cấp/thu hồi role ${d.name}`
        }))
      );

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(`💼 Quản lý Role: Chọn Role Thao Tác`)
      .setDescription(`Vui lòng chọn role bạn muốn tiến hành **${actionVerb}**:`);

    return interaction.reply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(selectMenu)],
      ephemeral: true
    });
  }

  // 2. Role Chosen from StringSelectMenu (for multi-role managers)
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("dept_choose:")) {
    const action = interaction.customId.split(":")[1];
    const deptId = interaction.values[0];
    const dept = getDepartments().find(d => d.id === deptId);

    if (!dept) {
      return interaction.reply({ content: "❌ Role không tồn tại.", ephemeral: true });
    }

    const payload = buildMemberSelectMessage(action, dept);
    return interaction.update({ ...payload });
  }

  // 3. Members Selected from UserSelectMenu (Matching Image 3)
  if (interaction.isUserSelectMenu() && interaction.customId.startsWith("dept_users_select:")) {
    const [, action, deptId] = interaction.customId.split(":");
    const dept = getDepartments().find(d => d.id === deptId);

    if (!dept) {
      return interaction.reply({ content: "❌ Role không tồn tại.", ephemeral: true });
    }

    const authorized = getAuthorizedDepartments(interaction.member);
    if (!authorized.some(d => d.id === dept.id)) {
      return interaction.reply({
        content: `❌ **Bạn không có Role Quản Lý của ${dept.name}!** Thao tác bị từ chối.`,
        ephemeral: true
      });
    }

    const selectedUserIds = interaction.values;
    const actionText = action === "grant" ? "CẤP PHÁT" : "THU HỒI";
    const actionVerb = action === "grant" ? "cấp phát" : "thu hồi";

    const sessionId = Math.random().toString(36).substring(2, 10);
    pendingSessions.set(sessionId, {
      action,
      deptId,
      userIds: selectedUserIds,
      managerId: interaction.user.id,
      createdAt: Date.now()
    });

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(`👤 Quản lý Role: ${actionText} @${dept.name}`)
      .setDescription(
        `Bạn đang chọn **${actionVerb}** role <@&${dept.targetRoleId}> cho các thành viên sau:\n` +
        selectedUserIds.map(id => `👉 <@${id}>`).join("\n") +
        `\n\nNhấn nút **Xác nhận** bên dưới để tiến hành. Bạn vẫn có thể thay đổi danh sách đã chọn bằng ô chọn phía trên.`
      );

    const userSelectRow = new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`dept_users_select:${action}:${dept.id}`)
        .setPlaceholder(`Chọn thành viên cần ${actionVerb} role...`)
        .setMinValues(1)
        .setMaxValues(25)
    );

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`dept_confirm:${action}:${dept.id}:${sessionId}`)
        .setLabel("Xác nhận")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`dept_cancel:${sessionId}`)
        .setLabel("Hủy bỏ")
        .setStyle(ButtonStyle.Danger)
    );

    return interaction.update({
      embeds: [embed],
      components: [userSelectRow, buttonRow]
    });
  }

  // 4. Cancel Action
  if (interaction.isButton() && interaction.customId.startsWith("dept_cancel:")) {
    const sessionId = interaction.customId.split(":")[1];
    pendingSessions.delete(sessionId);

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setDescription("❌ Đã hủy bỏ thao tác quản lý role.");

    return interaction.update({
      embeds: [embed],
      components: []
    });
  }

  // 5. Confirm Action (Execute Grant / Revoke - Matching Image 4 & 5)
  if (interaction.isButton() && interaction.customId.startsWith("dept_confirm:")) {
    const parts = interaction.customId.split(":");
    let action, deptId, sessionId;
    if (parts.length >= 4) {
      [, action, deptId, sessionId] = parts;
    } else {
      sessionId = parts[1];
    }

    let session = pendingSessions.get(sessionId);

    // Fail-safe: Nếu bot bị khởi động lại hoặc session hết hạn trong bộ nhớ, tự phục hồi từ tin nhắn embed
    if (!session || !session.userIds || session.userIds.length === 0) {
      if (interaction.message?.embeds?.[0]?.description) {
        const desc = interaction.message.embeds[0].description;
        const matches = desc.match(/<@!?([0-9]{17,20})>/g);
        if (matches) {
          const extractedIds = matches.map(m => m.replace(/[^0-9]/g, ""));
          const matchedDept = getDepartments().find(d => d.id === deptId)
            || getDepartments().find(d => desc.includes(`@&${d.targetRoleId}`) || desc.includes(`@${d.name}`))
            || getDepartments()[0];

          session = {
            action: action || (desc.includes("cấp phát") ? "grant" : "revoke"),
            deptId: matchedDept ? matchedDept.id : (deptId || "police"),
            userIds: [...new Set(extractedIds)],
            managerId: interaction.user.id
          };
        }
      }
    }

    if (!session || !session.userIds || session.userIds.length === 0) {
      return interaction.reply({
        content: "❌ Phiên thao tác đã hết hạn hoặc không tồn tại. Vui lòng bấm nút chọn lại.",
        ephemeral: true
      });
    }

    if (session.managerId && session.managerId !== interaction.user.id) {
      return interaction.reply({
        content: "❌ Bạn không phải là người tạo phiên thao tác này.",
        ephemeral: true
      });
    }

    const dept = getDepartments().find(d => d.id === session.deptId);
    if (!dept || !dept.targetRoleId) {
      return interaction.reply({
        content: "❌ Role chưa được cấu hình Role ID trên server.",
        ephemeral: true
      });
    }

    // Double check permissions
    const authorized = getAuthorizedDepartments(interaction.member);
    if (!authorized.some(d => d.id === dept.id)) {
      return interaction.reply({
        content: `❌ **Bạn không có Role Quản Lý của ${dept.name}!** Thao tác bị từ chối.`,
        ephemeral: true
      });
    }

    try {
      await interaction.deferUpdate();
    } catch {
      // Bỏ qua nếu đã được defer trước đó
    }

    const guild = interaction.guild;
    const targetRoleId = dept.targetRoleId;
    const targetRole = guild.roles.cache.get(targetRoleId)
      || await guild.roles.fetch(targetRoleId).catch(() => null);
    const roleDisplayName = targetRole?.name || (dept.id === "police" ? "Police" : dept.id === "medic" ? "EMS" : dept.name);

    const successfulIds = [];
    const noRoleIds = [];
    const alreadyHavingIds = [];
    const conflictDeptIds = [];
    const failedIds = [];

    const allDepartments = getDepartments();

    for (const uid of session.userIds) {
      try {
        const targetMember = await guild.members.fetch(uid).catch(() => null);
        if (!targetMember) {
          failedIds.push(uid);
          continue;
        }

        const hasRole = targetMember.roles.cache.has(targetRoleId);

        if (session.action === "grant") {
          if (hasRole) {
            alreadyHavingIds.push(uid);
          } else {
            // Kiểm tra xem thành viên đã có role ban ngành / doanh nghiệp nào khác chưa
            const existingDept = allDepartments.find(d =>
              d.id !== dept.id && (
                (d.targetRoleId && targetMember.roles.cache.has(d.targetRoleId)) ||
                (d.managerRoleId && targetMember.roles.cache.has(d.managerRoleId))
              )
            );

            if (existingDept) {
              conflictDeptIds.push({
                uid,
                existingName: existingDept.name,
                existingRoleId: existingDept.targetRoleId,
                existingType: existingDept.type || "ban ngành/doanh nghiệp"
              });
            } else {
              await targetMember.roles.add(targetRoleId, `Cấp phát bởi ${interaction.user.tag}`);
              await syncMemberNickname(targetMember).catch(() => {});
              successfulIds.push(uid);
            }
          }
        } else {
          // action === "revoke"
          if (!hasRole) {
            noRoleIds.push(uid);
          } else {
            await targetMember.roles.remove(targetRoleId, `Thu hồi bởi ${interaction.user.tag}`);
            await syncMemberNickname(targetMember).catch(() => {});
            successfulIds.push(uid);
          }
        }
      } catch (err) {
        console.error(`Lỗi cập nhật role cho user ${uid}:`, err.message);
        failedIds.push(uid);
      }
    }

    // Update ephemeral interaction message
    const actionPastTense = session.action === "grant" ? "cấp phát" : "gỡ bỏ";
    const actionText = session.action === "grant" ? "CẤP PHÁT" : "THU HỒI";

    const lines = [];

    if (successfulIds.length > 0) {
      lines.push(`✅ Đã ${actionPastTense} role <@&${targetRoleId}> cho: ` + successfulIds.map(id => `<@${id}>`).join(", "));
    }

    if (conflictDeptIds.length > 0) {
      const byType = {};
      for (const item of conflictDeptIds) {
        const typeKey = item.existingType || "ban ngành/doanh nghiệp";
        if (!byType[typeKey]) byType[typeKey] = [];
        byType[typeKey].push(item);
      }

      for (const [typeKey, items] of Object.entries(byType)) {
        lines.push(
          `⚠️ Không thể cấp role **${dept.name}** (<@&${targetRoleId}>) vì thành viên đang sở hữu role ${typeKey} khác:\n` +
          items.map(item => `• <@${item.uid}> (đang có role **${item.existingName}** ${item.existingRoleId ? `<@&${item.existingRoleId}>` : ""})`).join("\n")
        );
      }
    }

    if (noRoleIds.length > 0) {
      lines.push(`❌ Người này không có role **${roleDisplayName}** (<@&${targetRoleId}>) để gỡ: ` + noRoleIds.map(id => `<@${id}>`).join(", "));
    }

    if (alreadyHavingIds.length > 0) {
      lines.push(`ℹ️ Người này đã có role **${roleDisplayName}** (<@&${targetRoleId}>) từ trước: ` + alreadyHavingIds.map(id => `<@${id}>`).join(", "));
    }

    if (failedIds.length > 0) {
      lines.push(`⚠️ Không tìm thấy hoặc lỗi với: ` + failedIds.map(id => `<@${id}>`).join(", "));
    }

    const embedResult = new EmbedBuilder()
      .setColor(successfulIds.length > 0 ? 0x57F287 : 0xED4245)
      .setTitle(`👤 Quản lý Role: ${actionText} @${dept.name}`)
      .setDescription(lines.join("\n\n"));

    await interaction.editReply({
      embeds: [embedResult],
      components: []
    });

    // Send Log into the dedicated log channel of this role (Matching Image 5)
    if (successfulIds.length > 0) {
      try {
        const logChannelId = dept.logChannelId || config.roleLogChannelId;
        if (logChannelId) {
          const logChannel = guild.channels.cache.get(logChannelId)
            || await guild.channels.fetch(logChannelId).catch(() => null);

          if (logChannel) {
            const logTitle = session.action === "grant"
              ? "➕ Cấp phát Role"
              : "🗑️ Thu hồi Role";

            const logEmbed = new EmbedBuilder()
              .setColor(0x2b2d31)
              .setTitle(logTitle)
              .setDescription(
                `• **Người thực hiện:** <@${interaction.user.id}> ( ${interaction.user.id} )\n` +
                `• **Role tác động:** <@&${targetRoleId}>\n\n` +
                `**Danh sách nhân sự:**\n` +
                successfulIds.map(id => `• <@${id}> ( ${id} )`).join("\n")
              );

            await logChannel.send({ embeds: [logEmbed] });

            // Gửi thêm 1 bản vào kênh #log-role tổng nếu kênh riêng khác kênh tổng
            if (config.roleLogChannelId && config.roleLogChannelId !== logChannelId) {
              const masterLogChannel = guild.channels.cache.get(config.roleLogChannelId)
                || await guild.channels.fetch(config.roleLogChannelId).catch(() => null);
              if (masterLogChannel) {
                await masterLogChannel.send({ embeds: [logEmbed] }).catch(() => null);
              }
            }
          }
        }
      } catch (logErr) {
        console.error("Lỗi khi gửi log role:", logErr.message);
      }
    }

    pendingSessions.delete(sessionId);
  }
}

module.exports = {
  getDepartments,
  buildDepartmentPanel,
  handleDepartmentInteraction
};
