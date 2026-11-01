CÀI RESOURCE FIVE-M
===================

1. Cài oxmysql.
2. Copy thư mục này vào resources/[local]/whitelist.
3. Đổi tên thư mục thành whitelist nếu muốn.
4. Trong server.cfg:
   ensure oxmysql
   ensure whitelist

Resource sử dụng chung database `whitelist` với Discord Bot.

Nó kiểm tra:
- discord identifier
- whitelist_players.status = active

Sau khi người chơi được whitelist, lần connect đầu tiên sẽ lưu:
- license
- license2
- fivem

LƯU Ý:
- Không dùng IP để xác định whitelist.
- license2 được ưu tiên theo tài liệu Cfx khi cả license và license2 có mặt.
