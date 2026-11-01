const crypto = require("crypto");

function randomCode(prefix = "MCR") {
  const raw = crypto.randomBytes(5).toString("hex").toUpperCase();
  return `${prefix}-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nowMysql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function generateRandomString(length) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function parseUserAgent(ua) {
  if (!ua) return "Windows (Chrome)";
  let os = "Windows";
  if (/Windows NT 10.0/i.test(ua)) os = "Windows";
  else if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/iPhone/i.test(ua)) os = "iOS";
  else if (/iPad/i.test(ua)) os = "iPadOS";
  else if (/Macintosh|Mac OS X/i.test(ua)) os = "macOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "Chrome";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";

  return `${os} (${browser})`;
}

// Bộ nhớ đệm tra cứu IP trong 24 giờ để tránh vượt ngưỡng 45 request/phút của ip-api.com
const ipCache = new Map();
const IP_CACHE_TTL = 24 * 60 * 60 * 1000;

async function lookupIpInfo(ip) {
  let cleanIp = ip ? String(ip).replace(/^::ffff:/, "").trim() : "";

  // Không có IP hoặc là dải IP nội bộ / localhost
  if (!cleanIp || cleanIp === "127.0.0.1" || cleanIp === "::1" || cleanIp.startsWith("192.168.") || cleanIp.startsWith("10.") || cleanIp.startsWith("172.")) {
    return {
      ip: cleanIp || null,
      location: cleanIp ? "Mạng nội bộ (Local/LAN)" : "Chưa xác định",
      isp: cleanIp ? "Local Network" : "Chưa xác định"
    };
  }

  // Kiểm tra cache trước
  const cached = ipCache.get(cleanIp);
  if (cached && Date.now() - cached.timestamp < IP_CACHE_TTL) {
    return cached.data;
  }

  try {
    const res = await fetch(`http://ip-api.com/json/${cleanIp}?fields=status,city,regionName,country,isp`, {
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.status === "success") {
        const city = data.city || data.regionName || "Không xác định";
        const region = data.regionName || data.country || "";
        const result = {
          ip: cleanIp,
          location: region && region !== city ? `${city}, ${region}` : city,
          isp: data.isp || "Không xác định"
        };
        // Giới hạn kích thước cache không quá 5000 IP
        if (ipCache.size > 5000) {
          const firstKey = ipCache.keys().next().value;
          ipCache.delete(firstKey);
        }
        ipCache.set(cleanIp, { timestamp: Date.now(), data: result });
        return result;
      }
    }
  } catch {}

  const fallback = {
    ip: cleanIp,
    location: "Không xác định",
    isp: "Không xác định"
  };

  // Cache tạm fallback trong 5 phút để tránh spam request liên tục nếu API đang bị chặn/lỗi
  ipCache.set(cleanIp, { timestamp: Date.now() - (IP_CACHE_TTL - 5 * 60 * 1000), data: fallback });
  return fallback;
}

function formatVietnameseDate(dateInput) {
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return "Không xác định";

  const days = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
  const months = [
    "Tháng Một", "Tháng Hai", "Tháng Ba", "Tháng Tư", "Tháng Năm", "Tháng Sáu",
    "Tháng Bảy", "Tháng Tám", "Tháng Chín", "Tháng Mười", "Tháng Mười Một", "Tháng Mười Hai"
  ];

  // Convert to UTC+7 (Vietnam Time)
  const vnOffset = 7 * 60;
  const localOffset = date.getTimezoneOffset();
  const vnTime = new Date(date.getTime() + (vnOffset + localOffset) * 60000);

  const dayName = days[vnTime.getDay()];
  const day = vnTime.getDate();
  const monthName = months[vnTime.getMonth()];
  const year = vnTime.getFullYear();

  let hours = vnTime.getHours();
  const minutes = vnTime.getMinutes().toString().padStart(2, "0");
  const period = hours >= 12 ? "CH" : "SA";
  hours = hours % 12 || 12;

  return `${dayName}, ${day} ${monthName}, ${year} ${hours}:${minutes} ${period}`;
}

function formatShortDate(dateInput) {
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return "01/01/2024";

  const vnOffset = 7 * 60;
  const localOffset = date.getTimezoneOffset();
  const vnTime = new Date(date.getTime() + (vnOffset + localOffset) * 60000);

  const day = String(vnTime.getDate()).padStart(2, "0");
  const month = String(vnTime.getMonth() + 1).padStart(2, "0");
  const year = vnTime.getFullYear();

  return `${day}/${month}/${year}`;
}

function getTimeAgo(dateInput) {
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return "4 năm trước";

  const now = new Date();
  const diffMs = Math.max(0, now - date);
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffMonths = Math.floor(diffDays / 30.4375);
  const diffYears = Math.floor(diffDays / 365.25);

  if (diffYears >= 1) return `${diffYears} năm trước`;
  if (diffMonths >= 1) return `${diffMonths} tháng trước`;
  if (diffDays >= 1) return `${diffDays} ngày trước`;
  return "Hôm nay";
}

function randomGuaranteeCode(prefix = "SW") {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${s}`;
}

module.exports = {
  randomCode,
  randomGuaranteeCode,
  escapeHtml,
  nowMysql,
  generateRandomString,
  parseUserAgent,
  lookupIpInfo,
  formatVietnameseDate,
  formatShortDate,
  getTimeAgo
};

