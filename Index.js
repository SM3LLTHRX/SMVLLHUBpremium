const {
Client, GatewayIntentBits, EmbedBuilder,
REST, Routes, SlashCommandBuilder, PermissionFlagsBits
} = require(‘discord.js’);
const axios = require(‘axios’);
const ms = require(‘ms’);

const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMembers
]
});

const TOKEN        = process.env.TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO         = “SM3LLTHRX/SMVLLHUBpremium”;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const CLIENT_ID    = process.env.CLIENT_ID;
const OWNER_ID     = process.env.OWNER_ID;
const PREMIUM_ROLE_ID = “1486435751297159378”;

const GREEN  = 0x00FF64;
const RED    = 0xFF4444;
const YELLOW = 0xFFCC00;
const BLUE   = 0x4488FF;
const ORANGE = 0xFF8800;
const PURPLE = 0xAA44FF;

// ─── GitHub helpers ───────────────────────────────────────────────────────────

async function getFile(filename = “whitelist.txt”) {
const res = await axios.get(
`https://api.github.com/repos/${REPO}/contents/${filename}`,
{ headers: { Authorization: `token ${GITHUB_TOKEN}` } }
);
return {
content: Buffer.from(res.data.content, ‘base64’).toString(),
sha: res.data.sha
};
}

async function updateFile(content, sha, filename = “whitelist.txt”) {
await axios.put(
`https://api.github.com/repos/${REPO}/contents/${filename}`,
{
message: `update ${filename}`,
content: Buffer.from(content).toString(‘base64’),
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
content: Buffer.from(content).toString(‘base64’)
},
{ headers: { Authorization: `token ${GITHUB_TOKEN}` } }
);
}

// ─── Whitelist helpers ────────────────────────────────────────────────────────

function parseUsers(content) {
return content.split(”\n”).map(l => l.trim()).filter(l => l.length > 0);
}

function getUserName(line) {
return line.split(”,”)[0].trim();
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
return parseUsers(content).filter(l => !isExpired(l)).join(”\n”);
}

function formatExpiry(line) {
const exp = getExpiry(line);
if (!exp) return “♾️ Lifetime”;
const now = Math.floor(Date.now() / 1000);
const diff = exp - now;
if (diff <= 0) return “⛔ Expiré”;
const days  = Math.floor(diff / 86400);
const hours = Math.floor((diff % 86400) / 3600);
if (days > 0) return `📅 ${days}j ${hours}h`;
return `⏰ ${hours}h`;
}

function buildEntry(user, time) {
if (time === “lifetime”) return `${user},`;
const expire = Math.floor((Date.now() + ms(time)) / 1000);
return `${user},${expire}`;
}

// ─── Logging ──────────────────────────────────────────────────────────────────

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
.setFooter({ text: “SMVLL HUB • HS CORP” })
]
});
}

function isOwner(interaction) {
return interaction.user.id === OWNER_ID;
}

// ─── Auto expiry check ────────────────────────────────────────────────────────

async function checkExpiringSoon() {
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
}).join(”\n”);
channel.send({
embeds: [
new EmbedBuilder()
.setTitle(“⚠️ Whitelist — Expirations proches”)
.setDescription(list)
.setColor(ORANGE)
.setTimestamp()
.setFooter({ text: “SMVLL HUB • HS CORP” })
]
});
} catch (e) {
console.error(“checkExpiringSoon error:”, e.message);
}
}

// ─── Commands definition ──────────────────────────────────────────────────────

const commands = [
// ── Info / Utilitaires ──
new SlashCommandBuilder()
.setName(‘help’)
.setDescription(‘Afficher le guide des formats de temps et commandes’),

```
new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Latence du bot'),

new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Infos sur le bot (uptime, mémoire, etc.)'),

// ── Whitelist ──
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
    .setDescription('Importer plusieurs users d\'un coup (lifetime)')
    .addStringOption(o => o.setName('users').setDescription('Noms séparés par des virgules').setRequired(true))
    .addStringOption(o => o.setName('time').setDescription('Durée pour tous. Default: lifetime').setRequired(false)),

// ── Blacklist ──
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

// ── DM / Announce ──
new SlashCommandBuilder()
    .setName('dmall')
    .setDescription('DM le script à tous les membres avec le rôle premium'),

new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Envoyer une annonce dans un channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel cible').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Contenu de l\'annonce').setRequired(true))
    .addStringOption(o => o.setName('titre').setDescription('Titre de l\'embed').setRequired(false)),
```

].map(c => c.toJSON());

// ─── Ready ────────────────────────────────────────────────────────────────────

client.once(‘ready’, async () => {
console.log(`✅ Bot connecté : ${client.user.tag}`);
const rest = new REST({ version: ‘10’ }).setToken(TOKEN);
await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
console.log(“✅ Commandes enregistrées”);
setInterval(checkExpiringSoon, 60 * 60 * 1000);
checkExpiringSoon();
});

// ─── Interactions ─────────────────────────────────────────────────────────────

client.on(‘interactionCreate’, async interaction => {
if (!interaction.isChatInputCommand()) return;

```
if (!isOwner(interaction)) {
    return interaction.reply({
        embeds: [new EmbedBuilder().setDescription("⛔ Accès refusé.").setColor(RED)],
        ephemeral: true
    });
}

await interaction.deferReply({ ephemeral: true });

try {
    const cmd = interaction.commandName;

    // ── /help ──────────────────────────────────────────────────────────────
    if (cmd === 'help') {
        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setTitle("📖 Guide d'utilisation — SMVLL HUB Bot")
                .addFields(
                    { name: "⏱️ Secondes",  value: "`1s`, `30s`",               inline: true },
                    { name: "⏱️ Minutes",   value: "`1m`, `15m`",               inline: true },
                    { name: "⏱️ Heures",    value: "`1h`, `12h`",               inline: true },
                    { name: "📅 Jours",     value: "`1d`, `3d`",                inline: true },
                    { name: "📅 Semaines",  value: "`1w`, `2w`",                inline: true },
                    { name: "📅 Années",    value: "`1y`",                       inline: true },
                    { name: "♾️ À vie",     value: "`lifetime`",                inline: false },
                    { name: "━━━━━━━━━━━━━━━━━━", value: "**Commandes disponibles**", inline: false },
                    { name: "📋 Whitelist", value: "`/wl-add` `/wl-remove` `/wl-edit` `/wl-renew` `/wl-check` `/wl-list` `/wl-stats` `/wl-expire-soon` `/wl-clear` `/wl-purge-expired` `/wl-import` `/wl-search`", inline: false },
                    { name: "🚫 Blacklist", value: "`/bl-add` `/bl-remove` `/bl-list` `/bl-check`", inline: false },
                    { name: "📨 Messages",  value: "`/dmall` `/announce`",       inline: false },
                    { name: "🔧 Utilitaires", value: "`/ping` `/botinfo`",       inline: false }
                )
                .setColor(BLUE)
                .setFooter({ text: "SMVLL HUB • HS CORP" })
            ]
        });
    }

    // ── /ping ──────────────────────────────────────────────────────────────
    else if (cmd === 'ping') {
        const ws = client.ws.ping;
        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setTitle("🏓 Pong!")
                .addFields(
                    { name: "📡 WebSocket", value: `${ws}ms`, inline: true }
                )
                .setColor(ws < 100 ? GREEN : ws < 200 ? YELLOW : RED)
                .setFooter({ text: "SMVLL HUB • HS CORP" })
            ]
        });
    }

    // ── /botinfo ───────────────────────────────────────────────────────────
    else if (cmd === 'botinfo') {
        const uptime   = process.uptime();
        const d = Math.floor(uptime / 86400);
        const h = Math.floor((uptime % 86400) / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        const guilds = client.guilds.cache.size;

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setTitle("🤖 Bot Info — SMVLL HUB")
                .addFields(
                    { name: "⏱️ Uptime",    value: `${d}j ${h}h ${m}m`,     inline: true },
                    { name: "🧠 Mémoire",   value: `${mem} MB`,              inline: true },
                    { name: "📡 Ping",      value: `${client.ws.ping}ms`,    inline: true },
                    { name: "🏠 Serveurs",  value: `${guilds}`,              inline: true },
                    { name: "📦 Node.js",   value: process.version,          inline: true },
                    { name: "🔖 discord.js",value: require('discord.js').version, inline: true }
                )
                .setColor(PURPLE)
                .setFooter({ text: "SMVLL HUB • HS CORP" })
                .setTimestamp()
            ]
        });
    }

    // ── /wl-add ────────────────────────────────────────────────────────────
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
                    { name: "👤 User",    value: user, inline: true },
                    { name: "⏱️ Durée",  value: time, inline: true }
                )
                .setColor(GREEN)]
        });

        sendLog("✅ Whitelist ajoutée", [
            { name: "👤 User",    value: user,                        inline: true },
            { name: "⏱️ Durée",  value: time,                        inline: true },
            { name: "👮 Par",    value: interaction.user.tag,         inline: true }
        ], GREEN);
    }

    // ── /wl-remove ─────────────────────────────────────────────────────────
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
            { name: "👤 User", value: user,                    inline: true },
            { name: "👮 Par",  value: interaction.user.tag,    inline: true }
        ], RED);
    }

    // ── /wl-edit ───────────────────────────────────────────────────────────
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
                    { name: "👤 User",              value: user, inline: true },
                    { name: "⏱️ Nouvelle durée",   value: time, inline: true }
                )
                .setColor(BLUE)]
        });

        sendLog("✏️ Whitelist modifiée", [
            { name: "👤 User",            value: user,                    inline: true },
            { name: "⏱️ Nouvelle durée", value: time,                    inline: true },
            { name: "👮 Par",             value: interaction.user.tag,    inline: true }
        ], BLUE);
    }

    // ── /wl-renew ──────────────────────────────────────────────────────────
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
        const newExp = Math.floor((base + ms(time)) / 1000);
        lines[idx] = `${user},${newExp}`;
        await updateFile(lines.join("\n"), sha);

        const days = Math.ceil((newExp - Math.floor(Date.now() / 1000)) / 86400);
        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setTitle("🔄 Whitelist renouvelée")
                .addFields(
                    { name: "👤 User",          value: user,       inline: true },
                    { name: "📅 Expire dans",   value: `${days}j`, inline: true }
                )
                .setColor(GREEN)]
        });

        sendLog("🔄 Whitelist renouvelée", [
            { name: "👤 User",        value: user,                    inline: true },
            { name: "📅 Expire dans", value: `${days}j`,              inline: true },
            { name: "👮 Par",         value: interaction.user.tag,    inline: true }
        ], GREEN);
    }

    // ── /wl-check ──────────────────────────────────────────────────────────
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
                    { name: "👤 User",          value: user,             inline: true },
                    { name: "⏱️ Expiration",    value: formatExpiry(line), inline: true },
                    { name: "📌 Statut",         value: isExpired(line) ? "⛔ Expiré" : "✅ Actif", inline: true }
                )
                .setColor(isExpired(line) ? RED : BLUE)]
        });
    }

    // ── /wl-search ─────────────────────────────────────────────────────────
    else if (cmd === 'wl-search') {
        const query = interaction.options.getString('query').toLowerCase();
        const { content } = await getFile();
        const results = parseUsers(content).filter(l =>
            getUserName(l).toLowerCase().includes(query)
        );

        if (!results.length) {
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setDescription(`❌ Aucun résultat pour \`${query}\`.`)
                    .setColor(RED)]
            });
        }

        const list = results.map(line =>
            `• **${getUserName(line)}** — ${formatExpiry(line)}`
        ).join("\n");

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setTitle(`🔎 Résultats pour "${query}" — ${results.length} trouvé(s)`)
                .setDescription(list)
                .setColor(BLUE)]
        });
    }

    // ── /wl-list ───────────────────────────────────────────────────────────
    else if (cmd === 'wl-list') {
        let { content } = await getFile();
        content = cleanExpired(content);
        const lines = parseUsers(content);

        if (!lines.length) {
            return interaction.editReply({
                embeds: [new EmbedBuilder().setDescription("📋 Whitelist vide.").setColor(YELLOW)]
            });
        }

        // Split into chunks of 25 to avoid embed description overflow
        const chunkSize = 25;
        const chunks = [];
        for (let i = 0; i < lines.length; i += chunkSize) {
            chunks.push(lines.slice(i, i + chunkSize));
        }

        const embeds = chunks.map((chunk, idx) =>
            new EmbedBuilder()
                .setTitle(idx === 0 ? `📋 Whitelist — ${lines.length} users` : `📋 Suite (${idx + 1}/${chunks.length})`)
                .setDescription(chunk.map(line =>
                    `• **${getUserName(line)}** — ${formatExpiry(line)}`
                ).join("\n"))
                .setColor(GREEN)
                .setFooter({ text: "SMVLL HUB • HS CORP" })
        );

        await interaction.editReply({ embeds: embeds.slice(0, 10) });
    }

    // ── /wl-stats ──────────────────────────────────────────────────────────
    else if (cmd === 'wl-stats') {
        const { content }   = await getFile();
        const all           = parseUsers(content);
        const actifs        = all.filter(l => !isExpired(l)).length;
        const expires       = all.filter(l => isExpired(l)).length;
        const lifetime      = all.filter(l => !getExpiry(l)).length;
        const { content: blContent } = await getFile("blacklist.txt").catch(() => ({ content: "" }));
        const blacklisted   = parseUsers(blContent).length;

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setTitle("📊 SMVLL HUB — Stats")
                .addFields(
                    { name: "✅ Actifs",      value: `${actifs}`,       inline: true },
                    { name: "⛔ Expirés",     value: `${expires}`,      inline: true },
                    { name: "♾️ Lifetime",    value: `${lifetime}`,     inline: true },
                    { name: "🚫 Blacklist",   value: `${blacklisted}`,  inline: true },
                    { name: "📦 Total WL",    value: `${all.length}`,   inline: true }
                )
                .setColor(GREEN)
                .setFooter({ text: "SMVLL HUB • HS CORP" })
                .setTimestamp()
            ]
        });
    }

    // ── /wl-expire-soon ────────────────────────────────────────────────────
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

        const list = soon.map(line =>
            `• **${getUserName(line)}** — ${formatExpiry(line)}`
        ).join("\n");

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setTitle(`⚠️ Expire dans ${jours}j — ${soon.length} user(s)`)
                .setDescription(list)
                .setColor(ORANGE)]
        });
    }

    // ── /wl-clear ──────────────────────────────────────────────────────────
    else if (cmd === 'wl-clear') {
        const { sha } = await getFile();
        await updateFile("", sha);
        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setDescription("🗑️ Whitelist vidée.")
                .setColor(RED)]
        });
        sendLog("🗑️ Whitelist vidée", [
            { name: "👮 Par", value: interaction.user.tag }
        ], RED);
    }

    // ── /wl-purge-expired ──────────────────────────────────────────────────
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
                    { name: "🗑️ Supprimés",  value: `${removed}`,  inline: true },
                    { name: "✅ Restants",    value: `${after}`,    inline: true }
                )
                .setColor(removed > 0 ? ORANGE : GREEN)]
        });

        if (removed > 0) {
            sendLog("🧹 Purge expirés", [
                { name: "🗑️ Supprimés", value: `${removed}`, inline: true },
                { name: "👮 Par",       value: interaction.user.tag, inline: true }
            ], ORANGE);
        }
    }

    // ── /wl-import ─────────────────────────────────────────────────────────
    else if (cmd === 'wl-import') {
        const input  = interaction.options.getString('users');
        const time   = interaction.options.getString('time') || 'lifetime';
        const names  = input.split(",").map(n => n.trim()).filter(n => n.length > 0);

        let { content, sha } = await getFile();
        content = cleanExpired(content);
        const existing = parseUsers(content).map(l => getUserName(l).toLowerCase());

        const added    = [];
        const skipped  = [];

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
                    { name: "✅ Ajoutés",   value: added.length > 0 ? added.join(", ") : "aucun",     inline: false },
                    { name: "⚠️ Ignorés",  value: skipped.length > 0 ? skipped.join(", ") : "aucun",  inline: false },
                    { name: "⏱️ Durée",    value: time,                                                inline: true }
                )
                .setColor(GREEN)]
        });

        if (added.length > 0) {
            sendLog("📥 Import WL", [
                { name: "✅ Ajoutés",  value: `${added.length}`,       inline: true },
                { name: "⏱️ Durée",   value: time,                     inline: true },
                { name: "👮 Par",     value: interaction.user.tag,     inline: true }
            ], GREEN);
        }
    }

    // ── /bl-add ────────────────────────────────────────────────────────────
    else if (cmd === 'bl-add') {
        const user  = interaction.options.getString('user');
        const blFile = await getFile("blacklist.txt").catch(() => null);
        let content = blFile ? blFile.content : "";
        let sha     = blFile ? blFile.sha : null;

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
            { name: "👤 User", value: user,                    inline: true },
            { name: "👮 Par",  value: interaction.user.tag,    inline: true }
        ], RED);
    }

    // ── /bl-remove ─────────────────────────────────────────────────────────
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
            { name: "👤 User", value: user,                    inline: true },
            { name: "👮 Par",  value: interaction.user.tag,    inline: true }
        ], GREEN);
    }

    // ── /bl-list ───────────────────────────────────────────────────────────
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

    // ── /bl-check ──────────────────────────────────────────────────────────
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

    // ── /dmall ─────────────────────────────────────────────────────────────
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
                    embeds: [new EmbedBuilder()
                        .setTitle("🚀 SMVLL SEMI TP")
                        .setDescription(
                            "```lua\ngetgenv().SCRIPT_KEY = \"KEYLESS\"\nloadstring(game:HttpGet(\"https://api.jnkie.com/api/v1/luascripts/public/ec68356c9cf8b03319aee4ada6abab24035cc18ce0ecf8bd9e6346917c71b8b8/download\"))()\n```"
                        )
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
                    { name: "✅ Succès",    value: `${success}`,        inline: true },
                    { name: "❌ Échecs",    value: `${failed}`,         inline: true },
                    { name: "👥 Total",     value: `${members.size}`,   inline: true }
                )
                .setColor(GREEN)
                .setFooter({ text: "SMVLL HUB • HS CORP" })
                .setTimestamp()
            ]
        });

        sendLog("📨 /dmall exécuté", [
            { name: "✅ Succès",  value: `${success}`,         inline: true },
            { name: "❌ Échecs", value: `${failed}`,           inline: true },
            { name: "👮 Par",   value: interaction.user.tag,   inline: true }
        ], GREEN);
    }

    // ── /announce ──────────────────────────────────────────────────────────
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
            { name: "📌 Channel", value: `<#${targetChannel.id}>`,  inline: true },
            { name: "👮 Par",    value: interaction.user.tag,        inline: true }
        ], PURPLE);
    }

} catch (err) {
    console.error(err);
    interaction.editReply({
        embeds: [new EmbedBuilder()
            .setDescription(`❌ Erreur : \`${err.message}\``)
            .setColor(RED)]
    });
}
```

});

client.login(TOKEN);