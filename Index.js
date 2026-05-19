const {
    Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder,
    REST, Routes, SlashCommandBuilder,
    ButtonBuilder, ButtonStyle, ActionRowBuilder
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
        .setDescription('Envoyer le panel buyer dans ce salon'),

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
                    return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("⛔ Tu n'as pas le rôle **Buyer** requis.").setColor(RED)] });
                }
            }
            const { data: keys } = await getKeysData();
            const entry = findKeyByDiscordId(keys, interaction.user.id);
            if (!entry) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("❌ Aucune clé associée à ton compte. Contacte le support.").setColor(RED)] });
            const [key, keyData] = entry;
            const now = Math.floor(Date.now() / 1000);
            if (keyData.expiry && keyData.expiry < now) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("⛔ Ta clé a **expiré**. Contacte le support.").setColor(RED)] });
            const scriptUrl  = process.env.SCRIPT_LOADSTRING_URL || '';
            const loadstring = `SCRIPT_KEY = "${key}"\nloadstring(game:HttpGet("${scriptUrl || 'CONFIGURE_SCRIPT_LOADSTRING_URL'}"))()`;
            try {
                await interaction.user.send({
                    embeds: [new EmbedBuilder()
                        .setTitle("🚀 SMVLL HUB — Ton Script")
                        .setDescription(`**Mets ce code dans ton exécuteur Roblox :**\n\`\`\`lua\n${loadstring}\n\`\`\``)
                        .addFields(
                            { name: "🔑 Ta clé",  value: `\`${key}\``,                                                inline: false },
                            { name: "⏱️ Expire", value: keyData.expiry ? `<t:${keyData.expiry}:R>` : "♾️ Lifetime", inline: true },
                            { name: "🖥️ HWID",   value: keyData.hwid ? "🔒 Verrouillé" : "🔓 Non verrouillé",      inline: true },
                            { name: "💬 Support", value: "Pour tout problème, crée un ticket dans le serveur.",      inline: false }
                        )
                        .setColor(GREEN).setFooter({ text: "SMVLL HUB • HS CORP" }).setTimestamp()
                    ]
                });
                await interaction.editReply({ embeds: [new EmbedBuilder().setDescription("✅ Ton script et ta clé ont été envoyés en DM !").setColor(GREEN)] });
                sendLog("📤 Script envoyé (panel)", [{ name: "👤 Discord", value: interaction.user.tag, inline: true }], BLUE);
            } catch {
                await interaction.editReply({ embeds: [new EmbedBuilder().setDescription("❌ Impossible d'envoyer le DM. Vérifie tes paramètres Discord.").setColor(RED)] });
            }

        } else if (action === 'reset-hwid') {
            const { data: keys, sha } = await getKeysData();
            const entry = findKeyByDiscordId(keys, interaction.user.id);
            if (!entry) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("❌ Aucune clé associée à ton compte.").setColor(RED)] });
            const [key, keyData] = entry;
            if (!keyData.hwid) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("⚠️ Ton HWID n'est pas encore verrouillé.").setColor(YELLOW)] });
            keyData.hwid = null;
            keys[key] = keyData;
            await saveKeysData(keys, sha);
            await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("🔓 HWID réinitialisé").setDescription("Ton HWID a été remis à zéro. Il se verrouillera à la prochaine exécution.").setColor(GREEN).setFooter({ text: "SMVLL HUB • HS CORP" }).setTimestamp()] });
            sendLog("🔓 HWID reset (panel)", [{ name: "👤 Discord", value: interaction.user.tag, inline: true }], ORANGE);

        } else if (action === 'my-stats') {
            const { data: keys } = await getKeysData();
            const entry = findKeyByDiscordId(keys, interaction.user.id);
            if (!entry) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("❌ Aucune clé associée à ton compte.").setColor(RED)] });
            const [key, keyData] = entry;
            const now = Math.floor(Date.now() / 1000);
            const expired = keyData.expiry && keyData.expiry < now;
            const expiryStr = keyData.expiry ? (expired ? "⛔ Expirée" : `<t:${keyData.expiry}:R>`) : "♾️ Lifetime";
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("📊 Mes stats — SMVLL HUB")
                    .addFields(
                        { name: "🔑 Clé",    value: `\`${key.slice(0, 12)}...\``,                            inline: false },
                        { name: "⏱️ Expire", value: expiryStr,                                               inline: true },
                        { name: "📌 Statut", value: expired ? "⛔ Expirée" : "✅ Active",                    inline: true },
                        { name: "🖥️ HWID",  value: keyData.hwid ? "🔒 Verrouillé" : "🔓 Non verrouillé",  inline: true },
                        { name: "📅 Créée",  value: `<t:${keyData.createdAt}:D>`,                            inline: true }
                    )
                    .setColor(expired ? RED : GREEN).setFooter({ text: "SMVLL HUB • HS CORP" }).setTimestamp()
                ]
            });
        }
    } catch (err) {
        console.error("handleBuyerAction error:", err.message);
        interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`❌ Erreur : \`${err.message}\``).setColor(RED)] });
    }
}

client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        const map = { btn_get_script: 'get-script', btn_reset_hwid: 'reset-hwid', btn_my_stats: 'my-stats' };
        if (map[interaction.customId]) return handleBuyerAction(interaction, map[interaction.customId]);
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
                        .setTitle("🎉 Accès accordé — SMVLL HUB")
                        .setDescription(`Tu as reçu une clé d'accès !\nClique sur **Obtenir mon script** dans le panel du serveur ou fais \`/get-script\`.`)
                        .addFields({ name: "⏱️ Expire", value: expiryStr, inline: true })
                        .setColor(GREEN)
                        .setFooter({ text: "SMVLL HUB • HS CORP" })
                        .setTimestamp()
                    ]
                });
            } catch {}

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("✅ Clé créée")
                    .addFields(
                        { name: "👤 Discord", value: target.tag,    inline: true },
                        { name: "⏱️ Expire", value: expiryStr,     inline: true },
                        { name: "🔑 Clé",     value: `\`${key}\``, inline: false }
                    )
                    .setColor(GREEN)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                    .setTimestamp()
                ]
            });

            sendLog("💰 Nouvelle clé créée", [
                { name: "👤 Discord", value: `${target.tag} (${target.id})`, inline: true },
                { name: "⏱️ Expire", value: expiryStr,                       inline: true },
                { name: "👮 Par",     value: interaction.user.tag,            inline: true }
            ], GREEN);
        }

        else if (cmd === 'get-script') {
            if (BUYER_ROLE_ID) {
                const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                if (!member || !member.roles.cache.has(BUYER_ROLE_ID)) {
                    return interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setDescription("⛔ Tu n'as pas le rôle **Buyer** requis.")
                            .setColor(RED)]
                    });
                }
            }

            const { data: keys } = await getKeysData();
            const entry = findKeyByDiscordId(keys, interaction.user.id);

            if (!entry) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("❌ Aucune clé associée à ton compte. Contacte le support.")
                        .setColor(RED)]
                });
            }

            const [key, keyData] = entry;
            const now = Math.floor(Date.now() / 1000);

            if (keyData.expiry && keyData.expiry < now) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("⛔ Ta clé a **expiré**. Contacte le support pour renouveler.")
                        .setColor(RED)]
                });
            }

            const scriptUrl  = process.env.SCRIPT_LOADSTRING_URL || '';
            const loadstring = `SCRIPT_KEY = "${key}"\nloadstring(game:HttpGet("${scriptUrl || 'CONFIGURE_SCRIPT_LOADSTRING_URL'}"))()`;

            try {
                await interaction.user.send({
                    embeds: [new EmbedBuilder()
                        .setTitle("🚀 SMVLL HUB — Ton Script")
                        .setDescription(`**Mets ce code dans ton exécuteur Roblox :**\n\`\`\`lua\n${loadstring}\n\`\`\``)
                        .addFields(
                            { name: "🔑 Ta clé",  value: `\`${key}\``,                                                inline: false },
                            { name: "⏱️ Expire", value: keyData.expiry ? `<t:${keyData.expiry}:R>` : "♾️ Lifetime", inline: true },
                            { name: "🖥️ HWID",   value: keyData.hwid ? "🔒 Verrouillé" : "🔓 Non verrouillé",      inline: true },
                            { name: "💬 Support", value: "Pour tout problème, crée un ticket dans le serveur.",      inline: false }
                        )
                        .setColor(GREEN)
                        .setFooter({ text: "SMVLL HUB • HS CORP" })
                        .setTimestamp()
                    ]
                });

                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("✅ Ton script et ta clé ont été envoyés en DM !")
                        .setColor(GREEN)]
                });

                sendLog("📤 Script envoyé (get-script)", [
                    { name: "👤 Discord", value: interaction.user.tag, inline: true }
                ], BLUE);

            } catch {
                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("❌ Impossible d'envoyer le DM. Vérifie tes paramètres Discord.")
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
                        .setDescription("❌ Aucune clé associée à ton compte.")
                        .setColor(RED)]
                });
            }

            const [key, keyData] = entry;
            if (!keyData.hwid) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("⚠️ Ton HWID n'est pas encore verrouillé.")
                        .setColor(YELLOW)]
                });
            }

            keyData.hwid = null;
            keys[key] = keyData;
            await saveKeysData(keys, sha);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("🔓 HWID réinitialisé")
                    .setDescription("Ton HWID a été remis à zéro. Il se verrouillera automatiquement à la prochaine exécution du script.")
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
                        .setDescription("❌ Aucune clé associée à ton compte.")
                        .setColor(RED)]
                });
            }

            const [key, keyData] = entry;
            const now = Math.floor(Date.now() / 1000);
            const expired = keyData.expiry && keyData.expiry < now;
            const expiryStr = keyData.expiry
                ? (expired ? "⛔ Expirée" : `<t:${keyData.expiry}:R>`)
                : "♾️ Lifetime";

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("📊 Mes stats — SMVLL HUB")
                    .addFields(
                        { name: "🔑 Clé",    value: `\`${key.slice(0, 12)}...\``,                            inline: false },
                        { name: "⏱️ Expire", value: expiryStr,                                               inline: true },
                        { name: "📌 Statut", value: expired ? "⛔ Expirée" : "✅ Active",                   inline: true },
                        { name: "🖥️ HWID",  value: keyData.hwid ? "🔒 Verrouillé" : "🔓 Non verrouillé", inline: true },
                        { name: "📅 Créée",  value: `<t:${keyData.createdAt}:D>`,                           inline: true }
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
                    embeds: [new EmbedBuilder().setDescription("🔑 Aucune clé enregistrée.").setColor(YELLOW)]
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
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_get_script')
                    .setLabel('🔑 Obtenir mon script')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('btn_reset_hwid')
                    .setLabel('🔄 Reset HWID')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('btn_my_stats')
                    .setLabel('📊 Mes stats')
                    .setStyle(ButtonStyle.Secondary),
            );

            await interaction.channel.send({
                embeds: [new EmbedBuilder()
                    .setTitle("🚀 SMVLL HUB — Espace Buyer")
                    .setDescription("Bienvenue ! Utilise les boutons ci-dessous pour accéder à ton espace.")
                    .addFields(
                        { name: "🔑 Obtenir mon script", value: "Reçois ta clé d'accès + le loadstring en DM", inline: false },
                        { name: "🔄 Reset HWID",         value: "Réinitialise ton HWID si tu as changé de PC",  inline: false },
                        { name: "📊 Mes stats",           value: "Vérifie le statut et l'expiration de ta clé", inline: false }
                    )
                    .setColor(BLUE)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
                    .setTimestamp()
                ],
                components: [row]
            });

            await interaction.editReply({
                embeds: [new EmbedBuilder().setDescription("✅ Panel envoyé.").setColor(GREEN)]
            });
        }

    } catch (err) {
        console.error(err);
        interaction.editReply({
            embeds: [new EmbedBuilder()
                .setDescription(`❌ Erreur : \`${err.message}\``)
                .setColor(RED)]
        });
    }
});

// ─── Automod — Anti-pub ────────────────────────────────────────────────

const AD_PATTERNS = [
    /discord\.gg\/[a-zA-Z0-9]+/i,
    /discord\.com\/invite\/[a-zA-Z0-9]+/i,
    /\.gg\/[a-zA-Z0-9]{2,}/i,
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

    const isAd             = AD_PATTERNS.some(p => p.test(msg.content));
    const hasChannelMention = /<#\d+>/.test(msg.content);
    const hasHeading        = /^#{1,3} /m.test(msg.content);

    if (!isAd && !hasChannelMention && !hasHeading) return;

    try {
        const content = msg.content.slice(0, 300);
        await msg.delete();
        const reason = hasHeading        ? "Gros texte interdit"
                     : hasChannelMention ? "Mention de salon"
                     : "Publicité";
        sendLog("🗑️ Message supprimé", [
            { name: "👤 User",    value: `${msg.author.tag} (${msg.author.id})`, inline: true },
            { name: "📌 Channel", value: `<#${msg.channel.id}>`,                 inline: true },
            { name: "⚠️ Raison", value: reason,                                  inline: true },
            { name: "📝 Contenu", value: `\`\`\`${content}\`\`\``,              inline: false }
        ], ORANGE);
        const warn = await msg.channel.send({
            embeds: [new EmbedBuilder()
                .setDescription(`⛔ <@${msg.author.id}> — ${reason}.`)
                .setColor(RED)]
        });
        setTimeout(() => warn.delete().catch(() => {}), 5000);
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

// ─── Keep-alive (auto self-ping, no UptimeRobot needed) ──────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/webhook/panda') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const robloxUser = data.robloxUsername || data.username || data.user;
                if (robloxUser) {
                    sendLog("🎮 Script exécuté", [
                        { name: "🎮 Roblox", value: robloxUser, inline: true }
                    ], BLUE);
                }
            } catch {}
            res.writeHead(200);
            res.end('ok');
        });
        return;
    }
    res.writeHead(200);
    res.end("SMVLL HUB — online");
}).listen(PORT, () => {
    console.log(`✅ Keep-alive server sur le port ${PORT}`);
    const selfUrl = process.env.RENDER_EXTERNAL_URL;
    if (selfUrl) {
        setInterval(() => {
            axios.get(selfUrl).catch(() => {});
        }, 4 * 60 * 1000);
        console.log(`✅ Auto self-ping actif → ${selfUrl}`);
    }
});
