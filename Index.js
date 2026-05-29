const {
    Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder,
    REST, Routes, SlashCommandBuilder,
    ButtonBuilder, ButtonStyle, ActionRowBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const axios = require('axios');
const ms    = require('ms');
const fs   = require('fs');
const path = require('path');
const http = require('http');

function parseDuration(str) {
    if (!str) return undefined;
    const moMatch = str.match(/^(\d+)\s*mo$/i);
    if (moMatch) return parseInt(moMatch[1]) * 30 * 24 * 60 * 60 * 1000;
    return ms(str);
}

function generateKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const seg = () => Array.from({length: 5}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `SMVLL-${seg()}-${seg()}-${seg()}`;
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const TOKEN           = process.env.TOKEN;
const GITHUB_TOKEN    = process.env.GITHUB_TOKEN;
const REPO            = "SM3LLTHRX/SMVLLHUBpremium";
const LOG_CHANNEL_ID  = process.env.LOG_CHANNEL_ID;
const CLIENT_ID       = process.env.CLIENT_ID;
const GUILD_ID        = process.env.GUILD_ID;
const OWNER_ID        = process.env.OWNER_ID;
const PREMIUM_ROLE_ID = "1486435751297159378";
const BUYER_ROLE_ID   = process.env.BUYER_ROLE_ID;

const GREEN  = 0x00FF64;
const RED    = 0xFF4444;
const YELLOW = 0xFFCC00;
const BLUE   = 0x4488FF;
const ORANGE = 0xFF8800;
const PURPLE = 0xAA44FF;

// ─── GitHub helpers ─────────────────────────────────────────────

async function getFile(filename = "whitelist.txt") {
    const res = await axios.get(
        `https://api.github.com/repos/${REPO}/contents/${filename}`,
        { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );
    return {
        content: Buffer.from(res.data.content, 'base64').toString(),
        sha: res.data.sha
    };
}

async function updateFile(content, sha, filename = "whitelist.txt") {
    await axios.put(
        `https://api.github.com/repos/${REPO}/contents/${filename}`,
        {
            message: `update ${filename}`,
            content: Buffer.from(content).toString('base64'),
            sha
        },
        { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );
}

async function createFile(content, filename) {
    await axios.put(
        `https://api.github.com/repos/${REPO}/contents/${filename}`,
        {
            message: `create ${filename}`,
            content: Buffer.from(content).toString('base64')
        },
        { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );
}

// ─── Keys helpers ─────────────────────────────────────────────────────────────

async function getKeysData() {
    const f = await getFile("keys.json").catch(() => null);
    return { data: f ? JSON.parse(f.content) : {}, sha: f ? f.sha : null };
}

async function saveKeysData(data, sha) {
    const content = JSON.stringify(data, null, 2);
    if (sha) await updateFile(content, sha, "keys.json");
    else      await createFile(content, "keys.json");
}

function findKeyByDiscordId(keys, discordId) {
    return Object.entries(keys).find(([, v]) => v.discordId === discordId) || null;
}

// ─── Free4All state ─────────────────────────────────────────────

let free4allSince = null; // ms timestamp when started, null if inactive

async function stopFree4All(actor) {
    try {
        let { content, sha } = await getFile();
        const val     = getConfigValue(content, 'free4all');
        const startTs = val ? parseInt(val.split(':')[0]) : Math.floor(free4allSince / 1000);
        const now     = Math.floor(Date.now() / 1000);
        const duration = now - startTs;

        content = content.split("\n").map(l => {
            if (!l.includes(',') || l.startsWith('--')) return l;
            const exp = getExpiry(l);
            if (!exp || isNaN(exp)) return l;
            return `${getUserName(l)},${exp + duration}`;
        }).join("\n");

        content = setConfigValue(content, 'whitelist', 'true');
        content = setConfigValue(content, 'free4all', null);
        await updateFile(content, sha);
        free4allSince = null;

        const dH = Math.floor(duration / 3600);
        const dM = Math.floor((duration % 3600) / 60);
        sendLog("✅ Free4All désactivé", [
            { name: "⏱️ Durée", value: `${dH}h ${dM}m`, inline: true },
            { name: "👮 Par",   value: actor,            inline: true }
        ], GREEN);
    } catch (e) {
        console.error("stopFree4All error:", e.message);
    }
}

function getConfigValue(content, key) {
    const line = content.split("\n").find(l => l.startsWith(key + "="));
    return line ? line.slice(key.length + 1).trim() : null;
}

function setConfigValue(content, key, value) {
    const lines = content.split("\n");
    const idx   = lines.findIndex(l => l.startsWith(key + "="));
    if (idx !== -1) {
        if (value === null) lines.splice(idx, 1);
        else lines[idx] = `${key}=${value}`;
    } else if (value !== null) {
        const cfgIdx = lines.findIndex(l => l.trim() === "--config");
        lines.splice(cfgIdx !== -1 ? cfgIdx + 1 : 0, 0, `${key}=${value}`);
    }
    return lines.join("\n");
}

// ─── Whitelist helpers ────────────────────────────────────────────

function parseUsers(content) {
    return content.split("\n").map(l => l.trim()).filter(l => l.length > 0);
}

function getUserName(line) {
    return line.split(",")[0].trim();
}

function getExpiry(line) {
    const match = line.match(/,(\d+)/);
    return match ? parseInt(match[1]) : null;
}

function isExpired(line) {
    const exp = getExpiry(line);
    if (!exp) return false;
    return exp < Math.floor(Date.now() / 1000);
}

function cleanExpired(content) {
    return parseUsers(content).filter(l => !isExpired(l)).join("\n");
}

function formatExpiry(line) {
    const exp = getExpiry(line);
    if (!exp) return "♾️ Lifetime";
    const now  = Math.floor(Date.now() / 1000);
    const diff = exp - now;
    if (diff <= 0) return "⛔ Expiré";
    const days  = Math.floor(diff / 86400);
    const hours = Math.floor((diff % 86400) / 3600);
    if (days > 0) return `📅 ${days}j ${hours}h`;
    return `⏰ ${hours}h`;
}

function buildEntry(user, time) {
    if (time === "lifetime") return `${user},`;
    const expire = Math.floor((Date.now() + parseDuration(time)) / 1000);
    return `${user},${expire}`;
}

// ─── Logging ─────────────────────────────────────────────────────

function sendLog(title, fields, color = GREEN) {
    const channel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) return;
    channel.send({
        embeds: [
            new EmbedBuilder()
                .setTitle(title)
                .addFields(fields)
                .setColor(color)
                .setTimestamp()
                .setFooter({ text: "SMVLL HUB • HS CORP" })
        ]
    });
}

function isOwner(interaction) {
    return interaction.user.id === OWNER_ID;
}

// ─── Auto expiry check ────────────────────────────────────────────

async function checkExpiringSoon() {
    if (free4allSince !== null) return;
    const channel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) return;
    try {
        const { content } = await getFile();
        const now  = Math.floor(Date.now() / 1000);
        const soon = 3 * 24 * 3600;
        const expiringSoon = parseUsers(content).filter(line => {
            const exp  = getExpiry(line);
            if (!exp) return false;
            const diff = exp - now;
            return diff > 0 && diff <= soon;
        });
        if (expiringSoon.length === 0) return;
        const list = expiringSoon.map(line => {
            const name = getUserName(line);
            const exp  = getExpiry(line);
            const days = Math.ceil((exp - now) / 86400);
            return `• **${name}** — expire dans **${days}j**`;
        }).join("\n");
        channel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle("⚠️ Whitelist — Expirations proches")
                    .setDescription(list)
                    .setColor(ORANGE)
                    .setTimestamp()
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
            ]
        });
    } catch (e) {
        console.error("checkExpiringSoon error:", e.message);
    }
}

// ─── Commands ────────────────────────────────────────────────────────

const commands = [
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Afficher le guide des formats de temps et commandes'),

    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Latence du bot'),

    new SlashCommandBuilder()
        .setName('botinfo')
        .setDescription('Infos sur le bot (uptime, mémoire, etc.)'),
    new SlashCommandBuilder()
        .setName('dmall')
        .setDescription('DM le script à tous les membres avec le rôle premium'),

    new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Envoyer une annonce dans un channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel cible').setRequired(true))
        .addStringOption(o => o.setName('message').setDescription('Contenu de l\'annonce').setRequired(true))
        .addStringOption(o => o.setName('titre').setDescription('Titre de l\'embed').setRequired(false)),

    new SlashCommandBuilder()
        .setName('test-dm')
        .setDescription('Envoie un DM de test à toi-même'),

    new SlashCommandBuilder()
        .setName('dm')
        .setDescription('Envoyer le script en DM à un membre spécifique')
        .addUserOption(o => o.setName('user').setDescription('Membre Discord').setRequired(true)),
    new SlashCommandBuilder()
        .setName('sell')
        .setDescription('Créer une clé d\'accès pour un buyer')
        .addUserOption(o => o.setName('user').setDescription('Membre Discord').setRequired(true))
        .addStringOption(o => o.setName('time').setDescription('Durée (ex: 5d, 1w, 1mo, lifetime)').setRequired(true)),

    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Post the buyer panel in this channel')
        .addStringOption(o => o.setName('image').setDescription('Custom thumbnail URL (optional)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('get-script')
        .setDescription('Obtenir ton script et ta clé (buyers seulement)'),

    new SlashCommandBuilder()
        .setName('reset-hwid')
        .setDescription('Réinitialiser ton HWID (buyers seulement)'),

    new SlashCommandBuilder()
        .setName('my-stats')
        .setDescription('Voir le statut de ta clé (buyers seulement)'),

    new SlashCommandBuilder()
        .setName('keys')
        .setDescription('Voir toutes les clés enregistrées'),

    new SlashCommandBuilder()
        .setName('genkey')
        .setDescription('Générer une ou plusieurs clés sans les lier à un Discord')
        .addIntegerOption(o => o.setName('quantite').setDescription('Nombre de clés (défaut: 1, max: 50)').setRequired(false))
        .addStringOption(o => o.setName('duree').setDescription('Durée (ex: 1w, 1mo, lifetime). Défaut: lifetime').setRequired(false)),

    new SlashCommandBuilder()
        .setName('key-info')
        .setDescription('Voir les détails complets d\'une clé')
        .addStringOption(o => o.setName('key').setDescription('Clé SMVLL-XXXXX-XXXXX-XXXXX').setRequired(true)),

    new SlashCommandBuilder()
        .setName('key-extend')
        .setDescription('Rallonger l\'accès d\'un buyer Discord')
        .addUserOption(o => o.setName('user').setDescription('Membre Discord').setRequired(true))
        .addStringOption(o => o.setName('duree').setDescription('Durée à ajouter (ex: 1w, 1mo, lifetime)').setRequired(true)),

    new SlashCommandBuilder()
        .setName('key-revoke')
        .setDescription('Révoquer la clé d\'un buyer et retirer son rôle')
        .addUserOption(o => o.setName('user').setDescription('Membre Discord').setRequired(true)),

    new SlashCommandBuilder()
        .setName('hwid-reset')
        .setDescription('Reset le HWID d\'un buyer (admin)')
        .addUserOption(o => o.setName('user').setDescription('Membre Discord').setRequired(true)),

    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Stats rapides des clés et du bot'),

].map(c => c.toJSON());

// ─── Ready ─────────────────────────────────────────────────────────────

client.once('ready', async () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Commandes enregistrées");

    // Set bot avatar if BOT_AVATAR_URL is configured
    if (process.env.BOT_AVATAR_URL) {
        try {
            await client.user.setAvatar(process.env.BOT_AVATAR_URL);
            console.log("✅ Avatar mis à jour");
        } catch (e) {
            console.warn("⚠️ Avatar update failed (rate limited or invalid URL):", e.message);
        }
    }
    try {
        const { content } = await getFile();
        const val = getConfigValue(content, 'free4all');
        if (val) {
            const [startTs, endTs] = val.split(':').map(Number);
            free4allSince = startTs * 1000;
            console.log("⚠️ Free4All actif depuis le dernier restart");
            if (endTs && endTs > 0) {
                const remaining = (endTs - Math.floor(Date.now() / 1000)) * 1000;
                if (remaining > 0) setTimeout(() => stopFree4All("auto"), remaining);
                else stopFree4All("auto");
            }
        }
    } catch {}
    setInterval(checkExpiringSoon, 60 * 60 * 1000);
    checkExpiringSoon();

    // Startup log
    setTimeout(async () => {
        try {
            const { content } = await getFile();
            const wlCount = parseUsers(content).filter(l => !isExpired(l)).length;
            const { data: keys } = await getKeysData();
            const keyCount = Object.keys(keys).length;
            const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
            sendLog("🟢 Bot démarré", [
                { name: "🤖 Bot",       value: client.user.tag,               inline: true },
                { name: "📡 Ping",      value: `${client.ws.ping}ms`,         inline: true },
                { name: "🏠 Serveur",   value: `${client.guilds.cache.size} guild(s)`, inline: true },
                { name: "📋 WL actifs", value: `${wlCount}`,                  inline: true },
                { name: "🔑 Clés",      value: `${keyCount}`,                 inline: true },
                { name: "🧠 Mémoire",   value: `${mem} MB`,                   inline: true },
                { name: "📦 Node.js",   value: process.version,               inline: true },
            ], GREEN);
        } catch {}
    }, 3000);
});

// ─── Interactions ───────────────────────────────────────────────────────

async function handleBuyerAction(interaction, action) {
    await interaction.deferReply({ ephemeral: true });
    try {
        if (action === 'get-script') {
            if (BUYER_ROLE_ID) {
                const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                if (!member || !member.roles.cache.has(BUYER_ROLE_ID)) {
                    return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("⛔ You don't have the required **Buyer** role.").setColor(RED)] });
                }
            }
            const { data: keys } = await getKeysData();
            const entry = findKeyByDiscordId(keys, interaction.user.id);
            if (!entry) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("❌ No key linked to your account. Contact support.").setColor(RED)] });
            const [key, keyData] = entry;
            const now = Math.floor(Date.now() / 1000);
            if (keyData.expiry && keyData.expiry < now) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("⛔ Your key has **expired**. Contact support to renew.").setColor(RED)] });
            const scriptLine = process.env.SCRIPT_LOADSTRING_URL || 'CONFIGURE_SCRIPT_LOADSTRING_URL';
            const script = `SCRIPT_KEY = "${key}"\n${scriptLine}`;
            try {
                await interaction.user.send({ content: script });
                await interaction.editReply({ embeds: [new EmbedBuilder().setDescription("✅ Script sent to your DMs!").setColor(GREEN)] });
                sendLog("📤 Script sent (panel)", [{ name: "👤 Discord", value: interaction.user.tag, inline: true }], BLUE);
            } catch {
                await interaction.editReply({ embeds: [new EmbedBuilder().setDescription("❌ Could not send DM. Check your Discord privacy settings.").setColor(RED)] });
            }

        } else if (action === 'reset-hwid') {
            const { data: keys, sha } = await getKeysData();
            const entry = findKeyByDiscordId(keys, interaction.user.id);
            if (!entry) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("❌ No key linked to your account.").setColor(RED)] });
            const [key, keyData] = entry;
            if (!keyData.hwid) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("⚠️ Your HWID is not locked yet.").setColor(YELLOW)] });
            keyData.hwid = null;
            keys[key] = keyData;
            await saveKeysData(keys, sha);
            await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("🔓 HWID Reset").setDescription("Your HWID has been cleared. It will lock again on your next script execution.").setColor(GREEN).setFooter({ text: "SMVLL HUB • HS CORP" }).setTimestamp()] });
            sendLog("🔓 HWID reset (panel)", [{ name: "👤 Discord", value: interaction.user.tag, inline: true }], ORANGE);

        } else if (action === 'my-stats') {
            const { data: keys } = await getKeysData();
            const entry = findKeyByDiscordId(keys, interaction.user.id);
            if (!entry) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("❌ No key linked to your account.").setColor(RED)] });
            const [key, keyData] = entry;
            const now = Math.floor(Date.now() / 1000);
            const expired = keyData.expiry && keyData.expiry < now;
            const expiryStr = keyData.expiry ? (expired ? "⛔ Expired" : `<t:${keyData.expiry}:R>`) : "♾️ Lifetime";
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("📊 My Stats — SMVLL HUB V2")
                    .addFields(
                        { name: "🔑 Key",     value: `\`${key.slice(0, 12)}...\``,                        inline: false },
                        { name: "⏱️ Expires", value: expiryStr,                                           inline: true },
                        { name: "📌 Status",  value: expired ? "⛔ Expired" : "✅ Active",               inline: true },
                        { name: "🖥️ HWID",   value: keyData.hwid ? "🔒 Locked" : "🔓 Not locked",      inline: true },
                        { name: "📅 Created", value: `<t:${keyData.createdAt}:D>`,                        inline: true }
                    )
                    .setColor(expired ? RED : GREEN).setFooter({ text: "SMVLL HUB • HS CORP" }).setTimestamp()
                ]
            });
        }
    } catch (err) {
        console.error("handleBuyerAction error:", err.message);
        interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`❌ Error: \`${err.message}\``).setColor(RED)] });
    }
}

client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        const map = { btn_get_script: 'get-script', btn_reset_hwid: 'reset-hwid', btn_my_stats: 'my-stats' };
        if (map[interaction.customId]) return handleBuyerAction(interaction, map[interaction.customId]);

        if (interaction.customId === 'btn_redeem_key') {
            const modal = new ModalBuilder()
                .setCustomId('modal_redeem_key')
                .setTitle('🔑 Redeem your key');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('key_input')
                        .setLabel('Enter your key')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('SMVLL-XXXXX-XXXXX-XXXXX')
                        .setMinLength(10)
                        .setRequired(true)
                )
            );
            return interaction.showModal(modal);
        }
        return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_redeem_key') {
        await interaction.deferReply({ ephemeral: true });
        const key = interaction.fields.getTextInputValue('key_input').trim().toUpperCase();
        try {
            const { data: keys, sha } = await getKeysData();
            const keyData = keys[key];
            if (!keyData) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription('❌ Key not found. Check your key and try again.').setColor(RED)] });

            const now = Math.floor(Date.now() / 1000);
            if (keyData.expiry && keyData.expiry < now) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription('⛔ This key has expired.').setColor(RED)] });

            if (keyData.discordId && keyData.discordId !== interaction.user.id) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription('⛔ This key is already linked to another account.').setColor(RED)] });

            if (keyData.discordId === interaction.user.id) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription('✅ This key is already linked to your account.').setColor(GREEN)] });

            keyData.discordId  = interaction.user.id;
            keyData.discordTag = interaction.user.tag;
            keys[key] = keyData;
            await saveKeysData(keys, sha);

            if (BUYER_ROLE_ID) {
                const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                if (member) await member.roles.add(BUYER_ROLE_ID).catch(() => {});
            }

            await interaction.editReply({ embeds: [new EmbedBuilder()
                .setTitle('✅ Key redeemed!')
                .setDescription(`Your key \`${key}\` is now linked to your account.\nClick **🔑 Get Script** to get your script.`)
                .addFields({ name: '⏱️ Expires', value: keyData.expiry ? `<t:${keyData.expiry}:R>` : '♾️ Lifetime', inline: true })
                .setColor(GREEN).setFooter({ text: 'SMVLL HUB • HS CORP' }).setTimestamp()
            ] });
            sendLog('🎟️ Key redeemed', [
                { name: '👤 Discord', value: interaction.user.tag, inline: true },
                { name: '🔑 Key',     value: `\`${key}\``,         inline: true },
            ], GREEN);
        } catch (e) {
            interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`❌ Error: \`${e.message}\``).setColor(RED)] });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction.commandName;

    if (!isOwner(interaction) && !['get-script', 'reset-hwid', 'my-stats'].includes(cmd)) {
        return interaction.reply({
            embeds: [new EmbedBuilder().setDescription("⛔ Accès refusé.").setColor(RED)],
            ephemeral: true
        });
    }

    await interaction.deferReply({ ephemeral: true });

    if (free4allSince !== null && cmd.startsWith('wl-') && !['wl-check','wl-list','wl-search','wl-stats'].includes(cmd)) {
        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setTitle("🆓 Free4All actif")
                .setDescription("Les modifications de whitelist sont désactivées pendant le Free4All.")
                .setColor(ORANGE)]
        });
    }

    try {

        if (cmd === 'help') {
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("📖 Guide — SMVLL HUB Bot")
                    .addFields(
                        { name: "⏱️ Formats de durée", value: "`1s` `1m` `1h` `1d` `1w` `1mo` `1y` `lifetime`", inline: false },
                        { name: "━━━━━━━━━━━━━━━━", value: "**Commandes admin**", inline: false },
                        { name: "💰 Ventes",      value: "`/sell` — crée une clé liée à un Discord\n`/genkey` — génère des clés non liées", inline: false },
                        { name: "🔑 Gestion clés", value: "`/key-info` — détails d'une clé\n`/key-extend` — rallonger l'accès d'un buyer\n`/key-revoke` — révoquer la clé d'un buyer\n`/keys` — liste toutes les clés", inline: false },
                        { name: "🖥️ HWID",        value: "`/hwid-reset` — reset le HWID d'un buyer (admin)", inline: false },
                        { name: "📨 Messages",     value: "`/dmall` `/dm` `/announce` `/test-dm`", inline: false },
                        { name: "🔧 Utilitaires",  value: "`/stats` `/ping` `/botinfo` `/panel`", inline: false },
                        { name: "━━━━━━━━━━━━━━━━", value: "**Commandes buyers**", inline: false },
                        { name: "👤 Self-service",  value: "`/get-script` `/reset-hwid` `/my-stats`\nOu via les boutons du **panel**", inline: false }
                    )
                    .setColor(BLUE)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                ]
            });
        }

        else if (cmd === 'ping') {
            const ws = client.ws.ping;
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("🏓 Pong!")
                    .addFields({ name: "📡 WebSocket", value: `${ws}ms`, inline: true })
                    .setColor(ws < 100 ? GREEN : ws < 200 ? YELLOW : RED)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                ]
            });
        }

        else if (cmd === 'botinfo') {
            const uptime = process.uptime();
            const d   = Math.floor(uptime / 86400);
            const h   = Math.floor((uptime % 86400) / 3600);
            const m   = Math.floor((uptime % 3600) / 60);
            const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("🤖 Bot Info — SMVLL HUB")
                    .addFields(
                        { name: "⏱️ Uptime",     value: `${d}j ${h}h ${m}m`,          inline: true },
                        { name: "🧠 Mémoire",    value: `${mem} MB`,                   inline: true },
                        { name: "📡 Ping",       value: `${client.ws.ping}ms`,         inline: true },
                        { name: "🏠 Serveurs",   value: `${client.guilds.cache.size}`, inline: true },
                        { name: "📦 Node.js",    value: process.version,               inline: true },
                        { name: "🔖 discord.js", value: require('discord.js').version, inline: true }
                    )
                    .setColor(PURPLE)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                    .setTimestamp()
                ]
            });
        }

        else if (cmd === 'dmall') {
            const guild = interaction.guild;
            await guild.members.fetch();
            const members = guild.members.cache.filter(m =>
                m.roles.cache.has(PREMIUM_ROLE_ID) && !m.user.bot
            );

            if (members.size === 0) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("⚠️ Aucun membre avec ce rôle trouvé.")
                        .setColor(YELLOW)]
                });
            }

            let success = 0;
            let failed  = 0;

            for (const [, member] of members) {
                try {
                    await member.send({
                        content: "`loadstring(game:HttpGet(\"https://vss.pandadevelopment.net/virtual/file/fa8102b2cff041cd\"))()`",
                        embeds: [new EmbedBuilder()
                            .setTitle("🚀 SMVLL SEMI TP")
                            .addFields({
                                name: "💬 Support",
                                value: "Thank you for your purchase! If you encounter any problem, please create a ticket here:\nhttps://discord.com/channels/1279794919262916682/1472432361638461787"
                            })
                            .setColor(GREEN)
                            .setFooter({ text: "SMVLL HUB • HS CORP" })
                            .setTimestamp()
                        ]
                    });
                    success++;
                } catch {
                    failed++;
                }
            }

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("📨 DM envoyés — SMVLL SEMI TP")
                    .addFields(
                        { name: "✅ Succès", value: `${success}`,      inline: true },
                        { name: "❌ Échecs", value: `${failed}`,        inline: true },
                        { name: "👥 Total",  value: `${members.size}`,  inline: true }
                    )
                    .setColor(GREEN)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                    .setTimestamp()
                ]
            });

            sendLog("📨 /dmall exécuté", [
                { name: "✅ Succès", value: `${success}`,         inline: true },
                { name: "❌ Échecs",value: `${failed}`,           inline: true },
                { name: "👮 Par",   value: interaction.user.tag,  inline: true }
            ], GREEN);
        }

        else if (cmd === 'dm') {
            const target = interaction.options.getUser('user');
            try {
                await target.send({
                    content: "`loadstring(game:HttpGet(\"https://vss.pandadevelopment.net/virtual/file/fa8102b2cff041cd\"))()`",
                    embeds: [new EmbedBuilder()
                        .setTitle("🚀 SMVLL SEMI TP")
                        .addFields({
                            name: "💬 Support",
                            value: "Thank you for your purchase! If you encounter any problem, please create a ticket here:\nhttps://discord.com/channels/1279794919262916682/1472432361638461787"
                        })
                        .setColor(GREEN)
                        .setFooter({ text: "SMVLL HUB • HS CORP" })
                        .setTimestamp()
                    ]
                });
                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription(`✅ Script envoyé en DM à **${target.tag}**.`)
                        .setColor(GREEN)]
                });
                sendLog("📨 /dm exécuté", [
                    { name: "👤 Cible", value: target.tag,           inline: true },
                    { name: "👮 Par",   value: interaction.user.tag, inline: true }
                ], GREEN);
            } catch {
                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription(`❌ Impossible d'envoyer le DM à **${target.tag}**. Ses DMs sont sûrement fermés.`)
                        .setColor(RED)]
                });
            }
        }

        else if (cmd === 'test-dm') {
            try {
                await interaction.user.send({
                    embeds: [new EmbedBuilder()
                        .setTitle("🚀 SMVLL SEMI TP")
                        .setDescription("`loadstring(game:HttpGet(\"https://vss.pandadevelopment.net/virtual/file/fa8102b2cff041cd\"))()`")
                        .addFields({
                            name: "💬 Support",
                            value: "Thank you for your purchase! If you encounter any problem, please create a ticket here:\nhttps://discord.com/channels/1279794919262916682/1472432361638461787"
                        })
                        .setColor(GREEN)
                        .setFooter({ text: "SMVLL HUB • HS CORP" })
                        .setTimestamp()
                    ]
                });
                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("✅ DM de test envoyé dans ta MP !")
                        .setColor(GREEN)]
                });
            } catch {
                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("❌ Impossible d'envoyer le DM. Vérifie tes paramètres de confidentialité Discord.")
                        .setColor(RED)]
                });
            }
        }

        else if (cmd === 'announce') {
            const targetChannel = interaction.options.getChannel('channel');
            const message       = interaction.options.getString('message');
            const titre         = interaction.options.getString('titre') || "📢 Annonce — SMVLL HUB";

            await targetChannel.send({
                embeds: [new EmbedBuilder()
                    .setTitle(titre)
                    .setDescription(message)
                    .setColor(GREEN)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                    .setTimestamp()
                ]
            });

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setDescription(`✅ Annonce envoyée dans <#${targetChannel.id}>.`)
                    .setColor(GREEN)]
            });

            sendLog("📢 Annonce envoyée", [
                { name: "📌 Channel", value: `<#${targetChannel.id}>`, inline: true },
                { name: "👮 Par",     value: interaction.user.tag,     inline: true }
            ], PURPLE);
        }

        else if (cmd === 'sell') {
            const target = interaction.options.getUser('user');
            const time   = interaction.options.getString('time');

            if (time !== 'lifetime' && !parseDuration(time)) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription(`❌ Durée invalide : \`${time}\`. Exemples : \`5d\`, \`1w\`, \`1mo\`, \`lifetime\``)
                        .setColor(RED)]
                });
            }

            const { data: keys, sha: keysSha } = await getKeysData();

            const existing = findKeyByDiscordId(keys, target.id);
            if (existing) delete keys[existing[0]];

            const key = generateKey();
            const now = Math.floor(Date.now() / 1000);
            const expiry = time === 'lifetime' ? null : now + Math.floor(parseDuration(time) / 1000);
            keys[key] = {
                discordId:  target.id,
                discordTag: target.tag,
                expiry,
                hwid:       null,
                createdAt:  now
            };
            await saveKeysData(keys, keysSha);

            if (BUYER_ROLE_ID) {
                const member = await interaction.guild.members.fetch(target.id).catch(() => null);
                if (member) await member.roles.add(BUYER_ROLE_ID).catch(() => {});
            }

            const expiryStr = expiry ? `<t:${expiry}:R>` : "♾️ Lifetime";
            try {
                await target.send({
                    embeds: [new EmbedBuilder()
                        .setTitle("🎉 Access Granted — SMVLL HUB V2")
                        .setDescription(`You received an access key!\nClick **Get Script** in the server panel or use \`/get-script\`.`)
                        .addFields({ name: "⏱️ Expires", value: expiryStr, inline: true })
                        .setColor(GREEN)
                        .setFooter({ text: "SMVLL HUB • HS CORP" })
                        .setTimestamp()
                    ]
                });
            } catch {}

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("✅ Key Created")
                    .addFields(
                        { name: "👤 Discord",  value: target.tag,    inline: true },
                        { name: "⏱️ Expires", value: expiryStr,     inline: true },
                        { name: "🔑 Key",      value: `\`${key}\``, inline: false }
                    )
                    .setColor(GREEN)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                    .setTimestamp()
                ]
            });

            sendLog("💰 New key created", [
                { name: "👤 Discord", value: `${target.tag} (${target.id})`, inline: true },
                { name: "⏱️ Expires", value: expiryStr,                      inline: true },
                { name: "👮 By",      value: interaction.user.tag,            inline: true }
            ], GREEN);
        }

        else if (cmd === 'get-script') {
            if (BUYER_ROLE_ID) {
                const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                if (!member || !member.roles.cache.has(BUYER_ROLE_ID)) {
                    return interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setDescription("⛔ You don't have the required **Buyer** role.")
                            .setColor(RED)]
                    });
                }
            }

            const { data: keys } = await getKeysData();
            const entry = findKeyByDiscordId(keys, interaction.user.id);

            if (!entry) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("❌ No key linked to your account. Contact support.")
                        .setColor(RED)]
                });
            }

            const [key, keyData] = entry;
            const now = Math.floor(Date.now() / 1000);

            if (keyData.expiry && keyData.expiry < now) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("⛔ Your key has **expired**. Contact support to renew.")
                        .setColor(RED)]
                });
            }

            const scriptLine2 = process.env.SCRIPT_LOADSTRING_URL || 'CONFIGURE_SCRIPT_LOADSTRING_URL';
            const script2 = `SCRIPT_KEY = "${key}"\n${scriptLine2}`;
            try {
                await interaction.user.send({ content: script2 });

                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("✅ Script sent to your DMs!")
                        .setColor(GREEN)]
                });

                sendLog("📤 Script sent (get-script)", [
                    { name: "👤 Discord", value: interaction.user.tag, inline: true }
                ], BLUE);

            } catch {
                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("❌ Could not send DM. Check your Discord privacy settings.")
                        .setColor(RED)]
                });
            }
        }

        else if (cmd === 'reset-hwid') {
            const { data: keys, sha } = await getKeysData();
            const entry = findKeyByDiscordId(keys, interaction.user.id);

            if (!entry) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("❌ No key linked to your account.")
                        .setColor(RED)]
                });
            }

            const [key, keyData] = entry;
            if (!keyData.hwid) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("⚠️ Your HWID is not locked yet.")
                        .setColor(YELLOW)]
                });
            }

            keyData.hwid = null;
            keys[key] = keyData;
            await saveKeysData(keys, sha);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("🔓 HWID Reset")
                    .setDescription("Your HWID has been cleared. It will lock again on your next script execution.")
                    .setColor(GREEN)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                    .setTimestamp()
                ]
            });

            sendLog("🔓 HWID reset", [
                { name: "👤 Discord", value: interaction.user.tag, inline: true }
            ], ORANGE);
        }

        else if (cmd === 'my-stats') {
            const { data: keys } = await getKeysData();
            const entry = findKeyByDiscordId(keys, interaction.user.id);

            if (!entry) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("❌ No key linked to your account.")
                        .setColor(RED)]
                });
            }

            const [key, keyData] = entry;
            const now = Math.floor(Date.now() / 1000);
            const expired = keyData.expiry && keyData.expiry < now;
            const expiryStr = keyData.expiry
                ? (expired ? "⛔ Expired" : `<t:${keyData.expiry}:R>`)
                : "♾️ Lifetime";

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("📊 My Stats — SMVLL HUB V2")
                    .addFields(
                        { name: "🔑 Key",     value: `\`${key.slice(0, 12)}...\``,                        inline: false },
                        { name: "⏱️ Expires", value: expiryStr,                                           inline: true },
                        { name: "📌 Status",  value: expired ? "⛔ Expired" : "✅ Active",               inline: true },
                        { name: "🖥️ HWID",   value: keyData.hwid ? "🔒 Locked" : "🔓 Not locked",      inline: true },
                        { name: "📅 Created", value: `<t:${keyData.createdAt}:D>`,                        inline: true }
                    )
                    .setColor(expired ? RED : GREEN)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                    .setTimestamp()
                ]
            });
        }

        else if (cmd === 'keys') {
            const { data: keys } = await getKeysData();
            const entries = Object.entries(keys);

            if (entries.length === 0) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder().setDescription("🔑 No keys registered.").setColor(YELLOW)]
                });
            }

            const now = Math.floor(Date.now() / 1000);
            const list = entries.map(([k, d]) => {
                const expired = d.expiry && d.expiry < now;
                const status  = expired ? "⛔" : "✅";
                const exp     = d.expiry ? `<t:${d.expiry}:d>` : "∞";
                return `${status} <@${d.discordId}> — ${exp} — \`${k.slice(0, 12)}...\``;
            }).join("\n");

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle(`🔑 Clés — ${entries.length} enregistrées`)
                    .setDescription(list.slice(0, 4000))
                    .setColor(GREEN)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                    .setTimestamp()
                ]
            });
        }

        else if (cmd === 'genkey') {
            const qty   = Math.min(interaction.options.getInteger('quantite') || 1, 50);
            const duree = interaction.options.getString('duree') || 'lifetime';

            if (duree !== 'lifetime' && !parseDuration(duree)) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`❌ Durée invalide : \`${duree}\`. Ex: \`1w\`, \`1mo\`, \`lifetime\``).setColor(RED)] });
            }

            const { data: keys, sha } = await getKeysData();
            const now    = Math.floor(Date.now() / 1000);
            const expiry = duree === 'lifetime' ? null : now + Math.floor(parseDuration(duree) / 1000);
            const generated = [];

            for (let i = 0; i < qty; i++) {
                const key = generateKey();
                keys[key] = { discordId: null, discordTag: null, expiry, hwid: null, createdAt: now };
                generated.push(key);
            }
            await saveKeysData(keys, sha);

            const expiryStr = expiry ? `<t:${expiry}:R>` : '♾️ Lifetime';
            const list = generated.map(k => `\`${k}\``).join('\n');

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle(`🔑 ${qty} clé(s) générée(s)`)
                    .setDescription(list)
                    .addFields({ name: '⏱️ Expire', value: expiryStr, inline: true })
                    .setColor(GREEN).setFooter({ text: 'SMVLL HUB • HS CORP' }).setTimestamp()
                ]
            });
            sendLog(`🔑 ${qty} clé(s) générée(s)`, [
                { name: '🔢 Quantité', value: `${qty}`,                 inline: true },
                { name: '⏱️ Expire',  value: expiryStr,                 inline: true },
                { name: '👮 Par',      value: interaction.user.tag,      inline: true }
            ], GREEN);
        }

        else if (cmd === 'key-info') {
            const key     = interaction.options.getString('key').trim().toUpperCase();
            const { data: keys } = await getKeysData();
            const keyData = keys[key];

            if (!keyData) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`❌ Clé \`${key}\` introuvable.`).setColor(RED)] });

            const now     = Math.floor(Date.now() / 1000);
            const expired = keyData.expiry && keyData.expiry < now;
            const expiryStr = keyData.expiry
                ? (expired ? `⛔ Expiré (<t:${keyData.expiry}:R>)` : `<t:${keyData.expiry}:R>`)
                : '♾️ Lifetime';

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('🔍 Key Info')
                    .addFields(
                        { name: '🔑 Key',      value: `\`${key}\``,                                                          inline: false },
                        { name: '👤 Discord',  value: keyData.discordTag ? `${keyData.discordTag}\n\`${keyData.discordId}\`` : '⚠️ Non lié', inline: true },
                        { name: '📌 Status',   value: expired ? '⛔ Expiré' : keyData.discordId ? '✅ Actif' : '🟡 Non rédimé', inline: true },
                        { name: '⏱️ Expire',  value: expiryStr,                                                               inline: true },
                        { name: '🖥️ HWID',    value: keyData.hwid ? `\`${keyData.hwid.slice(0, 24)}...\`` : '🔓 Non lockée', inline: true },
                        { name: '📅 Créé',     value: `<t:${keyData.createdAt}:D>`,                                           inline: true }
                    )
                    .setColor(expired ? RED : keyData.discordId ? GREEN : YELLOW)
                    .setFooter({ text: 'SMVLL HUB • HS CORP' }).setTimestamp()
                ]
            });
        }

        else if (cmd === 'key-extend') {
            const target = interaction.options.getUser('user');
            const duree  = interaction.options.getString('duree');

            if (duree !== 'lifetime' && !parseDuration(duree)) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`❌ Durée invalide : \`${duree}\``).setColor(RED)] });
            }

            const { data: keys, sha } = await getKeysData();
            const entry = findKeyByDiscordId(keys, target.id);
            if (!entry) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`❌ Aucune clé liée à **${target.tag}**.`).setColor(RED)] });

            const [key, keyData] = entry;
            const now = Math.floor(Date.now() / 1000);

            if (duree === 'lifetime') {
                keyData.expiry = null;
            } else {
                const addSec = Math.floor(parseDuration(duree) / 1000);
                const base   = (keyData.expiry && keyData.expiry > now) ? keyData.expiry : now;
                keyData.expiry = base + addSec;
            }

            keys[key] = keyData;
            await saveKeysData(keys, sha);

            const expiryStr = keyData.expiry ? `<t:${keyData.expiry}:R>` : '♾️ Lifetime';
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Accès étendu')
                    .addFields(
                        { name: '👤 Discord',             value: target.tag, inline: true },
                        { name: '⏱️ Ajouté',             value: duree,      inline: true },
                        { name: '📅 Nouvelle expiration', value: expiryStr,  inline: true }
                    )
                    .setColor(GREEN).setFooter({ text: 'SMVLL HUB • HS CORP' }).setTimestamp()
                ]
            });
            sendLog('⏱️ Key étendue', [
                { name: '👤 Discord', value: target.tag,           inline: true },
                { name: '⏱️ +Durée', value: duree,                 inline: true },
                { name: '📅 Expire',  value: expiryStr,             inline: true },
                { name: '👮 Par',     value: interaction.user.tag,  inline: true }
            ], BLUE);
        }

        else if (cmd === 'key-revoke') {
            const target = interaction.options.getUser('user');
            const { data: keys, sha } = await getKeysData();
            const entry = findKeyByDiscordId(keys, target.id);

            if (!entry) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`❌ Aucune clé liée à **${target.tag}**.`).setColor(RED)] });

            const [key] = entry;
            delete keys[key];
            await saveKeysData(keys, sha);

            if (BUYER_ROLE_ID) {
                const member = await interaction.guild.members.fetch(target.id).catch(() => null);
                if (member) await member.roles.remove(BUYER_ROLE_ID).catch(() => {});
            }

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('🗑️ Clé révoquée')
                    .addFields(
                        { name: '👤 Discord', value: target.tag,    inline: true },
                        { name: '🔑 Clé',     value: `\`${key}\``, inline: true }
                    )
                    .setColor(RED).setFooter({ text: 'SMVLL HUB • HS CORP' }).setTimestamp()
                ]
            });
            sendLog('🗑️ Key révoquée', [
                { name: '👤 Discord', value: target.tag,           inline: true },
                { name: '🔑 Clé',    value: `\`${key}\``,          inline: true },
                { name: '👮 Par',    value: interaction.user.tag,   inline: true }
            ], RED);
        }

        else if (cmd === 'hwid-reset') {
            const target = interaction.options.getUser('user');
            const { data: keys, sha } = await getKeysData();
            const entry = findKeyByDiscordId(keys, target.id);

            if (!entry) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`❌ Aucune clé liée à **${target.tag}**.`).setColor(RED)] });

            const [key, keyData] = entry;
            if (!keyData.hwid) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`⚠️ Le HWID de **${target.tag}** n'est pas encore lockée.`).setColor(YELLOW)] });

            keyData.hwid = null;
            keys[key] = keyData;
            await saveKeysData(keys, sha);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('🔓 HWID Reset (Admin)')
                    .addFields({ name: '👤 Discord', value: target.tag, inline: true })
                    .setColor(GREEN).setFooter({ text: 'SMVLL HUB • HS CORP' }).setTimestamp()
                ]
            });
            sendLog('🔓 HWID reset (admin)', [
                { name: '👤 Target', value: target.tag,           inline: true },
                { name: '👮 Par',    value: interaction.user.tag,  inline: true }
            ], ORANGE);
        }

        else if (cmd === 'stats') {
            const { data: keys } = await getKeysData();
            const entries = Object.values(keys);
            const now     = Math.floor(Date.now() / 1000);

            const total      = entries.length;
            const active     = entries.filter(k => !k.expiry || k.expiry > now).length;
            const expired    = entries.filter(k => k.expiry && k.expiry < now).length;
            const linked     = entries.filter(k => k.discordId).length;
            const unlinked   = entries.filter(k => !k.discordId).length;
            const hwidLocked = entries.filter(k => k.hwid).length;
            const lifetime   = entries.filter(k => !k.expiry).length;

            const uptime = process.uptime();
            const d   = Math.floor(uptime / 86400);
            const h   = Math.floor((uptime % 86400) / 3600);
            const m   = Math.floor((uptime % 3600) / 60);
            const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('📊 SMVLL HUB — Stats')
                    .addFields(
                        { name: '🔑 Total clés',    value: `${total}`,            inline: true },
                        { name: '✅ Actives',        value: `${active}`,           inline: true },
                        { name: '⛔ Expirées',       value: `${expired}`,          inline: true },
                        { name: '🔗 Liées Discord', value: `${linked}`,           inline: true },
                        { name: '⚠️ Non liées',     value: `${unlinked}`,         inline: true },
                        { name: '🔒 HWID lockées',  value: `${hwidLocked}`,       inline: true },
                        { name: '♾️ Lifetime',      value: `${lifetime}`,         inline: true },
                        { name: '⏱️ Uptime',        value: `${d}j ${h}h ${m}m`,  inline: true },
                        { name: '🧠 RAM',            value: `${mem} MB`,           inline: true },
                        { name: '📡 Ping',           value: `${client.ws.ping}ms`, inline: true }
                    )
                    .setColor(BLUE).setFooter({ text: 'SMVLL HUB • HS CORP' }).setTimestamp()
                ]
            });
        }

        else if (cmd === 'panel') {
            console.log(`[panel] triggered by ${interaction.user.tag} in channel ${interaction.channelId}`);
            const channel = interaction.channel ?? await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
            if (!channel) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("❌ Could not access this channel.").setColor(RED)] });
            }

            const imageUrl = interaction.options.getString('image') || client.user.displayAvatarURL({ size: 256 });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_get_script').setLabel('🔑 Get Script').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('btn_reset_hwid').setLabel('🔄 Reset HWID').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('btn_my_stats').setLabel('📊 My Stats').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('btn_redeem_key').setLabel('🎟️ Redeem Key').setStyle(ButtonStyle.Primary),
            );

            await channel.send({
                embeds: [new EmbedBuilder()
                    .setTitle("🟢 SMVLL HUB V2")
                    .setThumbnail(imageUrl)
                    .setDescription(
                        "Welcome to **SMVLL HUB V2**!\n\n" +
                        "**📥 How to get your script:**\n" +
                        "→ Click **🔑 Get Script** — your key & loadstring will be sent in DM\n" +
                        "→ Paste the code in your Roblox executor\n\n" +
                        "**🖥️ Changed PC?** Click **🔄 Reset HWID** to unlock your key.\n" +
                        "**📊 Check your key status?** Click **My Stats**.\n\n" +
                        "💬 *Need help? Open a support ticket.*"
                    )
                    .setColor(GREEN)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                ],
                components: [row]
            });

            await interaction.editReply({
                embeds: [new EmbedBuilder().setDescription("✅ Panel posted.").setColor(GREEN)]
            });
            console.log(`[panel] posted successfully in ${interaction.channelId}`);
        }

    } catch (err) {
        console.error(`[${cmd}] ERROR:`, err);
        interaction.editReply({
            embeds: [new EmbedBuilder()
                .setDescription(`❌ Error: \`${err.message}\``)
                .setColor(RED)]
        }).catch(() => {});
    }
});

// ─── Automod — Anti-pub ────────────────────────────────────────────────
const MUTE_DURATION = 10 * 60 * 1000; // 10 minutes

const AD_PATTERNS = [
    /discord\.gg\/[a-zA-Z0-9]+/i,
    /discord\.com\/invite\/[a-zA-Z0-9]+/i,
    /\.gg\/[a-zA-Z0-9]{2,}/i,
    /\bomg\s*girl\b/i,
    /@everyone/i,
    /@here/i,
    /\bin my bio\b/i,
    /\bcheck( my)? bio\b/i,
    /\bdm me\b/i,
    /\bdm for\b/i,
    /\bdm (me )?for\b/i,
    /\bfree nitro\b/i,
    /\bnitro\s*(gift|giveaway)\b/i,
    /\bgift\s*nitro\b/i,
    /steamcommunity\.com/i,
    /\bself[- ]?promo\b/i,
    /\badvertis(e|ing)\b/i,
    /\badvert\b/i,
];

client.on('messageCreate', async msg => {
    if (msg.author.bot || !msg.guild) return;
    if (msg.author.id === OWNER_ID) return;

    const isAd            = AD_PATTERNS.some(p => p.test(msg.content));
    const hasChannelMention = /<#\d+>/.test(msg.content);
    const hasHeading        = /^#{1,3} /m.test(msg.content);

    if (!isAd && !hasChannelMention && !hasHeading) return;

    try {
        const content = msg.content.slice(0, 300);
        await msg.delete();

        const reason = hasHeading         ? "Big text forbidden"
                     : hasChannelMention  ? "Channel mention"
                     : "Advertisement / spam";

        // Timeout 10 min
        const member = msg.guild.members.cache.get(msg.author.id)
                    || await msg.guild.members.fetch(msg.author.id).catch(() => null);
        let mutedStr = "❌ Failed";
        if (member && member.moderatable) {
            await member.timeout(MUTE_DURATION, reason).catch(() => {});
            mutedStr = "✅ 10 min";
        }

        sendLog("🗑️ Message deleted + mute", [
            { name: "👤 User",    value: `${msg.author.tag} (${msg.author.id})`, inline: true },
            { name: "📌 Channel", value: `<#${msg.channel.id}>`,                 inline: true },
            { name: "⚠️ Reason", value: reason,                                  inline: true },
            { name: "🔇 Mute",   value: mutedStr,                                inline: true },
            { name: "📝 Content", value: `\`\`\`${content}\`\`\``,              inline: false }
        ], ORANGE);

        const warn = await msg.channel.send({
            embeds: [new EmbedBuilder()
                .setTitle("⛔ Automod")
                .setDescription(`<@${msg.author.id}> — **${reason}**\n🔇 Muted for **10 minutes**.`)
                .setColor(RED)
                .setTimestamp()
            ]
        });
        setTimeout(() => warn.delete().catch(() => {}), 8000);
    } catch {}
});

// ─── Anti-raid ────────────────────────────────────────────────────────────────

const RAID_THRESHOLD = 5;
const RAID_WINDOW    = 8000;
const recentJoins    = [];
let   raidLocked     = false;

client.on('guildMemberAdd', async member => {
    const now = Date.now();
    recentJoins.push({ id: member.id, ts: now });

    // Purge les anciens
    while (recentJoins.length && recentJoins[0].ts < now - RAID_WINDOW)
        recentJoins.shift();

    if (raidLocked) {
        try { await member.kick("Anti-raid — lockdown actif"); } catch {}
        return;
    }

    if (recentJoins.length >= RAID_THRESHOLD) {
        raidLocked = true;
        const guild   = member.guild;
        const channel = client.channels.cache.get(LOG_CHANNEL_ID);

        let kicked = 0;
        for (const entry of [...recentJoins]) {
            try {
                const m = guild.members.cache.get(entry.id)
                       || await guild.members.fetch(entry.id).catch(() => null);
                if (m) { await m.kick("Anti-raid automatique"); kicked++; }
            } catch {}
        }

        // Lockdown : bloque @everyone dans tous les salons texte
        const everyoneRole = guild.roles.everyone;
        for (const [, ch] of guild.channels.cache) {
            if (!ch.isTextBased()) continue;
            try {
                await ch.permissionOverwrites.edit(everyoneRole, { SendMessages: false });
            } catch {}
        }

        if (channel) {
            channel.send({
                embeds: [new EmbedBuilder()
                    .setTitle("🚨 RAID DÉTECTÉ — Lockdown activé")
                    .addFields(
                        { name: "👢 Kickés",    value: `${kicked}`,                     inline: true },
                        { name: "⚡ Joins/8s", value: `${recentJoins.length}`,           inline: true },
                        { name: "🔒 Statut",   value: "Tous les salons verrouillés",    inline: false },
                        { name: "ℹ️ Info",     value: "Fais `/unlock` pour déverrouiller", inline: false }
                    )
                    .setColor(RED)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                    .setTimestamp()
                ]
            });
        }

        // Auto-unlock après 5 minutes
        setTimeout(async () => {
            for (const [, ch] of guild.channels.cache) {
                if (!ch.isTextBased()) continue;
                try {
                    await ch.permissionOverwrites.edit(everyoneRole, { SendMessages: null });
                } catch {}
            }
            raidLocked = false;
            recentJoins.length = 0;
            if (channel) {
                channel.send({
                    embeds: [new EmbedBuilder()
                        .setDescription("✅ Lockdown levé automatiquement après 5 minutes.")
                        .setColor(GREEN)]
                });
            }
        }, 5 * 60 * 1000);
    }
});

client.login(TOKEN);

// ─── HTTP Server — Keep-alive + /verify + /script ────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://localhost`);

    if (req.method === 'GET' && parsedUrl.pathname === '/verify') {
        const key  = parsedUrl.searchParams.get('key')  || '';
        const hwid = parsedUrl.searchParams.get('hwid') || '';
        res.setHeader('Content-Type', 'application/json');
        try {
            const { data: keys, sha } = await getKeysData();
            const keyData = keys[key];

            if (!keyData) {
                res.writeHead(200);
                return res.end(JSON.stringify({ valid: false, reason: "Key not found" }));
            }

            const now = Math.floor(Date.now() / 1000);
            if (keyData.expiry && keyData.expiry < now) {
                res.writeHead(200);
                return res.end(JSON.stringify({ valid: false, reason: "Key expired" }));
            }

            if (!keyData.hwid) {
                keyData.hwid = hwid;
                keys[key] = keyData;
                await saveKeysData(keys, sha);
                res.writeHead(200);
                return res.end(JSON.stringify({ valid: true }));
            }

            if (keyData.hwid === hwid) {
                res.writeHead(200);
                return res.end(JSON.stringify({ valid: true }));
            }

            res.writeHead(200);
            return res.end(JSON.stringify({ valid: false, reason: "Invalid HWID. Use /reset-hwid in the Discord server." }));
        } catch (e) {
            console.error("verify error:", e.message);
            res.writeHead(500);
            return res.end(JSON.stringify({ valid: false, reason: "Server error" }));
        }
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/script') {
        const key  = parsedUrl.searchParams.get('key')  || '';
        const hwid = parsedUrl.searchParams.get('hwid') || '';
        res.setHeader('Content-Type', 'text/plain');
        try {
            const { data: keys, sha } = await getKeysData();
            const keyData = keys[key];

            if (!keyData) {
                res.writeHead(200);
                return res.end(`error("[SMVLL HUB] Access denied — Key not found")`);
            }

            const now = Math.floor(Date.now() / 1000);
            if (keyData.expiry && keyData.expiry < now) {
                res.writeHead(200);
                return res.end(`error("[SMVLL HUB] Access denied — Key expired")`);
            }

            if (!keyData.hwid) {
                keyData.hwid = hwid;
                keys[key] = keyData;
                await saveKeysData(keys, sha);
            } else if (keyData.hwid !== hwid) {
                res.writeHead(200);
                return res.end(`error("[SMVLL HUB] Access denied — Invalid HWID. Use /reset-hwid in Discord.")`);
            }

            const scriptUrl = process.env.SCRIPT_LOADSTRING_URL || '';
            if (!scriptUrl) {
                res.writeHead(200);
                return res.end(`error("[SMVLL HUB] Script not configured.")`);
            }

            const scriptRes = await axios.get(scriptUrl, { responseType: 'text' });
            res.writeHead(200);
            return res.end(scriptRes.data);
        } catch (e) {
            console.error("script endpoint error:", e.message);
            res.writeHead(200);
            return res.end(`error("[SMVLL HUB] Server error.")`);
        }
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('OK');
    }

    // ── Dashboard auth helper ─────────────────────────────────────
    const DASH_TOKEN = process.env.DASHBOARD_TOKEN || '';
    const reqToken   = parsedUrl.searchParams.get('token') || (req.headers['x-dashboard-token'] || '');
    const authOk     = DASH_TOKEN && reqToken === DASH_TOKEN;

    // ── Dashboard API ─────────────────────────────────────────────
    if (parsedUrl.pathname.startsWith('/api/dash/')) {
        res.setHeader('Content-Type', 'application/json');
        if (!authOk) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }

        if (req.method === 'GET' && parsedUrl.pathname === '/api/dash/keys') {
            const { data: keys } = await getKeysData().catch(() => ({ data: {} }));
            const now = Math.floor(Date.now() / 1000);
            const list = Object.entries(keys).map(([k, v]) => ({
                key:       k,
                discordId: v.discordId  || null,
                discordTag:v.discordTag || null,
                hwid:      v.hwid       || null,
                expiry:    v.expiry     || null,
                createdAt: v.createdAt  || null,
                expired:   v.expiry ? v.expiry < now : false,
            }));
            res.writeHead(200);
            return res.end(JSON.stringify({ success: true, keys: list }));
        }

        // Parse body for POST/DELETE
        const body = await new Promise(resolve => {
            let d = '';
            req.on('data', c => d += c);
            req.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
        });

        if (req.method === 'POST' && parsedUrl.pathname === '/api/dash/reset-hwid') {
            const { key } = body;
            const { data: keys, sha } = await getKeysData();
            if (!keys[key]) { res.writeHead(404); return res.end(JSON.stringify({ error: 'Key not found' })); }
            keys[key].hwid = null;
            await saveKeysData(keys, sha);
            res.writeHead(200); return res.end(JSON.stringify({ success: true }));
        }

        if (req.method === 'DELETE' && parsedUrl.pathname === '/api/dash/key') {
            const key = body.key || parsedUrl.searchParams.get('key');
            const { data: keys, sha } = await getKeysData();
            if (!keys[key]) { res.writeHead(404); return res.end(JSON.stringify({ error: 'Key not found' })); }
            delete keys[key];
            await saveKeysData(keys, sha);
            res.writeHead(200); return res.end(JSON.stringify({ success: true }));
        }

        if (req.method === 'POST' && parsedUrl.pathname === '/api/dash/extend') {
            const { key, days } = body;
            const { data: keys, sha } = await getKeysData();
            if (!keys[key]) { res.writeHead(404); return res.end(JSON.stringify({ error: 'Key not found' })); }
            const now = Math.floor(Date.now() / 1000);
            const base = (keys[key].expiry && keys[key].expiry > now) ? keys[key].expiry : now;
            keys[key].expiry = base + (parseInt(days) || 30) * 86400;
            await saveKeysData(keys, sha);
            res.writeHead(200); return res.end(JSON.stringify({ success: true, expiry: keys[key].expiry }));
        }

        if (req.method === 'POST' && parsedUrl.pathname === '/api/dash/create') {
            const { days, discordTag } = body;
            const { data: keys, sha } = await getKeysData();
            const newKey = (() => {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                const seg = () => Array.from({length:5}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
                return `SMVLL-${seg()}-${seg()}-${seg()}`;
            })();
            const now = Math.floor(Date.now() / 1000);
            keys[newKey] = {
                discordId:  null,
                discordTag: discordTag || null,
                expiry:     days ? now + parseInt(days) * 86400 : null,
                hwid:       null,
                createdAt:  now,
            };
            await saveKeysData(keys, sha);
            res.writeHead(200); return res.end(JSON.stringify({ success: true, key: newKey }));
        }

        res.writeHead(404); return res.end(JSON.stringify({ error: 'Not found' }));
    }

    // ── Dashboard HTML ────────────────────────────────────────────
    if (req.method === 'GET' && parsedUrl.pathname === '/dashboard') {
        if (!authOk) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SMVLL HUB — Login</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#080808;color:#fff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}
.box{background:#101010;border:1px solid #00ff6440;border-radius:13px;padding:36px;text-align:center;width:320px;box-shadow:0 0 40px #00ff6410}
.logo{font-size:1.1rem;font-weight:700;color:#00ff64;margin-bottom:6px}.sub{font-size:.75rem;color:#444;margin-bottom:24px}
input{width:100%;padding:9px 13px;background:#080808;border:1px solid #282828;border-radius:7px;color:#fff;font-size:.9rem;margin-bottom:13px;font-family:inherit;transition:.15s}
input:focus{outline:none;border-color:#00ff64}
button{width:100%;padding:9px;background:#00ff64;color:#000;font-weight:700;border:none;border-radius:7px;cursor:pointer;font-size:.9rem;transition:.15s}
button:hover{background:#00cc50}</style></head><body>
<div class="box"><div class="logo">SMVLL HUB</div><div class="sub">Admin Dashboard</div>
<input type="password" id="t" placeholder="Dashboard token" onkeydown="if(event.key==='Enter')login()">
<button onclick="login()">Login</button></div>
<script>function login(){const t=document.getElementById('t').value;if(t)window.location.href='/dashboard?token='+encodeURIComponent(t);}</script>
</html>`);
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        try {
            return res.end(fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8'));
        } catch(e) {
            return res.end(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SMVLL HUB — Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d0d0d;color:#e0e0e0;font-family:system-ui,-apple-system,sans-serif;min-height:100vh}
header{background:#111;border-bottom:1px solid #00ff6430;padding:16px 32px;display:flex;align-items:center;gap:12px}
header h1{color:#00ff64;font-size:1.3rem}header span{color:#555;font-size:.85rem;margin-left:auto}
.container{padding:32px;max-width:1400px;margin:0 auto}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:32px}
.stat{background:#161616;border:1px solid #222;border-radius:10px;padding:20px;text-align:center}
.stat .n{font-size:2rem;font-weight:700;color:#00ff64}.stat .l{font-size:.8rem;color:#666;margin-top:4px}
.toolbar{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center}
.toolbar input{background:#161616;border:1px solid #333;border-radius:8px;padding:8px 14px;color:#fff;font-size:.9rem;width:260px}
.toolbar input:focus{outline:none;border-color:#00ff64}
.btn{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:.85rem;font-weight:600;transition:.15s}
.btn-green{background:#00ff64;color:#000}.btn-green:hover{background:#00cc50}
.btn-blue{background:#4488ff;color:#fff}.btn-blue:hover{background:#2266dd}
.btn-red{background:#ff4444;color:#fff}.btn-red:hover{background:#cc2222}
.btn-orange{background:#ff8800;color:#fff}.btn-orange:hover{background:#cc6600}
.btn-sm{padding:4px 10px;font-size:.78rem}
table{width:100%;border-collapse:collapse;background:#111;border-radius:12px;overflow:hidden}
thead{background:#161616}th{padding:12px 16px;text-align:left;font-size:.78rem;color:#666;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
td{padding:11px 16px;border-bottom:1px solid #1a1a1a;font-size:.85rem}
tr:last-child td{border-bottom:none}tr:hover td{background:#141414}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.75rem;font-weight:600}
.badge-green{background:#00ff6420;color:#00ff64;border:1px solid #00ff6440}
.badge-red{background:#ff444420;color:#ff4444;border:1px solid #ff444440}
.badge-orange{background:#ff880020;color:#ff8800;border:1px solid #ff880040}
.badge-gray{background:#33333350;color:#888;border:1px solid #333}
.key-val{font-family:monospace;font-size:.8rem;color:#aaa}
.modal-bg{display:none;position:fixed;inset:0;background:#000a;z-index:100;align-items:center;justify-content:center}
.modal-bg.open{display:flex}
.modal{background:#161616;border:1px solid #333;border-radius:12px;padding:28px;width:380px;max-width:90vw}
.modal h2{color:#00ff64;margin-bottom:20px;font-size:1.1rem}
.modal label{display:block;font-size:.82rem;color:#888;margin-bottom:6px}
.modal input,.modal select{width:100%;background:#0d0d0d;border:1px solid #333;border-radius:8px;padding:8px 12px;color:#fff;font-size:.9rem;margin-bottom:14px}
.modal input:focus,.modal select:focus{outline:none;border-color:#00ff64}
.modal-footer{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}
.toast{position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:8px;font-size:.9rem;font-weight:600;z-index:200;opacity:0;transition:.3s}
.toast.show{opacity:1}
.toast-ok{background:#00ff6420;border:1px solid #00ff64;color:#00ff64}
.toast-err{background:#ff444420;border:1px solid #ff4444;color:#ff4444}
</style></head><body>
<header><h1>🟢 SMVLL HUB</h1><div style="color:#00ff64;font-size:.85rem;margin-left:12px">Dashboard</div>
<span id="lastRefresh">Loading...</span></header>
<div class="container">
  <div class="stats">
    <div class="stat"><div class="n" id="s-total">—</div><div class="l">Total keys</div></div>
    <div class="stat"><div class="n" id="s-active">—</div><div class="l">Active</div></div>
    <div class="stat"><div class="n" id="s-expired">—</div><div class="l">Expired</div></div>
    <div class="stat"><div class="n" id="s-linked">—</div><div class="l">Linked</div></div>
    <div class="stat"><div class="n" id="s-hwid">—</div><div class="l">HWID locked</div></div>
  </div>
  <div class="toolbar">
    <input id="search" placeholder="🔍 Search key, Discord tag..." oninput="renderTable()">
    <button class="btn btn-green" onclick="openCreateModal()">+ New key</button>
    <button class="btn btn-blue" onclick="loadKeys()">↻ Refresh</button>
  </div>
  <table id="keyTable">
    <thead><tr>
      <th>Key</th><th>Discord</th><th>Status</th><th>Expires</th><th>HWID</th><th>Created</th><th>Actions</th>
    </tr></thead>
    <tbody id="tbody"></tbody>
  </table>
</div>

<!-- Create modal -->
<div class="modal-bg" id="createModal">
  <div class="modal">
    <h2>+ Generate new key</h2>
    <label>Expiration (days, blank = lifetime)</label>
    <input type="number" id="c-days" placeholder="30">
    <label>Discord tag (optional)</label>
    <input type="text" id="c-tag" placeholder="user#0000">
    <div class="modal-footer">
      <button class="btn btn-red btn-sm" onclick="closeModal('createModal')">Cancel</button>
      <button class="btn btn-green btn-sm" onclick="createKey()">Generate</button>
    </div>
  </div>
</div>

<!-- Extend modal -->
<div class="modal-bg" id="extendModal">
  <div class="modal">
    <h2>⏱️ Extend key</h2>
    <label>Days to add</label>
    <input type="number" id="e-days" placeholder="30" value="30">
    <input type="hidden" id="e-key">
    <div class="modal-footer">
      <button class="btn btn-red btn-sm" onclick="closeModal('extendModal')">Cancel</button>
      <button class="btn btn-orange btn-sm" onclick="extendKey()">Extend</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const TOKEN = new URLSearchParams(location.search).get('token') || '';
let allKeys = [];

function ts(n){ if(!n)return '♾️ Lifetime'; const d=new Date(n*1000); return d.toLocaleDateString()+' '+d.toHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0'); }
function fmtDate(n){ if(!n)return '—'; const d=new Date(n*1000); return d.toLocaleDateString(); }
function toast(msg,ok=true){ const t=document.getElementById('toast'); t.textContent=msg; t.className='toast show '+(ok?'toast-ok':'toast-err'); setTimeout(()=>t.className='toast',2500); }

async function api(path, method='GET', body=null){
  const opts={method, headers:{'Content-Type':'application/json','x-dashboard-token':TOKEN}};
  if(body) opts.body=JSON.stringify(body);
  const r=await fetch('/api/dash'+path+'?token='+TOKEN,opts);
  return r.json();
}

async function loadKeys(){
  const r=await api('/keys');
  if(!r.success){toast('Failed to load keys',false);return;}
  allKeys=r.keys;
  const now=Math.floor(Date.now()/1000);
  document.getElementById('s-total').textContent=allKeys.length;
  document.getElementById('s-active').textContent=allKeys.filter(k=>!k.expired).length;
  document.getElementById('s-expired').textContent=allKeys.filter(k=>k.expired).length;
  document.getElementById('s-linked').textContent=allKeys.filter(k=>k.discordId).length;
  document.getElementById('s-hwid').textContent=allKeys.filter(k=>k.hwid).length;
  document.getElementById('lastRefresh').textContent='Last refresh: '+new Date().toLocaleTimeString();
  renderTable();
}

function renderTable(){
  const q=(document.getElementById('search').value||'').toLowerCase();
  const rows=allKeys.filter(k=>
    k.key.toLowerCase().includes(q)||
    (k.discordTag||'').toLowerCase().includes(q)||
    (k.discordId||'').includes(q)
  );
  const tb=document.getElementById('tbody');
  tb.innerHTML=rows.map(k=>{
    const status=k.expired
      ? '<span class="badge badge-red">Expired</span>'
      : k.discordId
        ? '<span class="badge badge-green">Active</span>'
        : '<span class="badge badge-orange">Unlinked</span>';
    const expiry=k.expiry?fmtDate(k.expiry):'<span style="color:#00ff64">♾️ Lifetime</span>';
    const hwid=k.hwid
      ? '<span class="badge badge-green">🔒 Locked</span>'
      : '<span class="badge badge-gray">Unlocked</span>';
    const discord=k.discordTag
      ? k.discordTag+(k.discordId?'<br><span style="font-size:.72rem;color:#555">'+k.discordId+'</span>':'')
      : '<span style="color:#555">—</span>';
    return \`<tr>
      <td><span class="key-val">\${k.key}</span></td>
      <td>\${discord}</td>
      <td>\${status}</td>
      <td>\${expiry}</td>
      <td>\${hwid}</td>
      <td>\${fmtDate(k.createdAt)}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        \${k.hwid?'<button class="btn btn-orange btn-sm" onclick="resetHwid(\\''+k.key+'\\')">↺ HWID</button>':''}
        <button class="btn btn-blue btn-sm" onclick="openExtend(\\''+k.key+'\\')">+ Days</button>
        <button class="btn btn-red btn-sm" onclick="deleteKey(\\''+k.key+'\\')">🗑</button>
      </td>
    </tr>\`;
  }).join('');
}

async function resetHwid(key){
  if(!confirm('Reset HWID for '+key+'?'))return;
  const r=await api('/reset-hwid','POST',{key});
  r.success?toast('HWID reset ✓'):toast('Error: '+(r.error||'?'),false);
  loadKeys();
}

async function deleteKey(key){
  if(!confirm('Delete key '+key+'? This cannot be undone.'))return;
  const r=await api('/key','DELETE',{key});
  r.success?toast('Key deleted ✓'):toast('Error: '+(r.error||'?'),false);
  loadKeys();
}

function openExtend(key){ document.getElementById('e-key').value=key; openModal('extendModal'); }
async function extendKey(){
  const key=document.getElementById('e-key').value;
  const days=parseInt(document.getElementById('e-days').value)||30;
  const r=await api('/extend','POST',{key,days});
  r.success?toast('Extended +'+days+' days ✓'):toast('Error: '+(r.error||'?'),false);
  closeModal('extendModal'); loadKeys();
}

function openCreateModal(){ document.getElementById('c-days').value=''; document.getElementById('c-tag').value=''; openModal('createModal'); }
async function createKey(){
  const days=document.getElementById('c-days').value;
  const discordTag=document.getElementById('c-tag').value.trim()||null;
  const r=await api('/create','POST',{days:days?parseInt(days):null,discordTag});
  if(r.success){ toast('Key created: '+r.key); closeModal('createModal'); loadKeys(); }
  else toast('Error: '+(r.error||'?'),false);
}

function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-bg').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('open');}));

<h1 style="color:#ff4444;font-family:system-ui;padding:40px">dashboard.html not found</h1>`);
        }
    }

    res.writeHead(200);
    res.end("SMVLL HUB — online");
}).listen(PORT, () => {
    console.log(`✅ HTTP server on port ${PORT}`);
    const selfUrl = process.env.RENDER_EXTERNAL_URL;
    if (selfUrl) {
        const pingUrl = selfUrl.replace(/\/$/, '') + '/health';
        setInterval(() => axios.get(pingUrl).catch(() => {}), 2 * 60 * 1000);
        console.log(`✅ Self-ping active every 2 min → ${pingUrl}`);
    }
});
