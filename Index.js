const {
    Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder,
    REST, Routes, SlashCommandBuilder,
    ButtonBuilder, ButtonStyle, ActionRowBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const axios = require('axios');
const ms    = require('ms');
const http  = require('http');

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
        .setName('wl-add')
        .setDescription('Ajouter un user à la whitelist')
        .addStringOption(o => o.setName('user').setDescription('Nom Roblox').setRequired(true))
        .addStringOption(o => o.setName('time').setDescription('Ex: 1w, 2m, lifetime').setRequired(true)),

    new SlashCommandBuilder()
        .setName('wl-remove')
        .setDescription('Retirer un user de la whitelist')
        .addStringOption(o => o.setName('user').setDescription('Nom Roblox').setRequired(true)),

    new SlashCommandBuilder()
        .setName('wl-edit')
        .setDescription('Modifier la durée d\'un user')
        .addStringOption(o => o.setName('user').setDescription('Nom Roblox').setRequired(true))
        .addStringOption(o => o.setName('time').setDescription('Nouvelle durée').setRequired(true)),

    new SlashCommandBuilder()
        .setName('wl-renew')
        .setDescription('Renouveler la durée d\'un user')
        .addStringOption(o => o.setName('user').setDescription('Nom Roblox').setRequired(true))
        .addStringOption(o => o.setName('time').setDescription('Durée à ajouter').setRequired(true)),

    new SlashCommandBuilder()
        .setName('wl-check')
        .setDescription('Voir l\'expiration d\'un user')
        .addStringOption(o => o.setName('user').setDescription('Nom Roblox').setRequired(true)),

    new SlashCommandBuilder()
        .setName('wl-search')
        .setDescription('Rechercher un user dans la whitelist (partiel)')
        .addStringOption(o => o.setName('query').setDescription('Partie du nom').setRequired(true)),

    new SlashCommandBuilder()
        .setName('wl-list')
        .setDescription('Voir toute la whitelist'),

    new SlashCommandBuilder()
        .setName('wl-stats')
        .setDescription('Statistiques de la whitelist'),

    new SlashCommandBuilder()
        .setName('wl-expire-soon')
        .setDescription('Voir les users qui expirent bientôt')
        .addIntegerOption(o => o.setName('jours').setDescription('Dans combien de jours').setRequired(false)),

    new SlashCommandBuilder()
        .setName('wl-clear')
        .setDescription('⚠️ Vider toute la whitelist'),

    new SlashCommandBuilder()
        .setName('wl-purge-expired')
        .setDescription('Supprimer tous les users expirés de la whitelist'),

    new SlashCommandBuilder()
        .setName('wl-import')
        .setDescription('Importer plusieurs users d\'un coup')
        .addStringOption(o => o.setName('users').setDescription('Noms séparés par des virgules').setRequired(true))
        .addStringOption(o => o.setName('time').setDescription('Durée pour tous. Default: lifetime').setRequired(false)),

    new SlashCommandBuilder()
        .setName('bl-add')
        .setDescription('Blacklister un user')
        .addStringOption(o => o.setName('user').setDescription('Nom Roblox').setRequired(true)),

    new SlashCommandBuilder()
        .setName('bl-remove')
        .setDescription('Retirer du blacklist')
        .addStringOption(o => o.setName('user').setDescription('Nom Roblox').setRequired(true)),

    new SlashCommandBuilder()
        .setName('bl-list')
        .setDescription('Voir la blacklist'),

    new SlashCommandBuilder()
        .setName('bl-check')
        .setDescription('Vérifier si un user est blacklisté')
        .addStringOption(o => o.setName('user').setDescription('Nom Roblox').setRequired(true)),

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
        .setName('wl-transfer')
        .setDescription('Transférer la whitelist d\'un user à un autre (changement de pseudo Roblox)')
        .addStringOption(o => o.setName('old').setDescription('Ancien nom Roblox').setRequired(true))
        .addStringOption(o => o.setName('new').setDescription('Nouveau nom Roblox').setRequired(true)),

    new SlashCommandBuilder()
        .setName('wl-batch-remove')
        .setDescription('Retirer plusieurs users de la whitelist d\'un coup')
        .addStringOption(o => o.setName('users').setDescription('Noms séparés par des virgules').setRequired(true)),

    new SlashCommandBuilder()
        .setName('wl-export')
        .setDescription('Exporter la whitelist complète en fichier .txt'),

    new SlashCommandBuilder()
        .setName('bl-clear')
        .setDescription('⚠️ Vider toute la blacklist'),

    new SlashCommandBuilder()
        .setName('bl-import')
        .setDescription('Importer plusieurs users dans la blacklist d\'un coup')
        .addStringOption(o => o.setName('users').setDescription('Noms séparés par des virgules').setRequired(true)),

    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Dashboard complet — WL, BL et stats du bot'),

    new SlashCommandBuilder()
        .setName('free4all')
        .setDescription('Toggle Free4All — désactive la WL et gèle les expirations')
        .addStringOption(o => o.setName('time').setDescription('Durée optionnelle (ex: 1h, 1d, 1w)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Lever le lockdown anti-raid manuellement'),

    new SlashCommandBuilder()
        .setName('wl-recover')
        .setDescription('Ajouter du temps à tous les actifs + expirés depuis max X (depuis GitHub)')
        .addStringOption(o => o.setName('time').setDescription('Temps à ajouter (ex: 1w, 1mo, lifetime)').setRequired(true))
        .addStringOption(o => o.setName('since').setDescription('Inclure aussi les expirés depuis max X (ex: 1w, 1mo). Vide = actifs seulement').setRequired(false)),

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
            const scriptUrl = process.env.SCRIPT_LOADSTRING_URL || 'CONFIGURE_SCRIPT_LOADSTRING_URL';
            const script = `SCRIPT_KEY = "${key}"\nloadstring(game:HttpGet("${scriptUrl}"))()`;
            try {
                await interaction.user.send({ content: `\`\`\`lua\n${script}\n\`\`\`` });
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
                    .setTitle("📖 Guide d'utilisation — SMVLL HUB Bot")
                    .addFields(
                        { name: "⏱️ Secondes",    value: "`1s`, `30s`",    inline: true },
                        { name: "⏱️ Minutes",     value: "`1m`, `15m`",    inline: true },
                        { name: "⏱️ Heures",      value: "`1h`, `12h`",    inline: true },
                        { name: "📅 Jours",       value: "`1d`, `3d`",     inline: true },
                        { name: "📅 Semaines",    value: "`1w`, `2w`",     inline: true },
                        { name: "📅 Années",      value: "`1y`",           inline: true },
                        { name: "♾️ À vie",       value: "`lifetime`",     inline: false },
                        { name: "━━━━━━━━━━━━━━━━", value: "**Commandes**", inline: false },
                        { name: "📋 Whitelist",   value: "`/wl-add` `/wl-remove` `/wl-edit` `/wl-renew` `/wl-check` `/wl-list` `/wl-stats` `/wl-expire-soon` `/wl-clear` `/wl-purge-expired` `/wl-import` `/wl-search` `/wl-transfer` `/wl-batch-remove` `/wl-export` `/wl-renew-expired`", inline: false },
                        { name: "🚫 Blacklist",   value: "`/bl-add` `/bl-remove` `/bl-list` `/bl-check` `/bl-clear` `/bl-import`", inline: false },
                        { name: "📨 Messages",    value: "`/dmall` `/announce` `/dm` `/test-dm`",     inline: false },
                        { name: "🔑 Clés",        value: "`/sell` `/get-script` `/reset-hwid` `/my-stats` `/keys`", inline: false },
                        { name: "🔧 Utilitaires", value: "`/ping` `/botinfo` `/status` `/free4all`",  inline: false }
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

        else if (cmd === 'wl-add') {
            const user = interaction.options.getString('user');
            const time = interaction.options.getString('time');
            let { content, sha } = await getFile();
            content = cleanExpired(content);

            if (parseUsers(content).some(l => getUserName(l).toLowerCase() === user.toLowerCase())) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription(`⚠️ **${user}** est déjà dans la whitelist.`)
                        .setColor(YELLOW)]
                });
            }

            content = content.trimEnd() + "\n" + buildEntry(user, time);
            await updateFile(content, sha);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("✅ Whitelist ajoutée")
                    .addFields(
                        { name: "👤 User",   value: user, inline: true },
                        { name: "⏱️ Durée", value: time, inline: true }
                    )
                    .setColor(GREEN)]
            });

            sendLog("✅ Whitelist ajoutée", [
                { name: "👤 User",   value: user,                    inline: true },
                { name: "⏱️ Durée", value: time,                    inline: true },
                { name: "👮 Par",   value: interaction.user.tag,    inline: true }
            ], GREEN);
        }

        else if (cmd === 'wl-remove') {
            const user = interaction.options.getString('user');
            let { content, sha } = await getFile();
            const before = content;
            content = parseUsers(content).filter(l => getUserName(l).toLowerCase() !== user.toLowerCase()).join("\n");

            if (content === before.trim()) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder().setDescription(`❌ **${user}** introuvable.`).setColor(RED)]
                });
            }

            await updateFile(content, sha);
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("🗑️ User retiré")
                    .setDescription(`**${user}** retiré de la whitelist.`)
                    .setColor(RED)]
            });

            sendLog("🗑️ Whitelist retirée", [
                { name: "👤 User", value: user,                 inline: true },
                { name: "👮 Par",  value: interaction.user.tag, inline: true }
            ], RED);
        }

        else if (cmd === 'wl-edit') {
            const user = interaction.options.getString('user');
            const time = interaction.options.getString('time');
            let { content, sha } = await getFile();
            const lines = parseUsers(content);
            const idx = lines.findIndex(l => getUserName(l).toLowerCase() === user.toLowerCase());

            if (idx === -1) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder().setDescription(`❌ **${user}** introuvable.`).setColor(RED)]
                });
            }

            lines[idx] = buildEntry(user, time);
            await updateFile(lines.join("\n"), sha);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("✏️ Durée modifiée")
                    .addFields(
                        { name: "👤 User",            value: user, inline: true },
                        { name: "⏱️ Nouvelle durée", value: time, inline: true }
                    )
                    .setColor(BLUE)]
            });

            sendLog("✏️ Whitelist modifiée", [
                { name: "👤 User",            value: user,                    inline: true },
                { name: "⏱️ Nouvelle durée", value: time,                    inline: true },
                { name: "👮 Par",             value: interaction.user.tag,    inline: true }
            ], BLUE);
        }

        else if (cmd === 'wl-renew') {
            const user = interaction.options.getString('user');
            const time = interaction.options.getString('time');
            let { content, sha } = await getFile();
            const lines = parseUsers(content);
            const idx = lines.findIndex(l => getUserName(l).toLowerCase() === user.toLowerCase());

            if (idx === -1) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder().setDescription(`❌ **${user}** introuvable.`).setColor(RED)]
                });
            }

            const currentExp = getExpiry(lines[idx]);
            const base = currentExp && currentExp > Math.floor(Date.now() / 1000)
                ? currentExp * 1000
                : Date.now();
            const newExp = Math.floor((base + parseDuration(time)) / 1000);
            lines[idx] = `${user},${newExp}`;
            await updateFile(lines.join("\n"), sha);

            const days = Math.ceil((newExp - Math.floor(Date.now() / 1000)) / 86400);
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("🔄 Whitelist renouvelée")
                    .addFields(
                        { name: "👤 User",        value: user,       inline: true },
                        { name: "📅 Expire dans", value: `${days}j`, inline: true }
                    )
                    .setColor(GREEN)]
            });

            sendLog("🔄 Whitelist renouvelée", [
                { name: "👤 User",        value: user,                    inline: true },
                { name: "📅 Expire dans", value: `${days}j`,              inline: true },
                { name: "👮 Par",         value: interaction.user.tag,    inline: true }
            ], GREEN);
        }

        else if (cmd === 'wl-check') {
            const user = interaction.options.getString('user');
            const { content } = await getFile();
            const line = parseUsers(content).find(l => getUserName(l).toLowerCase() === user.toLowerCase());

            if (!line) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder().setDescription(`❌ **${user}** introuvable.`).setColor(RED)]
                });
            }

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("🔍 Whitelist Check")
                    .addFields(
                        { name: "👤 User",       value: user,                                               inline: true },
                        { name: "⏱️ Expiration", value: formatExpiry(line),                                 inline: true },
                        { name: "📌 Statut",     value: isExpired(line) ? "⛔ Expiré" : "✅ Actif",        inline: true }
                    )
                    .setColor(isExpired(line) ? RED : BLUE)]
            });
        }

        else if (cmd === 'wl-search') {
            const query = interaction.options.getString('query').toLowerCase();
            const { content } = await getFile();
            const results = parseUsers(content).filter(l => getUserName(l).toLowerCase().includes(query));

            if (!results.length) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription(`❌ Aucun résultat pour \`${query}\`.`)
                        .setColor(RED)]
                });
            }

            const list = results.map(line => `• **${getUserName(line)}** — ${formatExpiry(line)}`).join("\n");
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle(`🔎 "${query}" — ${results.length} trouvé(s)`)
                    .setDescription(list)
                    .setColor(BLUE)]
            });
        }

        else if (cmd === 'wl-list') {
            let { content } = await getFile();
            content = cleanExpired(content);
            const lines = parseUsers(content);

            if (!lines.length) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder().setDescription("📋 Whitelist vide.").setColor(YELLOW)]
                });
            }

            const chunkSize = 25;
            const chunks = [];
            for (let i = 0; i < lines.length; i += chunkSize) {
                chunks.push(lines.slice(i, i + chunkSize));
            }

            const embeds = chunks.map((chunk, idx) =>
                new EmbedBuilder()
                    .setTitle(idx === 0 ? `📋 Whitelist — ${lines.length} users` : `📋 Suite (${idx + 1}/${chunks.length})`)
                    .setDescription(chunk.map(line => `• **${getUserName(line)}** — ${formatExpiry(line)}`).join("\n"))
                    .setColor(GREEN)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
            );

            await interaction.editReply({ embeds: embeds.slice(0, 10) });
        }

        else if (cmd === 'wl-stats') {
            const { content } = await getFile();
            const all      = parseUsers(content);
            const actifs   = all.filter(l => !isExpired(l)).length;
            const expires  = all.filter(l => isExpired(l)).length;
            const lifetime = all.filter(l => !getExpiry(l)).length;
            const { content: blContent } = await getFile("blacklist.txt").catch(() => ({ content: "" }));
            const blacklisted = parseUsers(blContent).length;

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("📊 SMVLL HUB — Stats")
                    .addFields(
                        { name: "✅ Actifs",    value: `${actifs}`,     inline: true },
                        { name: "⛔ Expirés",  value: `${expires}`,    inline: true },
                        { name: "♾️ Lifetime", value: `${lifetime}`,   inline: true },
                        { name: "🚫 Blacklist",value: `${blacklisted}`,inline: true },
                        { name: "📦 Total WL", value: `${all.length}`, inline: true }
                    )
                    .setColor(GREEN)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                    .setTimestamp()
                ]
            });
        }

        else if (cmd === 'wl-expire-soon') {
            const jours = interaction.options.getInteger('jours') || 3;
            const { content } = await getFile();
            const now   = Math.floor(Date.now() / 1000);
            const limit = jours * 86400;

            const soon = parseUsers(content).filter(line => {
                const exp  = getExpiry(line);
                if (!exp) return false;
                const diff = exp - now;
                return diff > 0 && diff <= limit;
            });

            if (!soon.length) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription(`✅ Aucun user n'expire dans les ${jours} prochains jours.`)
                        .setColor(GREEN)]
                });
            }

            const list = soon.map(line => `• **${getUserName(line)}** — ${formatExpiry(line)}`).join("\n");
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle(`⚠️ Expire dans ${jours}j — ${soon.length} user(s)`)
                    .setDescription(list)
                    .setColor(ORANGE)]
            });
        }

        else if (cmd === 'wl-clear') {
            const { sha } = await getFile();
            await updateFile("", sha);
            await interaction.editReply({
                embeds: [new EmbedBuilder().setDescription("🗑️ Whitelist vidée.").setColor(RED)]
            });
            sendLog("🗑️ Whitelist vidée", [
                { name: "👮 Par", value: interaction.user.tag }
            ], RED);
        }

        else if (cmd === 'wl-purge-expired') {
            let { content, sha } = await getFile();
            const before  = parseUsers(content).length;
            const cleaned = cleanExpired(content);
            const after   = parseUsers(cleaned).length;
            const removed = before - after;

            await updateFile(cleaned, sha);
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("🧹 Purge des expirés")
                    .addFields(
                        { name: "🗑️ Supprimés", value: `${removed}`, inline: true },
                        { name: "✅ Restants",   value: `${after}`,   inline: true }
                    )
                    .setColor(removed > 0 ? ORANGE : GREEN)]
            });

            if (removed > 0) {
                sendLog("🧹 Purge expirés", [
                    { name: "🗑️ Supprimés", value: `${removed}`,         inline: true },
                    { name: "👮 Par",       value: interaction.user.tag, inline: true }
                ], ORANGE);
            }
        }

        else if (cmd === 'wl-import') {
            const input = interaction.options.getString('users');
            const time  = interaction.options.getString('time') || 'lifetime';
            const names = input.split(",").map(n => n.trim()).filter(n => n.length > 0);

            let { content, sha } = await getFile();
            content = cleanExpired(content);
            const existing = parseUsers(content).map(l => getUserName(l).toLowerCase());

            const added   = [];
            const skipped = [];

            for (const name of names) {
                if (existing.includes(name.toLowerCase())) {
                    skipped.push(name);
                } else {
                    content = content.trimEnd() + "\n" + buildEntry(name, time);
                    added.push(name);
                }
            }

            if (added.length > 0) await updateFile(content, sha);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("📥 Import Whitelist")
                    .addFields(
                        { name: "✅ Ajoutés",  value: added.length   > 0 ? added.join(", ")   : "aucun", inline: false },
                        { name: "⚠️ Ignorés", value: skipped.length > 0 ? skipped.join(", ") : "aucun", inline: false },
                        { name: "⏱️ Durée",   value: time,                                               inline: true }
                    )
                    .setColor(GREEN)]
            });

            if (added.length > 0) {
                sendLog("📥 Import WL", [
                    { name: "✅ Ajoutés", value: `${added.length}`,      inline: true },
                    { name: "⏱️ Durée",  value: time,                    inline: true },
                    { name: "👮 Par",    value: interaction.user.tag,    inline: true }
                ], GREEN);
            }
        }

        else if (cmd === 'bl-add') {
            const user   = interaction.options.getString('user');
            const blFile = await getFile("blacklist.txt").catch(() => null);
            let content  = blFile ? blFile.content : "";
            let sha      = blFile ? blFile.sha : null;

            if (parseUsers(content).some(l => l.toLowerCase() === user.toLowerCase())) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription(`⚠️ **${user}** est déjà blacklisté.`)
                        .setColor(YELLOW)]
                });
            }

            content = (content.trimEnd() + "\n" + user).trim();

            if (!sha) {
                await createFile(content, "blacklist.txt");
            } else {
                await updateFile(content, sha, "blacklist.txt");
            }

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("🚫 User blacklisté")
                    .setDescription(`**${user}** ajouté au blacklist.`)
                    .setColor(RED)]
            });

            sendLog("🚫 Blacklist ajoutée", [
                { name: "👤 User", value: user,                 inline: true },
                { name: "👮 Par",  value: interaction.user.tag, inline: true }
            ], RED);
        }

        else if (cmd === 'bl-remove') {
            const user = interaction.options.getString('user');
            let { content, sha } = await getFile("blacklist.txt");
            const before = content;
            content = parseUsers(content).filter(l => l.toLowerCase() !== user.toLowerCase()).join("\n");

            if (content === before.trim()) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription(`❌ **${user}** introuvable dans le blacklist.`)
                        .setColor(RED)]
                });
            }

            await updateFile(content, sha, "blacklist.txt");
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setDescription(`✅ **${user}** retiré du blacklist.`)
                    .setColor(GREEN)]
            });

            sendLog("✅ Blacklist retirée", [
                { name: "👤 User", value: user,                 inline: true },
                { name: "👮 Par",  value: interaction.user.tag, inline: true }
            ], GREEN);
        }

        else if (cmd === 'bl-list') {
            const { content } = await getFile("blacklist.txt");
            const lines = parseUsers(content);

            if (!lines.length) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder().setDescription("🚫 Blacklist vide.").setColor(YELLOW)]
                });
            }

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle(`🚫 Blacklist — ${lines.length} users`)
                    .setDescription(lines.map(l => `• **${l}**`).join("\n"))
                    .setColor(RED)]
            });
        }

        else if (cmd === 'bl-check') {
            const user = interaction.options.getString('user');
            const { content } = await getFile("blacklist.txt").catch(() => ({ content: "" }));
            const found = parseUsers(content).some(l => l.toLowerCase() === user.toLowerCase());

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("🔍 Blacklist Check")
                    .addFields({ name: "👤 User", value: user, inline: true })
                    .setDescription(found ? "🚫 Ce user est **blacklisté**." : "✅ Ce user n'est **pas** dans le blacklist.")
                    .setColor(found ? RED : GREEN)]
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

        else if (cmd === 'wl-renew-expired') {
            const since = interaction.options.getString('since');
            const time  = interaction.options.getString('time');

            const sinceMs = parseDuration(since);
            if (!sinceMs) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription(`❌ Format \`since\` invalide : \`${since}\`. Exemples : \`1d\`, \`1w\`, \`1mo\`, \`3mo\``)
                        .setColor(RED)]
                });
            }

            if (time !== 'lifetime' && !parseDuration(time)) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription(`❌ Format \`time\` invalide : \`${time}\`. Exemples : \`1w\`, \`1mo\`, \`lifetime\``)
                        .setColor(RED)]
                });
            }

            let { content, sha } = await getFile();
            const now   = Math.floor(Date.now() / 1000);
            const lines = parseUsers(content);

            const toRenew = lines.filter(l => {
                const exp = getExpiry(l);
                if (!exp) return false;
                if (exp >= now) return false;
                const expiredAgoMs = (now - exp) * 1000;
                return expiredAgoMs <= sinceMs;
            });

            if (toRenew.length === 0) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription(`✅ Aucun user expiré dans les derniers **${since}**.`)
                        .setColor(YELLOW)]
                });
            }

            const renewed = [];
            const updatedLines = lines.map(l => {
                if (!toRenew.includes(l)) return l;
                const name   = getUserName(l);
                const newEntry = buildEntry(name, time);
                renewed.push(name);
                return newEntry;
            });

            await updateFile(updatedLines.join("\n"), sha);

            const preview = renewed.slice(0, 20).map(n => `• **${n}**`).join("\n")
                + (renewed.length > 20 ? `\n_...et ${renewed.length - 20} autres_` : "");

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("🔄 Renouvellement des expirés")
                    .addFields(
                        { name: "🕒 Expirés depuis",  value: since,              inline: true },
                        { name: "⏱️ Nouvelle durée", value: time,               inline: true },
                        { name: "👥 Renouvelés",      value: `${renewed.length}`, inline: true },
                        { name: "📋 Liste",           value: preview,             inline: false }
                    )
                    .setColor(GREEN)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                    .setTimestamp()
                ]
            });

            sendLog("🔄 Renouvellement expirés", [
                { name: "🕒 Depuis",         value: since,               inline: true },
                { name: "⏱️ Durée",         value: time,                inline: true },
                { name: "👥 Renouvelés",     value: `${renewed.length}`, inline: true },
                { name: "👮 Par",            value: interaction.user.tag, inline: true }
            ], GREEN);
        }

        else if (cmd === 'wl-recover') {
            const time  = interaction.options.getString('time');
            const since = interaction.options.getString('since') || null;

            if (time !== 'lifetime' && !parseDuration(time)) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription(`❌ Durée invalide : \`${time}\`. Exemples : \`1w\`, \`1mo\`, \`lifetime\``)
                        .setColor(RED)]
                });
            }

            const sinceMs = since ? parseDuration(since) : null;
            if (since && !sinceMs) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription(`❌ Format \`since\` invalide : \`${since}\`. Exemples : \`1d\`, \`1w\`, \`1mo\``)
                        .setColor(RED)]
                });
            }

            let { content, sha } = await getFile();
            const now   = Math.floor(Date.now() / 1000);
            const lines = parseUsers(content);

            const targets = lines.filter(l => {
                const exp = getExpiry(l);
                if (!exp) return true;
                if (exp >= now) return true;
                if (sinceMs) return (now - exp) * 1000 <= sinceMs;
                return false;
            });

            if (targets.length === 0) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription(`✅ Aucun user trouvé avec ce filtre.`)
                        .setColor(YELLOW)]
                });
            }

            const renewed = [];
            const updatedLines = lines.map(l => {
                if (!targets.includes(l)) return l;
                const name = getUserName(l);
                if (time === 'lifetime') {
                    renewed.push(name);
                    return `${name},`;
                }
                const addMs  = parseDuration(time);
                const expiry = getExpiry(l);
                const base   = expiry && expiry > now ? expiry * 1000 : Date.now();
                const newExp = Math.floor((base + addMs) / 1000);
                renewed.push(name);
                return `${name},${newExp}`;
            });

            await updateFile(updatedLines.join("\n"), sha);

            const preview = renewed.slice(0, 20).map(n => `• **${n}**`).join("\n")
                + (renewed.length > 20 ? `\n_...et ${renewed.length - 20} autres_` : "");

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("♻️ Recover — Temps ajouté")
                    .addFields(
                        { name: "⏱️ Ajouté",   value: time,                                                    inline: true },
                        { name: "🕒 Filtre",    value: since ? `actifs + expirés < ${since}` : "actifs seuls", inline: true },
                        { name: "👥 Users",     value: `${renewed.length}`,                                    inline: true },
                        { name: "📋 Liste",     value: preview,                                                 inline: false }
                    )
                    .setColor(GREEN)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                    .setTimestamp()
                ]
            });

            sendLog("♻️ Recover WL", [
                { name: "⏱️ Ajouté",  value: time,                 inline: true },
                { name: "🕒 Filtre",  value: since ?? "actifs",    inline: true },
                { name: "👥 Users",   value: `${renewed.length}`,  inline: true },
                { name: "👮 Par",     value: interaction.user.tag, inline: true }
            ], GREEN);
        }

        else if (cmd === 'wl-transfer') {
            const oldName = interaction.options.getString('old');
            const newName = interaction.options.getString('new');
            let { content, sha } = await getFile();
            const lines = parseUsers(content);
            const idx = lines.findIndex(l => getUserName(l).toLowerCase() === oldName.toLowerCase());

            if (idx === -1) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder().setDescription(`❌ **${oldName}** introuvable dans la whitelist.`).setColor(RED)]
                });
            }

            if (lines.some(l => getUserName(l).toLowerCase() === newName.toLowerCase())) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder().setDescription(`⚠️ **${newName}** existe déjà dans la whitelist.`).setColor(YELLOW)]
                });
            }

            const exp = getExpiry(lines[idx]);
            lines[idx] = exp ? `${newName},${exp}` : `${newName},`;
            await updateFile(lines.join("\n"), sha);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("🔀 Transfert effectué")
                    .addFields(
                        { name: "👤 Ancien",  value: oldName, inline: true },
                        { name: "👤 Nouveau", value: newName, inline: true },
                        { name: "⏱️ Expiration conservée", value: formatExpiry(lines[idx]), inline: true }
                    )
                    .setColor(BLUE)]
            });

            sendLog("🔀 Transfert WL", [
                { name: "👤 Ancien",  value: oldName,               inline: true },
                { name: "👤 Nouveau", value: newName,               inline: true },
                { name: "👮 Par",     value: interaction.user.tag,  inline: true }
            ], BLUE);
        }

        else if (cmd === 'wl-batch-remove') {
            const input = interaction.options.getString('users');
            const names = input.split(",").map(n => n.trim()).filter(n => n.length > 0);

            let { content, sha } = await getFile();
            const lines = parseUsers(content);
            const removed  = [];
            const notFound = [];

            for (const name of names) {
                const idx = lines.findIndex(l => getUserName(l).toLowerCase() === name.toLowerCase());
                if (idx !== -1) {
                    lines.splice(idx, 1);
                    removed.push(name);
                } else {
                    notFound.push(name);
                }
            }

            if (removed.length > 0) await updateFile(lines.join("\n"), sha);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("🗑️ Suppression groupée")
                    .addFields(
                        { name: "✅ Supprimés",    value: removed.length  > 0 ? removed.join(", ")  : "aucun", inline: false },
                        { name: "❌ Introuvables", value: notFound.length > 0 ? notFound.join(", ") : "aucun", inline: false }
                    )
                    .setColor(removed.length > 0 ? ORANGE : YELLOW)]
            });

            if (removed.length > 0) {
                sendLog("🗑️ Suppression groupée WL", [
                    { name: "✅ Supprimés", value: `${removed.length}`,   inline: true },
                    { name: "👮 Par",      value: interaction.user.tag,   inline: true }
                ], ORANGE);
            }
        }

        else if (cmd === 'wl-export') {
            const { content } = await getFile();
            const lines = parseUsers(content);

            const exportContent = lines.length > 0
                ? lines.map(line => {
                    const name   = getUserName(line);
                    const exp    = getExpiry(line);
                    const expStr = exp ? new Date(exp * 1000).toISOString().split('T')[0] : 'lifetime';
                    return `${name} | ${expStr}`;
                }).join("\n")
                : "(whitelist vide)";

            const attachment = new AttachmentBuilder(
                Buffer.from(exportContent, 'utf-8'),
                { name: 'whitelist_export.txt' }
            );

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("📤 Export Whitelist")
                    .addFields({ name: "👥 Total", value: `${lines.length} users`, inline: true })
                    .setColor(BLUE)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                    .setTimestamp()
                ],
                files: [attachment]
            });
        }

        else if (cmd === 'bl-clear') {
            const blFile = await getFile("blacklist.txt").catch(() => null);
            if (!blFile) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder().setDescription("🚫 Blacklist déjà vide.").setColor(YELLOW)]
                });
            }
            await updateFile("", blFile.sha, "blacklist.txt");
            await interaction.editReply({
                embeds: [new EmbedBuilder().setDescription("🗑️ Blacklist vidée.").setColor(RED)]
            });
            sendLog("🗑️ Blacklist vidée", [
                { name: "👮 Par", value: interaction.user.tag }
            ], RED);
        }

        else if (cmd === 'bl-import') {
            const input = interaction.options.getString('users');
            const names = input.split(",").map(n => n.trim()).filter(n => n.length > 0);

            const blFile = await getFile("blacklist.txt").catch(() => null);
            let content  = blFile ? blFile.content : "";
            let sha      = blFile ? blFile.sha : null;

            const existing = parseUsers(content).map(l => l.toLowerCase());
            const added   = [];
            const skipped = [];

            for (const name of names) {
                if (existing.includes(name.toLowerCase())) {
                    skipped.push(name);
                } else {
                    content = (content.trimEnd() + "\n" + name).trim();
                    added.push(name);
                }
            }

            if (added.length > 0) {
                if (!sha) await createFile(content, "blacklist.txt");
                else await updateFile(content, sha, "blacklist.txt");
            }

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("📥 Import Blacklist")
                    .addFields(
                        { name: "🚫 Blacklistés", value: added.length   > 0 ? added.join(", ")   : "aucun", inline: false },
                        { name: "⚠️ Ignorés",     value: skipped.length > 0 ? skipped.join(", ") : "aucun", inline: false }
                    )
                    .setColor(RED)]
            });

            if (added.length > 0) {
                sendLog("📥 Import BL", [
                    { name: "🚫 Ajoutés", value: `${added.length}`,     inline: true },
                    { name: "👮 Par",     value: interaction.user.tag,  inline: true }
                ], RED);
            }
        }

        else if (cmd === 'status') {
            const { content: wlContent } = await getFile();
            const { content: blContent } = await getFile("blacklist.txt").catch(() => ({ content: "" }));

            const wlAll      = parseUsers(wlContent);
            const wlActifs   = wlAll.filter(l => !isExpired(l)).length;
            const wlExpires  = wlAll.filter(l => isExpired(l)).length;
            const wlLifetime = wlAll.filter(l => !getExpiry(l)).length;
            const blTotal    = parseUsers(blContent).length;

            const now = Math.floor(Date.now() / 1000);
            const expiringSoon = wlAll.filter(l => {
                const exp = getExpiry(l);
                if (!exp) return false;
                const diff = exp - now;
                return diff > 0 && diff <= 7 * 86400;
            }).length;

            const uptime = process.uptime();
            const d   = Math.floor(uptime / 86400);
            const h   = Math.floor((uptime % 86400) / 3600);
            const m   = Math.floor((uptime % 3600) / 60);
            const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("📊 SMVLL HUB — Status Dashboard")
                    .addFields(
                        { name: "🆓 Free4All",      value: free4allSince ? "🟠 ACTIF" : "🟢 Inactif", inline: true },
                        { name: "✅ WL Actifs",     value: `${wlActifs}`,      inline: true },
                        { name: "⛔ WL Expirés",    value: `${wlExpires}`,     inline: true },
                        { name: "♾️ WL Lifetime",   value: `${wlLifetime}`,    inline: true },
                        { name: "⚠️ Expire < 7j",  value: `${expiringSoon}`,  inline: true },
                        { name: "🚫 Blacklist",     value: `${blTotal}`,       inline: true },
                        { name: "📦 WL Total",      value: `${wlAll.length}`,  inline: true },
                        { name: "⏱️ Uptime",        value: `${d}j ${h}h ${m}m`, inline: true },
                        { name: "🧠 Mémoire",       value: `${mem} MB`,          inline: true },
                        { name: "📡 Ping",          value: `${client.ws.ping}ms`, inline: true }
                    )
                    .setColor(BLUE)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                    .setTimestamp()
                ]
            });
        }

        else if (cmd === 'free4all') {
            let { content, sha } = await getFile();
            const isActive = getConfigValue(content, 'free4all') !== null;

            if (!isActive) {
                const timeArg  = interaction.options.getString('time') || null;
                const durationMs = timeArg ? parseDuration(timeArg) : null;
                if (timeArg && !durationMs) {
                    return interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setDescription(`❌ Durée invalide : \`${timeArg}\`. Exemples : \`1h\`, \`1d\`, \`1w\``)
                            .setColor(RED)]
                    });
                }

                const startTs = Math.floor(Date.now() / 1000);
                const endTs   = durationMs ? startTs + Math.floor(durationMs / 1000) : null;
                content = setConfigValue(content, 'whitelist', 'false');
                content = setConfigValue(content, 'free4all', endTs ? `${startTs}:${endTs}` : `${startTs}:0`);
                await updateFile(content, sha);
                free4allSince = startTs * 1000;

                if (durationMs) {
                    setTimeout(() => stopFree4All("auto"), durationMs);
                }

                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setTitle("🆓 Free4All ACTIVÉ")
                        .addFields(
                            { name: "⏱️ Durée",  value: timeArg ? timeArg : "Manuel",              inline: true },
                            { name: "🔚 Fin",    value: endTs ? `<t:${endTs}:R>` : "Manuel seulement", inline: true }
                        )
                        .setDescription("La whitelist est **désactivée**. Les expirations sont **gelées**.")
                        .setColor(ORANGE)
                        .setFooter({ text: "SMVLL HUB • HS CORP" })
                        .setTimestamp()
                    ]
                });
                sendLog("🆓 Free4All activé", [
                    { name: "⏱️ Durée", value: timeArg ?? "Manuel",   inline: true },
                    { name: "👮 Par",   value: interaction.user.tag,  inline: true }
                ], ORANGE);

            } else {
                await stopFree4All(interaction.user.tag);
                const { content: newContent } = await getFile();
                const now = Math.floor(Date.now() / 1000);
                const val = getConfigValue(newContent, 'free4all');
                const startTs = val ? parseInt(val.split(':')[0]) : now;
                const duration = now - startTs;
                const dH = Math.floor(duration / 3600);
                const dM = Math.floor((duration % 3600) / 60);
                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setTitle("✅ Free4All DÉSACTIVÉ")
                        .addFields(
                            { name: "⏱️ Durée",       value: `${dH}h ${dM}m`,             inline: true },
                            { name: "📅 Expirations", value: `+${dH}h ${dM}m pour tous`,   inline: true }
                        )
                        .setColor(GREEN)
                        .setFooter({ text: "SMVLL HUB • HS CORP" })
                        .setTimestamp()
                    ]
                });
            }
        }

        else if (cmd === 'unlock') {
            const guild        = interaction.guild;
            const everyoneRole = guild.roles.everyone;
            let unlocked = 0;
            for (const [, ch] of guild.channels.cache) {
                if (!ch.isTextBased()) continue;
                try {
                    await ch.permissionOverwrites.edit(everyoneRole, { SendMessages: null });
                    unlocked++;
                } catch {}
            }
            raidLocked = false;
            recentJoins.length = 0;
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("🔓 Lockdown levé")
                    .addFields({ name: "📌 Salons déverrouillés", value: `${unlocked}`, inline: true })
                    .setColor(GREEN)]
            });
            sendLog("🔓 Lockdown levé", [
                { name: "👮 Par", value: interaction.user.tag }
            ], GREEN);
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

            const scriptUrl2 = process.env.SCRIPT_LOADSTRING_URL || 'CONFIGURE_SCRIPT_LOADSTRING_URL';
            const script2 = `SCRIPT_KEY = "${key}"\nloadstring(game:HttpGet("${scriptUrl2}"))()`;
            try {
                await interaction.user.send({ content: `\`\`\`lua\n${script2}\n\`\`\`` });

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
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d0d0d;color:#fff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}
.box{background:#161616;border:1px solid #00ff64;border-radius:12px;padding:40px;text-align:center;width:340px}
h1{color:#00ff64;margin-bottom:24px;font-size:1.4rem}input{width:100%;padding:10px 14px;background:#0d0d0d;border:1px solid #333;border-radius:8px;color:#fff;font-size:1rem;margin-bottom:16px}
button{width:100%;padding:10px;background:#00ff64;color:#000;font-weight:700;border:none;border-radius:8px;cursor:pointer;font-size:1rem}
button:hover{background:#00cc50}</style></head><body>
<div class="box"><h1>🟢 SMVLL HUB</h1>
<input type="password" id="t" placeholder="Dashboard token" onkeydown="if(event.key==='Enter')login()">
<button onclick="login()">Login</button></div>
<script>function login(){const t=document.getElementById('t').value;if(t)window.location.href='/dashboard?token='+encodeURIComponent(t);}</script>
</html>`);
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
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

loadKeys();
setInterval(loadKeys, 30000);
</script></body></html>`);
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
