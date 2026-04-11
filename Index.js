const {
    Client, GatewayIntentBits, EmbedBuilder,
    REST, Routes, SlashCommandBuilder
} = require('discord.js');
const axios = require('axios');
const ms = require('ms');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const TOKEN = process.env.TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = "SM3LLTHRX/SMVLLHUBpremium";
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_ID = process.env.OWNER_ID;

const GREEN = 0x00FF64;
const RED = 0xFF4444;
const YELLOW = 0xFFCC00;
const BLUE = 0x4488FF;
const ORANGE = 0xFF8800;

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
    const now = Math.floor(Date.now() / 1000);
    const diff = exp - now;
    if (diff <= 0) return "⛔ Expiré";
    const days = Math.floor(diff / 86400);
    const hours = Math.floor((diff % 86400) / 3600);
    if (days > 0) return `📅 ${days}j ${hours}h`;
    return `⏰ ${hours}h`;
}

function buildEntry(user, time) {
    if (time === "lifetime") return `${user},`;
    const expire = Math.floor((Date.now() + ms(time)) / 1000);
    return `${user},${expire}`;
}

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

async function checkExpiringSoon() {
    const channel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) return;
    try {
        let { content } = await getFile();
        const now = Math.floor(Date.now() / 1000);
        const soon = 3 * 24 * 3600;
        const expiringSoon = parseUsers(content).filter(line => {
            const exp = getExpiry(line);
            if (!exp) return false;
            const diff = exp - now;
            return diff > 0 && diff <= soon;
        });
        if (expiringSoon.length === 0) return;
        const list = expiringSoon.map(line => {
            const name = getUserName(line);
            const exp = getExpiry(line);
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

const commands = [
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Afficher le guide des formats de temps et commandes'),

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

].map(c => c.toJSON());

client.once('ready', async () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Commandes enregistrées");
    setInterval(checkExpiringSoon, 60 * 60 * 1000);
    checkExpiringSoon();
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (!isOwner(interaction)) {
        return interaction.reply({
            embeds: [new EmbedBuilder().setDescription("⛔ Accès refusé.").setColor(RED)],
            ephemeral: true
        });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const cmd = interaction.commandName;

        if (cmd === 'help') {
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("📖 Guide d'utilisation - Formats de Temps")
                    .setDescription("Voici comment spécifier la durée pour les commandes utilisant l'option `time` (comme `/wl-add` ou `/wl-edit`). Le bot utilise les abréviations anglaises.")
                    .addFields(
                        { name: "⏱️ Secondes", value: "`1s`, `30s`", inline: true },
                        { name: "⏱️ Minutes", value: "`1m`, `15m`", inline: true },
                        { name: "⏱️ Heures", value: "`1h`, `12h` (Hours)", inline: true },
                        { name: "📅 Jours", value: "`1d`, `3d` (Days)", inline: true },
                        { name: "📅 Semaines", value: "`1w`, `2w` (Weeks)", inline: true },
                        { name: "📅 Années", value: "`1y` (Years)", inline: true },
                        { name: "♾️ À vie", value: "`lifetime` (Pas d'expiration)", inline: false }
                    )
                    .setColor(BLUE)
                    .setFooter({ text: "SMVLL HUB • HS CORP" })
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
                        { name: "👤 User", value: user, inline: true },
                        { name: "⏱️ Durée", value: time, inline: true }
                    )
                    .setColor(GREEN)]
            });

            sendLog("✅ Whitelist ajoutée", [
                { name: "👤 User", value: user, inline: true },
                { name: "⏱️ Durée", value: time, inline: true },
                { name: "👮 Par", value: interaction.user.tag, inline: true }
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
                { name: "👤 User", value: user, inline: true },
                { name: "👮 Par", value: interaction.user.tag, inline: true }
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
                        { name: "👤 User", value: user, inline: true },
                        { name: "⏱️ Nouvelle durée", value: time, inline: true }
                    )
                    .setColor(BLUE)]
            });

            sendLog("✏️ Whitelist modifiée", [
                { name: "👤 User", value: user, inline: true },
                { name: "⏱️ Nouvelle durée", value: time, inline: true },
                { name: "👮 Par", value: interaction.user.tag, inline: true }
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
            const newExp = Math.floor((base + ms(time)) / 1000);
            lines[idx] = `${user},${newExp}`;
            await updateFile(lines.join("\n"), sha);

            const days = Math.ceil((newExp - Math.floor(Date.now() / 1000)) / 86400);
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("🔄 Whitelist renouvelée")
                    .addFields(
                        { name: "👤 User", value: user, inline: true },
                        { name: "📅 Expire dans", value: `${days}j`, inline: true }
                    )
                    .setColor(GREEN)]
            });

            sendLog("🔄 Whitelist renouvelée", [
                { name: "👤 User", value: user, inline: true },
                { name: "📅 Expire dans", value: `${days}j`, inline: true },
                { name: "👮 Par", value: interaction.user.tag, inline: true }
            ], GREEN);
        }

        else if (cmd === 'wl-check') {
            const user = interaction.options.getString('user');
            let { content } = await getFile();
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
                        { name: "👤 User", value: user, inline: true },
                        { name: "⏱️ Expiration", value: formatExpiry(line), inline: true }
                    )
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

            const list = lines.map(line => {
                const name = getUserName(line);
                return `• **${name}** — ${formatExpiry(line)}`;
            }).join("\n");

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle(`📋 Whitelist — ${lines.length} users`)
                    .setDescription(list)
                    .setColor(GREEN)]
            });
        }

        else if (cmd === 'wl-stats') {
            let { content } = await getFile();
            const all = parseUsers(content);
            const now = Math.floor(Date.now() / 1000);
            const actifs = all.filter(l => !isExpired(l)).length;
            const expires = all.filter(l => isExpired(l)).length;
            const lifetime = all.filter(l => !getExpiry(l)).length;
            const { content: blContent } = await getFile("blacklist.txt").catch(() => ({ content: "" }));
            const blacklisted = parseUsers(blContent).length;

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("📊 SMVLL HUB — Stats")
                    .addFields(
                        { name: "✅ Actifs", value: `${actifs}`, inline: true },
                        { name: "⛔ Expirés", value: `${expires}`, inline: true },
                        { name: "♾️ Lifetime", value: `${lifetime}`, inline: true },
                        { name: "🚫 Blacklist", value: `${blacklisted}`, inline: true },
                        { name: "📦 Total", value: `${all.length}`, inline: true }
                    )
                    .setColor(GREEN)]
            });
        }

        else if (cmd === 'wl-expire-soon') {
            const jours = interaction.options.getInteger('jours') || 3;
            let { content } = await getFile();
            const now = Math.floor(Date.now() / 1000);
            const limit = jours * 86400;

            const soon = parseUsers(content).filter(line => {
                const exp = getExpiry(line);
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

            const list = soon.map(line => {
                const name = getUserName(line);
                return `• **${name}** — ${formatExpiry(line)}`;
            }).join("\n");

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle(`⚠️ Expire dans ${jours}j`)
                    .setDescription(list)
                    .setColor(ORANGE)]
            });
        }

        else if (cmd === 'wl-clear') {
            await updateFile("", (await getFile()).sha);
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setDescription("🗑️ Whitelist vidée.")
                    .setColor(RED)]
            });
            sendLog("🗑️ Whitelist vidée", [
                { name: "👮 Par", value: interaction.user.tag }
            ], RED);
        }

        else if (cmd === 'bl-add') {
            const user = interaction.options.getString('user');
            let blFile = await getFile("blacklist.txt").catch(() => null);

            let content = blFile ? blFile.content : "";
            let sha = blFile ? blFile.sha : null;

            if (parseUsers(content).some(l => l.toLowerCase() === user.toLowerCase())) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder().setDescription(`⚠️ **${user}** est déjà blacklisté.`).setColor(YELLOW)]
                });
            }

            content = (content.trimEnd() + "\n" + user).trim();

            if (!sha) {
                await axios.put(
                    `https://api.github.com/repos/${REPO}/contents/blacklist.txt`,
                    {
                        message: "create blacklist",
                        content: Buffer.from(content).toString('base64')
                    },
                    { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
                );
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
                { name: "👤 User", value: user, inline: true },
                { name: "👮 Par", value: interaction.user.tag, inline: true }
            ], RED);
        }

        else if (cmd === 'bl-remove') {
            const user = interaction.options.getString('user');
            let { content, sha } = await getFile("blacklist.txt");
            const before = content;
            content = parseUsers(content).filter(l => l.toLowerCase() !== user.toLowerCase()).join("\n");

            if (content === before.trim()) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder().setDescription(`❌ **${user}** introuvable dans le blacklist.`).setColor(RED)]
                });
            }

            await updateFile(content, sha, "blacklist.txt");
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setDescription(`✅ **${user}** retiré du blacklist.`)
                    .setColor(GREEN)]
            });

            sendLog("✅ Blacklist retirée", [
                { name: "👤 User", value: user, inline: true },
                { name: "👮 Par", value: interaction.user.tag, inline: true }
            ], GREEN);
        }

        else if (cmd === 'bl-list') {
            let { content } = await getFile("blacklist.txt");
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

    } catch (err) {
        console.error(err);
        interaction.editReply({
            embeds: [new EmbedBuilder().setDescription(`❌ Erreur : ${err.message}`).setColor(RED)]
        });
    }
});

client.login(TOKEN);
