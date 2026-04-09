const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const ms = require('ms');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const TOKEN = process.env.TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = "SM3LLTHRX/SMVLLHUBpremium";
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const CLIENT_ID = process.env.CLIENT_ID;

async function getFile() {
    const res = await axios.get(
        `https://api.github.com/repos/${REPO}/contents/whitelist.txt`,
        { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );
    return {
        content: Buffer.from(res.data.content, 'base64').toString(),
        sha: res.data.sha
    };
}

async function updateFile(content, sha) {
    await axios.put(
        `https://api.github.com/repos/${REPO}/contents/whitelist.txt`,
        {
            message: "whitelist update",
            content: Buffer.from(content).toString('base64'),
            sha
        },
        { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );
}

function cleanExpired(content) {
    const now = Math.floor(Date.now() / 1000);
    return content.split("\n").filter(line => {
        const match = line.match(/\|(\d+)/);
        if (!match) return line.trim().length > 0;
        return parseInt(match[1]) > now;
    }).join("\n");
}

function sendLog(title, desc) {
    const channel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) return;
    channel.send({
        embeds: [
            new EmbedBuilder()
                .setTitle(title)
                .setDescription(desc)
                .setColor(0x00FF64)
                .setTimestamp()
        ]
    });
}

client.once('ready', async () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('whitelist')
            .setDescription('Ajouter un user à la whitelist')
            .addStringOption(o => o.setName('user').setDescription('Nom Roblox').setRequired(true))
            .addStringOption(o => o.setName('time').setDescription('Ex: 1w, 2m, lifetime').setRequired(true)),

        new SlashCommandBuilder()
            .setName('wl-remove')
            .setDescription('Retirer un user de la whitelist')
            .addStringOption(o => o.setName('user').setDescription('Nom Roblox').setRequired(true)),

        new SlashCommandBuilder()
            .setName('wl-list')
            .setDescription('Voir la whitelist'),
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Commandes enregistrées");
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    await interaction.deferReply();

    try {
        let { content, sha } = await getFile();
        content = cleanExpired(content);

        if (interaction.commandName === 'whitelist') {
            const user = interaction.options.getString('user');
            const time = interaction.options.getString('time');

            if (content.includes(user + ",") || content.includes(user + "|")) {
                return interaction.editReply(`⚠️ ${user} est déjà dans la whitelist.`);
            }

            const entry = time === "lifetime"
                ? `${user},`
                : `${user}|${Math.floor((Date.now() + ms(time)) / 1000)},`;

            content = content.trimEnd() + "\n" + entry;
            await updateFile(content, sha);

            await interaction.editReply(`✅ **${user}** ajouté (${time})`);
            sendLog("✅ Ajouté", `👤 ${user}\n⏱️ ${time}\n👮 ${interaction.user.tag}`);
        }

        else if (interaction.commandName === 'wl-remove') {
            const user = interaction.options.getString('user');
            const before = content;
            content = content.split("\n").filter(l => !l.startsWith(user)).join("\n");

            if (content === before) return interaction.editReply(`❌ ${user} introuvable.`);

            await updateFile(content, sha);
            await interaction.editReply(`🗑️ **${user}** retiré.`);
            sendLog("🗑️ Retiré", `👤 ${user}\n👮 ${interaction.user.tag}`);
        }

        else if (interaction.commandName === 'wl-list') {
            const now = Math.floor(Date.now() / 1000);
            const lines = content.split("\n").filter(l => l.trim());

            if (!lines.length) return interaction.editReply("📋 Whitelist vide.");

            const formatted = lines.map(line => {
                const name = line.split(/[|,]/)[0].trim();
                const match = line.match(/\|(\d+)/);
                if (!match) return `• ${name} — lifetime`;
                const days = Math.ceil((parseInt(match[1]) - now) / 86400);
                return `• ${name} — ${days}j restants`;
            }).join("\n");

            await interaction.editReply(`📋 **Whitelist (${lines.length})** :\n${formatted}`);
        }

    } catch (err) {
        interaction.editReply("❌ Erreur : " + err.message);
    }
});

client.login(TOKEN);
