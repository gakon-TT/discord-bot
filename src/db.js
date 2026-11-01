const mysql = require("mysql2/promise");
const config = require("./config");

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 30,
  queueLimit: 0,
  charset: "utf8mb4",
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function execute(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

// Tự động kiểm tra và tạo Index cho các bảng nếu chưa có (chống Full Table Scan khi đông người dùng)
async function initDatabaseIndexes() {
  try {
    const indexes = [
      { table: "tickets", name: "idx_tickets_discord_status", cols: "(discord_id, status)" },
      { table: "tickets", name: "idx_tickets_channel", cols: "(channel_id)" },
      { table: "tickets", name: "idx_tickets_status", cols: "(status)" }
    ];

    for (const idx of indexes) {
      try {
        const check = await query(
          `SELECT COUNT(1) as cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
          [config.db.database, idx.table, idx.name]
        );
        if (check[0]?.cnt === 0) {
          await pool.query(`ALTER TABLE \`${idx.table}\` ADD INDEX \`${idx.name}\` ${idx.cols}`);
          console.log(`[DB] Đã tự động tạo index tối ưu: ${idx.table}.${idx.name}`);
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn("[DB] Không thể tự động tạo index:", err.message);
  }
}

initDatabaseIndexes().catch(() => {});

module.exports = { pool, query, execute };
