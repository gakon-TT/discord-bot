local function getIdentifierByType(src, identifierType)
    for _, identifier in ipairs(GetPlayerIdentifiers(src)) do
        if string.sub(identifier, 1, string.len(identifierType) + 1) == identifierType .. ":" then
            return identifier
        end
    end
    return nil
end

AddEventHandler("playerConnecting", function(name, setKickReason, deferrals)
    local src = source
    deferrals.defer()
    Wait(0)

    deferrals.update("🔎 Đang kiểm tra whitelist...")

    local discord = getIdentifierByType(src, "discord")
    local license = getIdentifierByType(src, "license")
    local license2 = getIdentifierByType(src, "license2")
    local fivem = getIdentifierByType(src, "fivem")

    if not discord then
        deferrals.done("❌ Không tìm thấy Discord. Hãy mở Discord trước khi vào server.")
        return
    end

    local discordId = string.gsub(discord, "discord:", "")

    local rows = MySQL.query.await([[
        SELECT status FROM whitelist_players
        WHERE discord_id = ? AND status = 'active'
        LIMIT 1
    ]], { discordId })

    if not rows or #rows == 0 then
        deferrals.done("❌ Bạn chưa được Whitelist. Hãy vào Discord và đăng ký Whitelist trước.")
        return
    end

    -- Cập nhật identifier FiveM/Rockstar sau khi whitelist đã được xác nhận.
    MySQL.update.await([[
        UPDATE whitelist_players
        SET license_identifier = COALESCE(?, license_identifier),
            license2_identifier = COALESCE(?, license2_identifier),
            fivem_identifier = COALESCE(?, fivem_identifier)
        WHERE discord_id = ?
    ]], { license, license2, fivem, discordId })

    deferrals.done()
end)
