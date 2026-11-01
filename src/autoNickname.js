const { PermissionFlagsBits } = require("discord.js");
const config = require("./config");

/**
 * CẤU HÌNH ROLE & PREFIX TỰ ĐỘNG ĐỔI TÊN
 * Các role được xếp theo thứ tự ưu tiên từ trên xuống dưới.
 * Nếu một người có nhiều role thì prefix của role ưu tiên cao nhất sẽ được áp dụng.
 * 
 * Bạn có thể dễ dàng thêm các role Doanh nghiệp khác (Taxi, Cứu hộ, Gara, Nhà hàng...) vào mảng này.
 */
const ROLE_PREFIX_RULES = [
  {
    key: "admin",
    name: "Admin / Quản Trị Viên",
    prefix: "ADMIN | ",
    // Lấy ID từ ADMIN_ROLE_ID hoặc STAFF_ROLE_ID
    getRoleIds: () => [config.adminRoleId, config.staffRoleId, "1505290260735594557"].filter(Boolean),
    checkPermission: true // Thành viên có quyền Administrator cũng tự động được tính
  },
  {
    key: "ems",
    name: "Bác Sĩ / Cứu Thương",
    prefix: "EMS | ",
    getRoleIds: () => [
      config.medicRoleId,
      config.medicManagerRoleId,
      process.env.MEDIC_ROLE_ID,
      process.env.MEDIC_MANAGER_ROLE_ID,
      "1552273274644340747",
      "1552273272140341265"
    ].filter(Boolean)
  },
  {
    key: "pd",
    name: "Cảnh Sát / Police",
    prefix: "PD | ",
    getRoleIds: () => [
      config.policeRoleId,
      config.policeManagerRoleId,
      process.env.POLICE_ROLE_ID,
      process.env.POLICE_MANAGER_ROLE_ID,
      "1552273270278062100",
      "1552273268147232830"
    ].filter(Boolean)
  },
  {
    key: "cardealer",
    name: "Car Dealer / Bán Xe",
    prefix: "CDL | ",
    getRoleIds: () => [
      config.cardealerRoleId,
      config.cardealerManagerRoleId,
      process.env.CARDEALER_ROLE_ID,
      process.env.CARDEALER_MANAGER_ROLE_ID,
      "1553662004970127440",
      "1540617259897069696"
    ].filter(Boolean)
  }
  // ==========================================
  // THÊM ROLE DOANH NGHIỆP TẠI ĐÂY:
  // Ví dụ:
  // {
  //   key: "taxi",
  //   name: "Taxi",
  //   prefix: "TAXI | ",
  //   getRoleIds: () => [process.env.TAXI_ROLE_ID].filter(Boolean)
  // },
  // {
  //   key: "mechanic",
  //   name: "Cứu Hộ / Sửa Xe",
  //   prefix: "GARA | ",
  //   getRoleIds: () => [process.env.MECHANIC_ROLE_ID].filter(Boolean)
  // }
  // ==========================================
];

/**
 * Tách lấy tên gốc (bỏ đi các tiền tố như "ADMIN | ", "EMS | ", "PD | ", v.v.)
 */
function extractBaseName(name) {
  if (!name) return "";
  let cleaned = name.trim();
  // Xóa các tiền tố dạng TAG | liên tiếp nếu có
  while (/^[A-Za-z0-9_\s\u00C0-\u024F\u1E00-\u1EFF]{2,12}\s*\|\s*/i.test(cleaned)) {
    cleaned = cleaned.replace(/^[A-Za-z0-9_\s\u00C0-\u024F\u1E00-\u1EFF]{2,12}\s*\|\s*/i, "").trim();
  }
  return cleaned || name.trim();
}

/**
 * Xác định Nickname mục tiêu cho thành viên dựa trên role họ đang giữ
 */
function determineTargetNickname(member) {
  if (!member) return null;

  // 1. Tìm rule role ưu tiên cao nhất mà member đang sở hữu
  let matchedRule = null;
  for (const rule of ROLE_PREFIX_RULES) {
    if (rule.checkPermission && member.permissions?.has(PermissionFlagsBits.Administrator)) {
      matchedRule = rule;
      break;
    }

    const roleIds = rule.getRoleIds();
    const hasRole = roleIds.some(rId => member.roles?.cache?.has(rId));
    if (hasRole) {
      matchedRule = rule;
      break;
    }
  }

  // 2. Lấy tên gốc của member (ưu tiên nickname hiện tại đã bỏ prefix, hoặc username/displayName)
  const currentNick = member.nickname;
  const rawBaseName = extractBaseName(currentNick || member.user?.displayName || member.user?.username || "Thành viên");

  // 3. Nếu có role cần gắn prefix
  if (matchedRule) {
    const prefix = matchedRule.prefix;
    const maxBaseLen = 32 - prefix.length;
    const safeBaseName = rawBaseName.length > maxBaseLen ? rawBaseName.substring(0, maxBaseLen) : rawBaseName;
    return `${prefix}${safeBaseName}`;
  }

  // 4. Nếu không còn role prefix nào, nhưng hiện tại nickname đang có tiền tố (ví dụ bị gỡ role) -> trả về tên gốc
  if (currentNick) {
    const cleanNick = extractBaseName(currentNick);
    if (cleanNick !== currentNick) {
      // Nếu tên gốc trùng với username/displayName mặc định thì reset về null để dùng mặc định
      return cleanNick === (member.user?.displayName || member.user?.username) ? null : cleanNick;
    }
  }

  return undefined; // Không cần thay đổi
}

const recentBotNicknameChanges = new Map();

function isRecentBotNicknameChange(memberId) {
  if (!memberId) return false;
  const ts = recentBotNicknameChanges.get(memberId);
  if (!ts) return false;
  if (Date.now() - ts < 15000) return true;
  recentBotNicknameChanges.delete(memberId);
  return false;
}

/**
 * Cập nhật Nickname cho 1 thành viên an toàn, xử lý quyền hạn Discord
 */
async function syncMemberNickname(member, reason = "Tự động đổi tên theo Role") {
  if (!member || !member.guild) return { success: false, reason: "Thành viên không hợp lệ" };
  if (member.user?.bot) return { success: false, reason: "Bỏ qua tài khoản Bot" };

  // Chủ server Discord (Guild Owner) không cho phép bất kỳ Bot nào đổi tên
  if (member.id === member.guild.ownerId) {
    return { success: false, reason: "Chủ Server (Discord cấm bot đổi tên Owner)" };
  }

  // Kiểm tra quyền hạn của Bot
  const botMember = member.guild.members.me || await member.guild.members.fetchMe().catch(() => null);
  if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) {
    return { success: false, reason: "Bot thiếu quyền 'Manage Nicknames' (Quản lý biệt danh)" };
  }

  // Kiểm tra thứ bậc Role: Role cao nhất của Bot phải đứng trên Role của thành viên
  if (botMember.roles.highest.position <= member.roles.highest.position) {
    return { success: false, reason: "Role của thành viên cao hơn hoặc ngang bằng Role của Bot" };
  }

  const targetNickname = determineTargetNickname(member);
  if (targetNickname === undefined) {
    return { success: false, reason: "Không có thay đổi" };
  }

  const currentNick = member.nickname || null;
  if (targetNickname === currentNick) {
    return { success: false, reason: "Tên đã đúng định dạng" };
  }

  try {
    recentBotNicknameChanges.set(member.id, Date.now());
    await member.setNickname(targetNickname, reason);
    console.log(`[AutoNickname] Đã đổi tên "${member.user.tag}" -> "${targetNickname || member.user.displayName}"`);
    return {
      success: true,
      oldName: currentNick || member.user.displayName,
      newName: targetNickname || member.user.displayName
    };
  } catch (err) {
    console.warn(`[AutoNickname] Lỗi khi đổi tên cho ${member.user.tag}: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

/**
 * Quét và đồng bộ tên cho toàn bộ thành viên trong Server
 */
async function syncAllGuildNicknames(guild) {
  if (!guild) return { total: 0, updatedCount: 0, skippedCount: 0 };
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  let updatedCount = 0;
  let skippedCount = 0;

  for (const [, member] of members) {
    if (member.user.bot) continue;
    const res = await syncMemberNickname(member, "Đồng bộ tên hàng loạt theo Role");
    if (res.success) {
      updatedCount++;
      // Nghỉ 1000ms sau mỗi lần đổi tên để tuân thủ giới hạn 10 req/10s của Discord API
      await new Promise(r => setTimeout(r, 1000));
    } else {
      skippedCount++;
      // Nghỉ ngắn 10ms để nhường CPU Event Loop
      await new Promise(r => setTimeout(r, 10));
    }
  }

  return { total: members.size, updatedCount, skippedCount };
}

module.exports = {
  ROLE_PREFIX_RULES,
  extractBaseName,
  determineTargetNickname,
  syncMemberNickname,
  syncAllGuildNicknames,
  isRecentBotNicknameChange
};
