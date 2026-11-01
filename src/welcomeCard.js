const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const fs = require("fs");
const path = require("path");

// Register Windows system fonts for crisp typography and emoji support
const fontDir = "C:/Windows/Fonts";
if (fs.existsSync(path.join(fontDir, "segoeui.ttf"))) {
  try {
    GlobalFonts.registerFromPath(path.join(fontDir, "segoeui.ttf"), "Segoe UI");
    if (fs.existsSync(path.join(fontDir, "segoeuib.ttf"))) {
      GlobalFonts.registerFromPath(path.join(fontDir, "segoeuib.ttf"), "Segoe UI Bold");
    }
    if (fs.existsSync(path.join(fontDir, "seguisb.ttf"))) {
      GlobalFonts.registerFromPath(path.join(fontDir, "seguisb.ttf"), "Segoe UI Semibold");
    }
    if (fs.existsSync(path.join(fontDir, "seguiemj.ttf"))) {
      GlobalFonts.registerFromPath(path.join(fontDir, "seguiemj.ttf"), "Segoe UI Emoji");
    }
  } catch (err) {
    console.warn("Lỗi khi load font hệ thống:", err.message);
  }
}

const FONT = '"Segoe UI", "Segoe UI Bold", "Segoe UI Emoji", Arial, sans-serif';

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawBarcode(ctx, x, y, width, height) {
  const barPattern = [
    3, 1, 4, 1, 2, 3, 1, 2, 4, 1, 2, 3, 1, 1, 4, 2, 1, 3, 2, 1,
    4, 1, 3, 2, 1, 2, 4, 1, 3, 1, 2, 4, 2, 1, 3, 1, 2, 4, 1, 3, 2,
    1, 4, 2, 3, 1, 2, 1, 3, 2, 4
  ];
  let curX = x;
  ctx.fillStyle = "#38bdf8";
  const totalWeight = barPattern.reduce((a, b) => a + b, 0);
  const scale = width / (totalWeight * 1.25);

  for (let i = 0; i < barPattern.length; i++) {
    const w = barPattern[i] * scale;
    if (i % 2 === 0) {
      ctx.fillRect(curX, y, Math.max(2, w), height);
    }
    curX += w * 1.12;
    if (curX > x + width) break;
  }
}

// Bộ nhớ đệm asset tĩnh (ảnh nền, icon, sticker) để tránh đọc ổ đĩa và giải nén ảnh liên tục
const assetImageCache = new Map();

async function getCachedLocalImage(filePath) {
  if (assetImageCache.has(filePath)) {
    return assetImageCache.get(filePath);
  }
  if (!fs.existsSync(filePath)) {
    assetImageCache.set(filePath, null);
    return null;
  }
  try {
    const img = await loadImage(filePath);
    assetImageCache.set(filePath, img);
    return img;
  } catch {
    assetImageCache.set(filePath, null);
    return null;
  }
}

async function generateWelcomeCard({
  serverName = "SWAG RP",
  username = "member",
  displayName = "Member",
  userId = "0",
  createdAt = new Date(),
  avatarUrl = null,
  serverIconUrl = null
}) {
  const W = 1200;
  const H = 620;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Clean and sanitize display name
  let cleanName = (displayName || "").trim();
  cleanName = cleanName.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!cleanName) cleanName = (username || "Member").trim();

  // Format date DD/MM/YYYY
  const dateObj = new Date(createdAt);
  const day = String(dateObj.getDate()).padStart(2, "0");
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const year = dateObj.getFullYear();
  const createdDateStr = `${day}/${month}/${year}`;

  const assetsDir = path.join(__dirname, "../assets");

  // 1. Background Image: Los Santos Night City (Dùng Cache trong RAM)
  const bgPath = path.join(assetsDir, "swag_city_bg.jpg");
  const bg = await getCachedLocalImage(bgPath);
  if (bg) {
    ctx.drawImage(bg, 0, 0, W, H);
  } else {
    ctx.fillStyle = "#070c18";
    ctx.fillRect(0, 0, W, H);
  }

  // Dark atmospheric backdrop overlay
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, "rgba(5, 10, 20, 0.80)");
  bgGrad.addColorStop(0.5, "rgba(8, 14, 28, 0.75)");
  bgGrad.addColorStop(1, "rgba(4, 7, 16, 0.92)");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Subtle Cyan Grid Overlay
  ctx.save();
  ctx.strokeStyle = "rgba(56, 189, 248, 0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();

  // 2. Main Glass Card Container
  const cardX = 35;
  const cardY = 35;
  const cardW = 1130;
  const cardH = 560;
  const cardR = 24;

  // Outer ambient shadow
  ctx.save();
  ctx.shadowColor = "rgba(0, 212, 255, 0.22)";
  ctx.shadowBlur = 30;
  roundRect(ctx, cardX, cardY, cardW, cardH, cardR);
  ctx.fillStyle = "rgba(10, 16, 32, 0.88)";
  ctx.fill();
  ctx.restore();

  // Cyber Border Gradient
  ctx.save();
  const borderGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
  borderGrad.addColorStop(0, "rgba(0, 229, 255, 0.85)");
  borderGrad.addColorStop(0.4, "rgba(59, 130, 246, 0.50)");
  borderGrad.addColorStop(0.75, "rgba(245, 158, 11, 0.75)");
  borderGrad.addColorStop(1, "rgba(0, 229, 255, 0.45)");
  ctx.lineWidth = 2;
  ctx.strokeStyle = borderGrad;
  roundRect(ctx, cardX, cardY, cardW, cardH, cardR);
  ctx.stroke();
  ctx.restore();

  // HUD Corner Accents
  ctx.save();
  ctx.strokeStyle = "#00e5ff";
  ctx.lineWidth = 3;
  const cLen = 22;
  ctx.beginPath();
  ctx.moveTo(cardX + 12, cardY + 12 + cLen);
  ctx.lineTo(cardX + 12, cardY + 12);
  ctx.lineTo(cardX + 12 + cLen, cardY + 12);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cardX + 12, cardY + cardH - 12 - cLen);
  ctx.lineTo(cardX + 12, cardY + cardH - 12);
  ctx.lineTo(cardX + 12 + cLen, cardY + cardH - 12);
  ctx.stroke();
  ctx.restore();

  // 3. Header Section: Server Logo & Boarding Pass Title
  const logoPath = path.join(assetsDir, "swag_logo.png");
  const headerLogoX = cardX + 165;
  if (fs.existsSync(logoPath)) {
    try {
      const logo = await loadImage(logoPath);
      ctx.drawImage(logo, headerLogoX, cardY + 8, 88, 88);
    } catch { }
  }

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 28px ${FONT}`;
  ctx.fillText(serverName.toUpperCase(), headerLogoX + 96, cardY + 50);

  ctx.fillStyle = "#00e5ff";
  ctx.font = `bold 12px ${FONT}`;
  ctx.fillText("LOS SANTOS ROLEPLAY COMMUNITY", headerLogoX + 96, cardY + 70);

  // BOARDING PASS Title on Right
  const bpTitleX = cardX + cardW - 45;
  const bpTitleY = cardY + 74;

  ctx.save();
  ctx.shadowColor = "#00e5ff";
  ctx.shadowBlur = 20;
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 34px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("BOARDING PASS", bpTitleX, bpTitleY);
  ctx.restore();

  ctx.fillStyle = "#94a3b8";
  ctx.font = `bold 11px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("OFFICIAL CITIZEN IDENTIFICATION • 2026", bpTitleX, bpTitleY + 18);
  ctx.textAlign = "left";

  // MASCOT 1: CHIBI GIRL CLINGING ONTO "BOARDING PASS"! (Proportional compact size)
  const girlPath = path.join(assetsDir, "swag_girl_clinging.png");
  if (fs.existsSync(girlPath)) {
    try {
      const girl = await loadImage(girlPath);
      ctx.save();
      ctx.shadowColor = "rgba(0, 229, 255, 0.4)";
      ctx.shadowBlur = 12;
      const gw = 100;
      const gh = (gw / girl.width) * girl.height;
      const gx = cardX + cardW - 250;
      const gy = bpTitleY - 28 - gh + 10;
      ctx.drawImage(girl, gx, gy, gw, gh);
      ctx.restore();
    } catch { }
  }

  // Header Divider Line
  ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX + 30, cardY + 105);
  ctx.lineTo(cardX + cardW - 30, cardY + 105);
  ctx.stroke();

  // 4. Left Column: Resident Profile Stub
  const leftX = cardX + 35;
  const leftY = cardY + 145;
  const avSize = 135;
  const avRadius = 24;

  // Avatar Ambient Glow
  ctx.save();
  ctx.shadowColor = "rgba(0, 229, 255, 0.45)";
  ctx.shadowBlur = 20;
  roundRect(ctx, leftX, leftY, avSize, avSize, avRadius);
  ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
  ctx.fill();
  ctx.restore();

  // Avatar Border
  ctx.save();
  const avBorder = ctx.createLinearGradient(leftX, leftY, leftX + avSize, leftY + avSize);
  avBorder.addColorStop(0, "#00e5ff");
  avBorder.addColorStop(1, "#3b82f6");
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = avBorder;
  roundRect(ctx, leftX, leftY, avSize, avSize, avRadius);
  ctx.stroke();
  ctx.restore();

  // Load avatar image or draw fallback initial
  let avatarLoaded = false;
  if (avatarUrl) {
    try {
      const avImg = await loadImage(avatarUrl);
      ctx.save();
      roundRect(ctx, leftX + 3, leftY + 3, avSize - 6, avSize - 6, avRadius - 3);
      ctx.clip();
      ctx.drawImage(avImg, leftX + 3, leftY + 3, avSize - 6, avSize - 6);
      ctx.restore();
      avatarLoaded = true;
    } catch {
      avatarLoaded = false;
    }
  }

  if (!avatarLoaded) {
    ctx.save();
    roundRect(ctx, leftX + 3, leftY + 3, avSize - 6, avSize - 6, avRadius - 3);
    ctx.clip();
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(leftX + 3, leftY + 3, avSize - 6, avSize - 6);
    ctx.fillStyle = "#38bdf8";
    ctx.font = `bold 46px ${FONT}`;
    ctx.textAlign = "center";
    const initial = cleanName.charAt(0).toUpperCase() || "S";
    ctx.fillText(initial, leftX + avSize / 2, leftY + avSize / 2 + 16);
    ctx.restore();
  }

  // MASCOT 2: CHIBI BOY CLINGING ONTO THE AVATAR FRAME! (Dùng Cache trong RAM)
  const boyPath = path.join(assetsDir, "swag_boy_clinging.png");
  const boy = await getCachedLocalImage(boyPath);
  if (boy) {
    try {
      ctx.save();
      ctx.shadowColor = "rgba(0, 229, 255, 0.45)";
      ctx.shadowBlur = 14;
      const bw = 92;
      const bh = (bw / boy.width) * boy.height;
      const bx = leftX + avSize / 2 - bw / 2;
      const by = leftY - bh + 12;
      ctx.drawImage(boy, bx, by, bw, bh);
      ctx.restore();
    } catch { }
  }

  // VIP Citizen Badge Pill under avatar
  roundRect(ctx, leftX, leftY + avSize + 14, avSize, 28, 14);
  const vipGrad = ctx.createLinearGradient(leftX, 0, leftX + avSize, 0);
  vipGrad.addColorStop(0, "#0284c7");
  vipGrad.addColorStop(1, "#0ea5e9");
  ctx.fillStyle = vipGrad;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 11px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("VIP CITIZEN", leftX + avSize / 2, leftY + avSize + 32);
  ctx.textAlign = "left";

  // Left Stub Fields
  const stubFieldY = leftY + avSize + 55;
  const stubLineGap = 35;

  let fitDisplayName = cleanName;
  if (fitDisplayName.length > 15) fitDisplayName = fitDisplayName.slice(0, 14) + "…";

  ctx.fillStyle = "#64748b";
  ctx.font = `bold 10px ${FONT}`;
  ctx.fillText("FULL NAME", leftX, stubFieldY);
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillText(fitDisplayName, leftX, stubFieldY + 18);

  ctx.fillStyle = "#64748b";
  ctx.font = `bold 10px ${FONT}`;
  ctx.fillText("ACCOUNT CREATED", leftX, stubFieldY + stubLineGap);
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 14px ${FONT}`;
  ctx.fillText(createdDateStr, leftX, stubFieldY + stubLineGap + 18);

  ctx.fillStyle = "#64748b";
  ctx.font = `bold 10px ${FONT}`;
  ctx.fillText("DESTINATION", leftX, stubFieldY + stubLineGap * 2);
  ctx.fillStyle = "#00e5ff";
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillText(serverName, leftX, stubFieldY + stubLineGap * 2 + 18);

  // Left Barcode
  const barY = cardY + cardH - 46;
  const shortId = userId.length > 10 ? userId.slice(-10) : userId;
  drawBarcode(ctx, leftX, barY, 150, 20);
  ctx.fillStyle = "#64748b";
  ctx.font = `bold 9px ${FONT}`;
  ctx.fillText(`SWG-${shortId}`, leftX + 160, barY + 14);

  // Vertical Separator Line between Left and Right
  ctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(cardX + 280, cardY + 110);
  ctx.lineTo(cardX + 280, cardY + cardH - 25);
  ctx.stroke();
  ctx.setLineDash([]);

  // 5. Right Main Area: The 6 Data Boxes
  const rightX = cardX + 315;
  const rightY = cardY + 125;
  const colW = 370;
  const boxH = 68;
  const rowGap = 22;
  const colGap = 25;

  function drawDataBox(bx, by, label, val, isAccent = false) {
    roundRect(ctx, bx, by, colW, boxH, 14);
    ctx.fillStyle = "rgba(10, 18, 36, 0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(56, 189, 248, 0.30)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = "#94a3b8";
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillText(label, bx + 18, by + 24);

    ctx.fillStyle = isAccent ? "#38bdf8" : "#ffffff";
    ctx.font = `bold 18px ${FONT}`;
    let valStr = String(val);
    if (valStr.length > 24) valStr = valStr.slice(0, 23) + "…";
    ctx.fillText(valStr, bx + 18, by + 50);
  }

  const col2X = rightX + colW + colGap;
  const row2Y = rightY + boxH + rowGap;
  const row3Y = row2Y + boxH + rowGap;

  // Row 1: PASSENGER NAME & GLOBAL NAME
  drawDataBox(rightX, rightY, "PASSENGER NAME", cleanName);
  drawDataBox(col2X, rightY, "GLOBAL NAME", cleanName);

  // Row 2: USERNAME & USER ID
  drawDataBox(rightX, row2Y, "USERNAME", `@${username}`, true);
  drawDataBox(col2X, row2Y, "USER ID", userId);

  // Row 3: ACCOUNT CREATED & DESTINATION
  drawDataBox(rightX, row3Y, "ACCOUNT CREATED", createdDateStr);
  drawDataBox(col2X, row3Y, "DESTINATION", serverName, true);

  // 6. Footer Strip
  const footY = cardY + cardH - 35;
  ctx.fillStyle = "#38bdf8";
  ctx.font = `bold 12px ${FONT}`;
  ctx.fillText("FLIGHT NO: SWG-2026", rightX, footY);

  ctx.fillStyle = "#94a3b8";
  ctx.font = `bold 12px ${FONT}`;
  ctx.fillText("GATE: 2026", rightX + 220, footY);

  ctx.fillStyle = "#fbbf24";
  ctx.font = `bold 12px ${FONT}`;
  ctx.fillText("CLASS: VIP CITIZEN", rightX + 380, footY);

  ctx.fillStyle = "#64748b";
  ctx.font = `bold 11px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("SWAG ROLEPLAY • SAN ANDREAS", cardX + cardW - 35, footY);
  ctx.textAlign = "left";

  // 7. 3D Decorative Pins (Dùng Cache trong RAM)
  const crownGoldPath = path.join(assetsDir, "swag_pin_crown_gold.png");
  const pinCrown = await getCachedLocalImage(crownGoldPath);
  if (pinCrown) {
    try {
      ctx.drawImage(pinCrown, cardX + cardW - 38, cardY - 18, 64, 56);
    } catch { }
  }

  const starPath = path.join(assetsDir, "swag_pin_star.png");
  const pinStar = await getCachedLocalImage(starPath);
  if (pinStar) {
    try {
      ctx.drawImage(pinStar, leftX - 16, leftY + avSize - 25, 48, 44);
    } catch { }
  }

  return canvas.toBuffer("image/png");
}

module.exports = {
  generateWelcomeCard
};
