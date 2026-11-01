const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  AttachmentBuilder
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { query } = require("./db");
const { formatVietnameseDate } = require("./utils");
const EMOJIS = require("./emojis");

// Locks to prevent race conditions and duplicate messages on fast clicks
const closingTickets = new Set();
const reopeningTickets = new Set();

// Rate limit tracker for channel renames (Discord limits channel renames to 2 per 10 minutes)
const channelRenameTimestamps = new Map();

function canRenameChannel(channelId) {
  const now = Date.now();
  const list = (channelRenameTimestamps.get(channelId) || []).filter(t => now - t < 600000);
  channelRenameTimestamps.set(channelId, list);
  return list.length < 2;
}

function recordChannelRename(channelId) {
  const now = Date.now();
  const list = (channelRenameTimestamps.get(channelId) || []).filter(t => now - t < 600000);
  list.push(now);
  channelRenameTimestamps.set(channelId, list);
}

function getRenameWaitMs(channelId) {
  const now = Date.now();
  const list = (channelRenameTimestamps.get(channelId) || []).filter(t => now - t < 600000);
  if (list.length < 2) return 0;
  return Math.max(1000, 600000 - (now - list[0]) + 1000);
}

const TICKET_TYPES = [
  {
    id: "1",
    key: "mua_hang",
    label: "Mua Hàng",
    description: "ID: 1",
    emoji: EMOJIS.shop,
    categoryName: "ticket mua hàng",
    channelPrefix: "mua-hang",
    instruction: "Vui lòng cung cấp gói vật phẩm / quyền lợi bạn muốn ủng hộ hoặc gửi biên lai giao dịch để Ban Quản Trị đối soát và xử lý."
  },
  {
    id: "2",
    key: "to_cao",
    label: "Tố cáo",
    description: "ID: 2",
    emoji: EMOJIS.siren,
    categoryName: "ticket tố cáo",
    channelPrefix: "to-cao",
    instruction: "Vui lòng cung cấp ID người chơi vi phạm, thời gian cụ thể và liên kết video clip / hình ảnh bằng chứng rõ ràng."
  },
  {
    id: "3",
    key: "ho_tro",
    label: "Hỗ trợ",
    description: "ID: 3",
    emoji: EMOJIS.bug,
    categoryName: "ticket hỗ trợ",
    channelPrefix: "ho-tro",
    instruction: "Vui lòng mô tả chi tiết sự cố / lỗi kỹ thuật (bug) hoặc câu hỏi bạn cần giải đáp để Ban Quản Trị hỗ trợ sớm nhất."
  },
  {
    id: "4",
    key: "dau_thau",
    label: "Đấu thầu",
    description: "ID: 4",
    emoji: EMOJIS.gavel,
    categoryName: "đấu thầu",
    channelPrefix: "dau-thau",
    instruction: "Vui lòng cung cấp thông tin gói thầu, tài sản hoặc doanh nghiệp bạn muốn tham gia đấu giá / đấu thầu theo quy định."
  }
];

function buildTicketPanel() {
  const bannerGifPath = path.join(__dirname, "../assets/SWAG_RP_banner_connect.gif");
  const bannerPath = path.join(__dirname, "../assets/ticket_banner.png");
  const files = [];

  const embed = new EmbedBuilder()
    .setColor(0x00A8FF)
    .setTitle(`${EMOJIS.ticket} Trung Tâm Hỗ Trợ - ${config.serverName}`)
    .setDescription(
      `Chào mừng bạn đến với hệ thống hỗ trợ **${config.serverName}**!\n` +
      `Bấm nút **Tạo Ticket Hỗ Trợ** bên dưới và chọn danh mục phù hợp để gửi yêu cầu cho Ban Quản Trị.\n\n` +
      `📌 **Danh mục hỗ trợ:**\n` +
      `• ${EMOJIS.shop} **Mua Hàng & Donate:** Mua sắm vật phẩm & ủng hộ máy chủ.\n` +
      `• ${EMOJIS.siren} **Tố Cáo Vi Phạm:** Báo cáo hành vi vi phạm luật RP.\n` +
      `• ${EMOJIS.bug} **Báo Lỗi & Kỹ Thuật:** Hỗ trợ lỗi game & sự cố tài sản.\n` +
      `• ${EMOJIS.gavel} **Đấu Thầu & Doanh Nghiệp:** Đăng ký tài sản & đấu giá.\n\n` +
      `> ⚠️ *Vui lòng không spam ticket trùng lặp để được hỗ trợ nhanh nhất.*`
    );

  if (fs.existsSync(bannerGifPath)) {
    files.push(new AttachmentBuilder(bannerGifPath, { name: "SWAG_RP_banner_connect.gif" }));
    embed.setImage("attachment://SWAG_RP_banner_connect.gif");
  } else if (fs.existsSync(bannerPath)) {
    files.push(new AttachmentBuilder(bannerPath, { name: "ticket_banner.png" }));
    embed.setImage("attachment://ticket_banner.png");
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_action:open")
      .setLabel("Tạo Ticket Hỗ Trợ")
      .setStyle(ButtonStyle.Success)
      .setEmoji(EMOJIS.ticket)
  );

  return { embed, components: [row], files };
}

function buildCategorySelectMenu() {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("ticket_type_select")
    .setPlaceholder("Chọn loại hỗ trợ bạn cần...")
    .addOptions(
      TICKET_TYPES.map(t => ({
        label: t.label,
        value: t.key,
        description: t.description,
        emoji: EMOJIS.parse(t.emoji)
      }))
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);
  return [row];
}

async function getOrCreateCategory(guild, categoryName) {
  const normName = categoryName.toLowerCase();
  const matchingCategories = guild.channels.cache.filter(
    c => c.type === ChannelType.GuildCategory && c.name.toLowerCase().startsWith(normName)
  );

  // Tìm category còn chỗ (< 48 kênh, Discord tối đa 50 kênh/category)
  for (const [, cat] of matchingCategories) {
    const childCount = guild.channels.cache.filter(c => c.parentId === cat.id).size;
    if (childCount < 48) {
      return cat;
    }
  }

  // Nếu tất cả các category cùng loại đã đầy, tạo category tiếp theo (VD: ticket hỗ trợ #2)
  const count = matchingCategories.size;
  const newName = count > 0 ? `${categoryName} #${count + 1}` : categoryName;

  return await guild.channels.create({
    name: newName,
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      }
    ]
  });
}

async function getOrCreateClosedCategory(guild) {
  const matchingCategories = guild.channels.cache.filter(
    c => c.type === ChannelType.GuildCategory && (c.name.toLowerCase().includes("ticket-đóng") || c.name.toLowerCase().includes("ticket đã đóng"))
  );

  // Tìm category ticket-đóng còn chỗ (< 48 kênh)
  for (const [, cat] of matchingCategories) {
    const childCount = guild.channels.cache.filter(c => c.parentId === cat.id).size;
    if (childCount < 48) {
      return cat;
    }
  }

  const count = matchingCategories.size;
  const newName = count > 0 ? `ticket-đóng #${count + 1}` : "ticket-đóng";

  return await guild.channels.create({
    name: newName,
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      }
    ]
  });
}

function isStaffOrAdmin(member) {
  if (!member) return false;
  if (
    member.permissions?.has(PermissionFlagsBits.Administrator) ||
    member.permissions?.has(PermissionFlagsBits.ManageChannels) ||
    member.permissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    return true;
  }
  if (config.staffRoleId && member.roles?.cache?.has(config.staffRoleId)) {
    return true;
  }
  return false;
}

async function handleTicketInteraction(interaction) {
  // 1. Click "Tạo Ticket Hỗ Trợ" button on Panel
  if (interaction.isButton() && interaction.customId === "ticket_action:open") {
    const components = buildCategorySelectMenu();
    return interaction.reply({
      content: "Vui lòng chọn loại yêu cầu hỗ trợ mà bạn cần trợ giúp bên dưới:",
      components,
      ephemeral: true
    });
  }

  // 2. Select category from StringSelectMenu -> Show Modal Popup
  if (interaction.isStringSelectMenu() && interaction.customId === "ticket_type_select") {
    const selectedKey = interaction.values[0];
    const ticketType = TICKET_TYPES.find(t => t.key === selectedKey);

    if (!ticketType) {
      return interaction.reply({ content: "❌ Loại hỗ trợ không hợp lệ.", ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId(`ticket_modal:${ticketType.key}`)
      .setTitle("📩 Mô tả yêu cầu hỗ trợ");

    const descInput = new TextInputBuilder()
      .setCustomId("ticket_description")
      .setLabel("Mô tả sơ lược nội dung cần hỗ trợ:")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("VD: Tôi muốn báo cáo người chơi vi phạm RDM lúc 20h tối qua...")
      .setRequired(true)
      .setMaxLength(1000);

    modal.addComponents(new ActionRowBuilder().addComponents(descInput));

    return await interaction.showModal(modal);
  }

  // 3. Submit Modal -> Create Channel & Post Embed matching Screenshot
  if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket_modal:")) {
    const selectedKey = interaction.customId.split(":")[1];
    const ticketType = TICKET_TYPES.find(t => t.key === selectedKey);

    if (!ticketType) {
      return interaction.reply({ content: "❌ Loại hỗ trợ không hợp lệ.", ephemeral: true });
    }

    const userDesc = interaction.fields.getTextInputValue("ticket_description") || "Không có mô tả.";

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const user = interaction.user;

    // Check all open tickets for this user & category
    const activeTickets = await query(
      "SELECT * FROM tickets WHERE discord_id = ? AND ticket_type = ? AND status = 'open' ORDER BY id ASC",
      [user.id, ticketType.key]
    ).catch(() => []);

    const validActiveTickets = [];
    for (const t of activeTickets) {
      const existingChannel = guild.channels.cache.get(t.channel_id)
        || await guild.channels.fetch(t.channel_id).catch(() => null);
      if (existingChannel) {
        validActiveTickets.push({ ...t, channel: existingChannel });
      } else {
        await query("UPDATE tickets SET status = 'closed', closed_at = NOW() WHERE id = ?", [t.id]).catch(() => null);
      }
    }

    // Check if there is any unpinned ticket in this category
    const unpinnedTicket = validActiveTickets.find(t => !t.is_pinned || t.is_pinned === 0);
    if (unpinnedTicket) {
      return interaction.editReply({
        content: `⚠️ Bạn đã có 1 ticket **${ticketType.label}** đang mở tại <#${unpinnedTicket.channel_id}> chưa được Admin ghim xử lý.\n` +
          `• Bạn chỉ có thể tạo thêm ticket thứ 2 ở mục này khi ticket hiện tại được **Ban Quản Trị / Admin ghim**!`
      });
    }

    try {
      // Kiểm tra an toàn ngưỡng giới hạn 500 kênh của Discord
      if (guild.channels.cache.size >= 485) {
        return interaction.editReply({
          content: "⚠️ Máy chủ Discord hiện đã gần đạt mức tối đa 500 kênh cho phép. Vui lòng báo Ban Quản Trị dọn dẹp các kênh cũ trước khi mở thêm ticket mới."
        });
      }

      // Find or create category
      const category = await getOrCreateCategory(guild, ticketType.categoryName);

      // Clean username for channel name
      const sanitizedUsername = user.username.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 15) || user.id.slice(-4);
      let baseChannelName = `${ticketType.channelPrefix}-${sanitizedUsername}`;
      let channelName = baseChannelName;

      // If user already has existing channel(s) with this name, add number suffix (e.g. mua-hang-gakon_05-2)
      if (validActiveTickets.length > 0) {
        let counter = validActiveTickets.length + 1;
        channelName = `${baseChannelName}-${counter}`;
        while (guild.channels.cache.some(c => c.name === channelName && !c.name.startsWith("closed-"))) {
          counter++;
          channelName = `${baseChannelName}-${counter}`;
        }
      }

      // Channel permissions
      const permissionOverwrites = [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.EmbedLinks
          ]
        },
        {
          id: guild.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ManageChannels
          ]
        }
      ];

      if (config.staffRoleId) {
        permissionOverwrites.push({
          id: config.staffRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.EmbedLinks
          ]
        });
      }

      // Create ticket channel with topic
      const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `owner=${user.id}; createdAt=${Date.now()}; srcCat=${category.id}`,
        permissionOverwrites
      });

      // Save to DB
      const result = await query(
        "INSERT INTO tickets (ticket_type, channel_id, discord_id, status, is_pinned) VALUES (?, ?, ?, 'open', 0)",
        [ticketType.key, ticketChannel.id, user.id]
      );
      const ticketId = result.insertId;

      const nowVn = formatVietnameseDate(new Date());

      // Welcome message in ticket channel matching Screenshot 2 & 3
      const ticketEmbed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle(`${EMOJIS.pin} Yêu cầu Hỗ trợ mới`)
        .setDescription(
          `Trạng thái: **Đang xử lý** | Tự động đóng nếu không hoạt động (Cảnh báo sau **24 giờ**).\n` +
          `Ban Quản Trị đã nhận được thông tin từ bạn. Vui lòng cập nhật chi tiết yêu cầu bên dưới.\n\n` +
          `👤 **Người mở:** <@${user.id}>\n` +
          `🕒 **Thời gian:** ${nowVn}\n` +
          `📁 **Loại:** ${ticketType.emoji} ${ticketType.label}\n` +
          `📝 **Mô tả:** ${userDesc}`
        )
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .setFooter({ text: `${config.serverName} Ticket System • ID #${ticketId}` });

      const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_action:close:${ticketId}`)
          .setLabel("Yêu cầu đóng ticket")
          .setStyle(ButtonStyle.Danger)
          .setEmoji(EMOJIS.lock),
        new ButtonBuilder()
          .setCustomId(`ticket_action:pin:${ticketId}`)
          .setLabel("Ghim ticket")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(EMOJIS.pin),
        new ButtonBuilder()
          .setCustomId(`ticket_action:unpin:${ticketId}`)
          .setLabel("Bỏ ghim")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(EMOJIS.unlock)
      );

      await ticketChannel.send({
        embeds: [ticketEmbed],
        components: [buttonRow]
      });

      // Send log creation
      sendTicketLog(guild, {
        title: "🎫 Ticket Mới Được Tạo",
        color: 0x57F287,
        fields: [
          { name: "👤 Người tạo", value: `<@${user.id}> ( ${user.id} )`, inline: true },
          { name: "📁 Danh mục", value: `${ticketType.label}`, inline: true },
          { name: "💬 Kênh", value: `<#${ticketChannel.id}>`, inline: true },
          { name: "📝 Mô tả", value: userDesc.slice(0, 1024), inline: false }
        ]
      });

      return interaction.editReply({
        content: `✅ Đã tạo ticket hỗ trợ thành công! Vui lòng chuyển đến kênh: <#${ticketChannel.id}>`
      });
    } catch (err) {
      console.error("Lỗi khi tạo ticket:", err);
      return interaction.editReply({
        content: `❌ Đã có lỗi xảy ra khi tạo ticket: ${err.message}`
      });
    }
  }

  // 4. Pin ticket message
  if (interaction.isButton() && interaction.customId.startsWith("ticket_action:pin:")) {
    if (!isStaffOrAdmin(interaction.member)) {
      return interaction.reply({
        content: "❌ Chỉ Quản trị viên (Admin) hoặc Ban Quản Trị mới có quyền ghim ticket!",
        ephemeral: true
      });
    }

    const ticketId = interaction.customId.split(":")[2];
    const channel = interaction.channel;
    const guild = interaction.guild;

    const tickets = await query("SELECT * FROM tickets WHERE id = ? LIMIT 1", [ticketId]).catch(() => []);
    const ticket = tickets[0] || (await query("SELECT * FROM tickets WHERE channel_id = ? ORDER BY id DESC LIMIT 1", [channel.id]).catch(() => []))[0];

    if (ticket && ticket.is_pinned === 1) {
      return interaction.reply({ content: "📌 Ticket này đã được ghim trước đó rồi!", ephemeral: true });
    }

    try {
      await interaction.message.pin().catch(() => null);

      if (ticket) {
        await query("UPDATE tickets SET is_pinned = 1, pinned_by = ? WHERE id = ?", [interaction.user.id, ticket.id]).catch(() => null);
      }

      const userMention = ticket?.discord_id ? `<@${ticket.discord_id}>` : "Người dùng";
      await interaction.reply({
        content: `📌 **Ticket đã được ghim bởi <@${interaction.user.id}>!**\n> ${userMention} hiện có thể tạo thêm ticket thứ 2 trong danh mục này nếu cần hỗ trợ.`
      });

      if (ticket) {
        const typeConfig = TICKET_TYPES.find(t => t.key === ticket.ticket_type);
        sendTicketLog(guild, {
          title: "📌 Ticket Đã Được Ghim",
          color: 0xFEE75C,
          fields: [
            { name: "🎫 Mã Ticket", value: `#${ticket.id} (${typeConfig ? typeConfig.label : ticket.ticket_type})`, inline: true },
            { name: "🛡️ Người ghim", value: `<@${interaction.user.id}>`, inline: true },
            { name: "👤 Chủ ticket", value: `<@${ticket.discord_id}>`, inline: true },
            { name: "📁 Kênh", value: `<#${channel.id}>`, inline: true },
            { name: "⏱️ Thời điểm", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
          ]
        });
      }
    } catch (err) {
      console.error("Lỗi khi ghim ticket:", err);
      return interaction.reply({ content: `❌ Có lỗi xảy ra khi ghim ticket: ${err.message}`, ephemeral: true });
    }
    return;
  }

  // 5. Unpin ticket message
  if (interaction.isButton() && interaction.customId.startsWith("ticket_action:unpin:")) {
    if (!isStaffOrAdmin(interaction.member)) {
      return interaction.reply({
        content: "❌ Chỉ Quản trị viên (Admin) hoặc Ban Quản Trị mới có quyền bỏ ghim ticket!",
        ephemeral: true
      });
    }

    const ticketId = interaction.customId.split(":")[2];
    const channel = interaction.channel;
    const guild = interaction.guild;

    const tickets = await query("SELECT * FROM tickets WHERE id = ? LIMIT 1", [ticketId]).catch(() => []);
    const ticket = tickets[0] || (await query("SELECT * FROM tickets WHERE channel_id = ? ORDER BY id DESC LIMIT 1", [channel.id]).catch(() => []))[0];

    try {
      await interaction.message.unpin().catch(() => null);

      if (ticket) {
        await query("UPDATE tickets SET is_pinned = 0, pinned_by = NULL WHERE id = ?", [ticket.id]).catch(() => null);
      }

      await interaction.reply({
        content: `🔓 **Ticket đã được bỏ ghim bởi <@${interaction.user.id}>.**`
      });

      if (ticket) {
        const typeConfig = TICKET_TYPES.find(t => t.key === ticket.ticket_type);
        sendTicketLog(guild, {
          title: "🔓 Ticket Đã Bỏ Ghim",
          color: 0x95A5A6,
          fields: [
            { name: "🎫 Mã Ticket", value: `#${ticket.id} (${typeConfig ? typeConfig.label : ticket.ticket_type})`, inline: true },
            { name: "🛡️ Người bỏ ghim", value: `<@${interaction.user.id}>`, inline: true },
            { name: "👤 Chủ ticket", value: `<@${ticket.discord_id}>`, inline: true },
            { name: "📁 Kênh", value: `<#${channel.id}>`, inline: true },
            { name: "⏱️ Thời điểm", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
          ]
        });
      }
    } catch (err) {
      console.error("Lỗi khi bỏ ghim ticket:", err);
      return interaction.reply({ content: `❌ Có lỗi xảy ra khi bỏ ghim ticket: ${err.message}`, ephemeral: true });
    }
    return;
  }

  // 6. Click "Yêu cầu đóng ticket" -> Confirmation Dialog
  if (interaction.isButton() && interaction.customId.startsWith("ticket_action:close:")) {
    const ticketId = interaction.customId.split(":")[2];
    const tickets = await query("SELECT * FROM tickets WHERE id = ? LIMIT 1", [ticketId]).catch(() => []);
    const ticket = tickets[0];

    if (ticket && ticket.status === "closed") {
      return interaction.reply({ content: "⚠️ Ticket này đã được đóng trước đó rồi!", ephemeral: true });
    }

    // Delete any existing confirmation dialog in this channel first
    const existingMessages = await interaction.channel.messages.fetch({ limit: 10 }).catch(() => null);
    if (existingMessages) {
      for (const msg of existingMessages.values()) {
        if (msg.embeds?.[0]?.title?.includes("Xác Nhận Đóng Ticket")) {
          await msg.delete().catch(() => null);
        }
      }
    }

    const confirmEmbed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle(`${EMOJIS.lock} Xác Nhận Đóng Ticket`)
      .setDescription(
        "Bạn có chắc chắn muốn đóng ticket này không?\n" +
        "• Thao tác này sẽ lưu lại toàn bộ tin nhắn và chuyển kênh vào danh mục **ticket-đóng**."
      );

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_action:confirm_close:${ticketId}`)
        .setLabel("Xác nhận đóng")
        .setStyle(ButtonStyle.Danger)
        .setEmoji(EMOJIS.verify),
      new ButtonBuilder()
        .setCustomId(`ticket_action:cancel_close:${ticketId}`)
        .setLabel("Hủy bỏ")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(EMOJIS.reject)
    );

    return interaction.reply({ embeds: [confirmEmbed], components: [confirmRow] });
  }

  // 7. Cancel close
  if (interaction.isButton() && interaction.customId.startsWith("ticket_action:cancel_close:")) {
    return interaction.message.delete().catch(() => null);
  }

  // 8. Confirm close -> Move to ticket-đóng and send notice
  if (interaction.isButton() && interaction.customId.startsWith("ticket_action:confirm_close:")) {
    const ticketId = interaction.customId.split(":")[2];
    await interaction.deferUpdate().catch(() => null);

    const channel = interaction.channel;
    const guild = interaction.guild;
    const user = interaction.user;

    if (closingTickets.has(ticketId)) {
      await interaction.message?.delete().catch(() => null);
      return;
    }
    closingTickets.add(ticketId);
    reopeningTickets.delete(ticketId);

    try {
      // Fetch ticket from DB
      const tickets = await query("SELECT * FROM tickets WHERE id = ? LIMIT 1", [ticketId]).catch(() => []);
      const ticket = tickets[0];

      if (ticket && ticket.status === "closed") {
        await interaction.message?.delete().catch(() => null);
        return;
      }

      // Tìm hoặc tạo category "ticket-đóng" còn slot (< 48 kênh)
      const closedCategory = await getOrCreateClosedCategory(guild);

      // Move channel to category "ticket-đóng" (only if not already in category)
      if (channel.parentId !== closedCategory.id) {
        await channel.setParent(closedCategory.id, { lockPermissions: false }).catch(err => {
          console.error("Lỗi setParent sang ticket-đóng:", err.message);
        });
      }

      // Lock user's sending permissions (read-only history)
      if (ticket?.discord_id) {
        await channel.permissionOverwrites.edit(ticket.discord_id, {
          SendMessages: false,
          ViewChannel: true,
          ReadMessageHistory: true,
          AttachFiles: false
        }).catch(() => null);
      }

      // Update DB to closed
      await query(
        "UPDATE tickets SET status = 'closed', closed_at = NOW(), closed_by = ? WHERE id = ?",
        [user.id, ticketId]
      ).catch(err => console.error("Lỗi update DB sang closed:", err.message));

      // Delete the confirmation dialog
      await interaction.message?.delete().catch(() => null);

      // Post Close Notice Embed matching screenshot
      const nowVn = formatVietnameseDate(new Date());
      const closeNoticeEmbed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle(`${EMOJIS.lock} Thông báo đóng Ticket`)
        .setDescription(
          `Bạn có thể chọn **Mở lại ticket** trong vòng **24 giờ** bằng nút chức năng bên dưới.\n\n` +
          `• **Lý do:** Đóng bởi người dùng\n` +
          `• **Thời điểm đóng:** ${nowVn}\n` +
          `• **Hạn mở lại (Reopen):** trong vòng 24 giờ`
        );

      const closedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_action:reopen:${ticketId}`)
          .setLabel("Mở lại ticket")
          .setStyle(ButtonStyle.Success)
          .setEmoji(EMOJIS.unlock),
        new ButtonBuilder()
          .setCustomId(`ticket_action:delete_perm:${ticketId}`)
          .setLabel("Đóng hẳn ticket")
          .setStyle(ButtonStyle.Danger)
          .setEmoji(EMOJIS.trash)
      );

      await channel.send({ embeds: [closeNoticeEmbed], components: [closedRow] });

      // Send log into #log-ticket
      if (ticket) {
        const typeConfig = TICKET_TYPES.find(t => t.key === ticket.ticket_type);
        sendTicketLog(guild, {
          title: "🔒 Ticket Đã Đóng (Chuyển vào ticket-đóng)",
          color: 0xED4245,
          fields: [
            { name: "🎫 Mã Ticket", value: `#${ticketId} (${typeConfig ? typeConfig.label : ticket.ticket_type})`, inline: true },
            { name: "👤 Người tạo", value: `<@${ticket.discord_id}>`, inline: true },
            { name: "🛡️ Người đóng", value: `<@${user.id}>`, inline: true },
            { name: "📁 Kênh", value: `<#${channel.id}>`, inline: true },
            { name: "⏱️ Thời điểm đóng", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
          ]
        });
      }

      // Rename channel with closed- prefix (respecting Discord 2 renames/10m rate limit to protect REST queue)
      const currentName = channel.name.replace(/^closed-/, "");
      if (!channel.name.startsWith("closed-")) {
        if (canRenameChannel(channel.id)) {
          recordChannelRename(channel.id);
          channel.setName(`closed-${currentName}`).catch(err => {
            console.warn(`[Ticket #${ticketId}] Không thể đổi tên kênh:`, err.message);
          });
        } else {
          const waitMs = getRenameWaitMs(channel.id);
          console.warn(`[Ticket #${ticketId}] Kênh bị giới hạn đổi tên (2 lần/10 phút của Discord). Sẽ tự động đổi tên thành closed-${currentName} sau ${Math.round(waitMs / 1000)}s`);
          setTimeout(async () => {
            try {
              const ch = await guild.channels.fetch(channel.id).catch(() => null);
              if (!ch) return;
              const rows = await query("SELECT status FROM tickets WHERE id = ? LIMIT 1", [ticketId]).catch(() => []);
              if (rows[0]?.status === "closed" && !ch.name.startsWith("closed-")) {
                recordChannelRename(ch.id);
                const clean = ch.name.replace(/^closed-/, "");
                await ch.setName(`closed-${clean}`).catch(() => null);
              }
            } catch (e) {}
          }, waitMs);
        }
      }
    } catch (err) {
      console.error("Lỗi khi chuyển ticket sang ticket-đóng:", err);
      await channel.send({ content: `❌ Có lỗi khi chuyển ticket vào ticket-đóng: ${err.message}` }).catch(() => null);
    } finally {
      setTimeout(() => closingTickets.delete(ticketId), 1500);
    }
  }

  // 9. Reopen ticket
  if (interaction.isButton() && interaction.customId.startsWith("ticket_action:reopen:")) {
    const ticketId = interaction.customId.split(":")[2];
    await interaction.deferUpdate().catch(() => null);

    const channel = interaction.channel;
    const guild = interaction.guild;

    if (reopeningTickets.has(ticketId)) {
      return;
    }
    reopeningTickets.add(ticketId);
    closingTickets.delete(ticketId);

    try {
      const tickets = await query("SELECT * FROM tickets WHERE id = ? LIMIT 1", [ticketId]).catch(() => []);
      const ticket = tickets[0];

      if (ticket && ticket.status === "open") {
        return;
      }

      const typeConfig = ticket ? TICKET_TYPES.find(t => t.key === ticket.ticket_type) : null;
      const originalCategoryName = typeConfig ? typeConfig.categoryName : "ticket hỗ trợ";

      // Find or create original category
      const originalCategory = await getOrCreateCategory(guild, originalCategoryName);

      // Move channel back to original category (only if not already there)
      if (channel.parentId !== originalCategory.id) {
        await channel.setParent(originalCategory.id, { lockPermissions: false }).catch(err => {
          console.error("Lỗi setParent khi mở lại:", err.message);
        });
      }

      // Restore user's permissions
      if (ticket?.discord_id) {
        await channel.permissionOverwrites.edit(ticket.discord_id, {
          SendMessages: true,
          ViewChannel: true,
          ReadMessageHistory: true,
          AttachFiles: true,
          EmbedLinks: true
        }).catch(() => null);
      }

      // Update DB to open
      await query(
        "UPDATE tickets SET status = 'open', closed_at = NULL, closed_by = NULL, is_pinned = 0, pinned_by = NULL WHERE id = ?",
        [ticketId]
      ).catch(err => console.error("Lỗi update DB khi mở lại:", err.message));

      // Remove the close notice message
      await interaction.message?.delete().catch(() => null);

      const nowVn = formatVietnameseDate(new Date());
      const reopenEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(`${EMOJIS.unlock} Ticket Đã Được Mở Lại`)
        .setDescription(
          `Chào mừng <@${ticket?.discord_id || interaction.user.id}> quay lại! Ticket này đã được mở lại bởi <@${interaction.user.id}>.\n\n` +
          `• **Trạng thái:** Đang xử lý\n` +
          `• **Thời gian mở lại:** ${nowVn}\n` +
          `• **Danh mục:** ${typeConfig ? typeConfig.emoji : EMOJIS.ticket} ${typeConfig ? typeConfig.label : "Hỗ trợ"}\n\n` +
          `Ban Quản Trị và bạn có thể tiếp tục trao đổi tại đây.\n` +
          `Khi yêu cầu hoàn tất, vui lòng nhấn nút **Yêu cầu đóng ticket** bên dưới.`
        )
        .setFooter({ text: `${config.serverName} Ticket System • ID #${ticketId}` });

      const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_action:close:${ticketId}`)
          .setLabel("Yêu cầu đóng ticket")
          .setStyle(ButtonStyle.Danger)
          .setEmoji(EMOJIS.lock),
        new ButtonBuilder()
          .setCustomId(`ticket_action:pin:${ticketId}`)
          .setLabel("Ghim ticket")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(EMOJIS.pin),
        new ButtonBuilder()
          .setCustomId(`ticket_action:unpin:${ticketId}`)
          .setLabel("Bỏ ghim")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(EMOJIS.unlock)
      );

      await channel.send({
        embeds: [reopenEmbed],
        components: [buttonRow]
      });

      // Send log
      sendTicketLog(guild, {
        title: "🔓 Ticket Đã Mở Lại",
        color: 0x57F287,
        fields: [
          { name: "🎫 Mã Ticket", value: `#${ticketId} (${typeConfig ? typeConfig.label : ticket?.ticket_type})`, inline: true },
          { name: "👤 Người mở lại", value: `<@${interaction.user.id}>`, inline: true },
          { name: "📁 Kênh", value: `<#${channel.id}>`, inline: true },
          { name: "⏱️ Thời điểm mở", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
        ]
      });

      // Rename channel back to clean name (respecting Discord 2 renames/10m rate limit)
      const cleanName = channel.name.replace(/^closed-/, "");
      if (channel.name.startsWith("closed-")) {
        if (canRenameChannel(channel.id)) {
          recordChannelRename(channel.id);
          channel.setName(cleanName).catch(err => {
            console.warn(`[Ticket #${ticketId}] Không thể đổi tên kênh khi mở lại:`, err.message);
          });
        } else {
          const waitMs = getRenameWaitMs(channel.id);
          console.warn(`[Ticket #${ticketId}] Kênh bị giới hạn đổi tên (2 lần/10 phút của Discord). Sẽ tự động đổi tên thành ${cleanName} sau ${Math.round(waitMs / 1000)}s`);
          setTimeout(async () => {
            try {
              const ch = await guild.channels.fetch(channel.id).catch(() => null);
              if (!ch) return;
              const rows = await query("SELECT status FROM tickets WHERE id = ? LIMIT 1", [ticketId]).catch(() => []);
              if (rows[0]?.status === "open" && ch.name.startsWith("closed-")) {
                recordChannelRename(ch.id);
                const clean = ch.name.replace(/^closed-/, "");
                await ch.setName(clean).catch(() => null);
              }
            } catch (e) {}
          }, waitMs);
        }
      }
    } catch (err) {
      console.error("Lỗi khi mở lại ticket:", err);
      return channel.send({ content: `❌ Lỗi khi mở lại ticket: ${err.message}` }).catch(() => null);
    } finally {
      setTimeout(() => reopeningTickets.delete(ticketId), 1500);
    }
  }

  // 10. Delete permanently
  if (interaction.isButton() && interaction.customId.startsWith("ticket_action:delete_perm:")) {
    const channel = interaction.channel;
    const ticketId = interaction.customId.split(":")[2];

    await interaction.reply({
      content: `${EMOJIS.trash} **Ticket đang được đóng vĩnh viễn và kênh sẽ bị xóa sau 3 giây...**`
    });

    const tickets = await query("SELECT * FROM tickets WHERE id = ? LIMIT 1", [ticketId]).catch(() => []);
    const ticket = tickets[0];
    const typeConfig = ticket ? TICKET_TYPES.find(t => t.key === ticket.ticket_type) : null;

    sendTicketLog(interaction.guild, {
      title: `${EMOJIS.trash} Ticket Đã Bị Xóa Vĩnh Viễn`,
      color: 0xED4245,
      fields: [
        { name: "🎫 Mã Ticket", value: `#${ticketId} (${typeConfig ? typeConfig.label : ticket?.ticket_type || ""})`, inline: true },
        { name: "🛡️ Người xóa", value: `<@${interaction.user.id}>`, inline: true },
        { name: "📁 Tên kênh", value: `#${channel.name}`, inline: true },
        { name: "⏱️ Thời điểm xóa", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
      ]
    });

    setTimeout(() => {
      channel.delete("Ticket permanently deleted").catch(err => {
        console.error("Lỗi khi xóa kênh ticket vĩnh viễn:", err.message);
      });
    }, 3000);
  }
}

async function sendTicketLog(guild, { title, color, fields }) {
  try {
    const logChannelId = config.ticketLogChannelId || config.roleLogChannelId;
    if (!logChannelId) return;

    const logChannel = guild.channels.cache.get(logChannelId)
      || await guild.channels.fetch(logChannelId).catch(() => null);

    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor(color || 0x2b2d31)
        .setTitle(title)
        .addFields(fields)
        .setTimestamp();

      await logChannel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error("Lỗi khi gửi log ticket:", err.message);
  }
}

/**
 * Tự động kiểm tra và dọn dẹp các ticket đã đóng trong category "ticket-đóng"
 * nếu không có hoạt động trong vòng 15 ngày.
 */
function startTicketCleanupScheduler(client) {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  async function checkAndClean() {
    try {
      const guild = client.guilds.cache.get(config.guildId)
        || await client.guilds.fetch(config.guildId).catch(() => null);

      if (!guild) return;

      const closedCategories = guild.channels.cache.filter(
        c => c.type === ChannelType.GuildCategory && (c.name.toLowerCase().includes("ticket-đóng") || c.name.toLowerCase().includes("ticket đã đóng"))
      );

      if (closedCategories.size === 0) return;

      const now = Date.now();

      for (const [, cat] of closedCategories) {
        const channels = guild.channels.cache.filter(
          c => c.type === ChannelType.GuildText && (c.parentId === cat.id || c.name.startsWith("closed-"))
        );

        for (const [, ch] of channels) {
          try {
            const lastMessages = await ch.messages.fetch({ limit: 1 }).catch(() => null);
            const lastMsg = lastMessages?.first();
            const lastActivityTime = lastMsg ? lastMsg.createdTimestamp : ch.createdTimestamp;

            if (now - lastActivityTime >= SEVEN_DAYS_MS) {
              console.log(`[Ticket Cleanup] Kênh ${ch.name} không hoạt động hơn 7 ngày, đang xóa tự động...`);

              await ch.delete("Tự động xóa ticket đã đóng sau 7 ngày không hoạt động").catch(() => null);

              sendTicketLog(guild, {
                title: "🗑️ Ticket Tự Động Xóa (Hết Hạn 7 Ngày)",
                color: 0xED4245,
                fields: [
                  { name: "📁 Tên kênh", value: `#${ch.name}`, inline: true },
                  { name: "⏱️ Thời gian không hoạt động", value: "> 7 ngày", inline: true },
                  { name: "📅 Thời điểm xóa", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                ]
              });
            }
          } catch (chErr) {
            console.error(`Lỗi kiểm tra kênh ${ch.name}:`, chErr.message);
          }
        }

        // Nếu category phụ (có đánh số #) đã hết sạch kênh thì tự động xóa để tránh lãng phí channel limit
        if (cat.name.includes("#")) {
          const remaining = guild.channels.cache.filter(c => c.parentId === cat.id).size;
          if (remaining === 0) {
            await cat.delete("Dọn dẹp category ticket-đóng trống").catch(() => null);
          }
        }
      }
    } catch (err) {
      console.error("Lỗi khi chạy ticket cleanup scheduler:", err.message);
    }
  }

  // Chạy ngay khi khởi động
  checkAndClean();

  // Chạy định kỳ mỗi 1 giờ
  setInterval(checkAndClean, 60 * 60 * 1000);
}

module.exports = {
  TICKET_TYPES,
  buildTicketPanel,
  handleTicketInteraction,
  startTicketCleanupScheduler
};
