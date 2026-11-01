const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const config = require("./config");
const { generalCommandBuilders } = require("./generalCommands");

const commands = [
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Gửi bảng xác thực (Verify) tài khoản Discord"),
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Tạo panel đăng ký whitelist")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("setup-guarantee")
    .setDescription("Tạo panel bảo lãnh whitelist")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Xem và sử dụng hệ thống whitelist")
    .addSubcommand(s =>
      s.setName("status").setDescription("Xem trạng thái whitelist của bạn")),
  new SlashCommandBuilder()
    .setName("test-welcome")
    .setDescription("Xem trước giao diện vé máy bay chào mừng thành viên")
    .addUserOption(opt =>
      opt.setName("user").setDescription("Thành viên muốn test (mặc định là bạn)").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("test-goodbye")
    .setDescription("Thử nghiệm gửi log tạm biệt (Goodbye log) đến kênh log tạm biệt")
    .addUserOption(opt =>
      opt.setName("user").setDescription("Thành viên muốn test (mặc định là bạn)").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("setup-roles")
    .setDescription("Tạo bảng cấp phát và thu hồi Role (Doanh nghiệp, Tổ chức, Đơn vị...)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("setup-tickets")
    .setDescription("Tạo bảng tạo ticket hỗ trợ người chơi đa danh mục")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("sync-nicknames")
    .setDescription("Đồng bộ tiền tố tên theo role (ADMIN / EMS / PD)")
    .addUserOption(opt =>
      opt.setName("user").setDescription("Thành viên cụ thể cần đồng bộ (để trống để quét toàn bộ server)").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),
  ...generalCommandBuilders
];

const rest = new REST({ version: "10" }).setToken(config.token);

(async () => {
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: commands.map(c => c.toJSON()) }
  );
  console.log(`Slash commands deployed to main guild (${config.guildId}).`);

  if (config.archiveGuildId && config.archiveGuildId !== config.guildId) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.archiveGuildId),
        { body: commands.map(c => c.toJSON()) }
      );
      console.log(`Slash commands deployed to archive guild (${config.archiveGuildId}).`);
    } catch (err) {
      console.log(`Could not deploy to archive guild (${config.archiveGuildId}):`, err.message);
    }
  }
})().catch(console.error);
