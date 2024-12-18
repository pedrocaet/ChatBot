// Importações necessárias
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode'); // Para salvar QR Code como imagem
const { Client, LocalAuth } = require('whatsapp-web.js');

// Configurando o cliente do WhatsApp Web
const client = new Client({
    puppeteer: {
        headless: true, // Executa em segundo plano
        args: ['--no-sandbox', '--disable-setuid-sandbox'], // Melhora compatibilidade em alguns sistemas
    },
    authStrategy: new LocalAuth(), // Salva as credenciais para reconectar automaticamente
    qrMaxRetries: 10, // Mais tentativas para escanear o QR Code
});

client.on('ready', async () => {
    console.log('Bot conectado e pronto para receber mensagens!');
    const chats = await client.getChats();
    console.log(`Total de chats carregados: ${chats.length}`);
});

// Mapeamento para armazenar o estado de cada conversa
const userStates = {};

// Lista de usuários que já concluíram o fluxo
const completedUsers = new Set(); // Usando Set para evitar duplicidade

// Perguntas do fluxo
const questions = [
    "Olá, {name}, sou o assistente virtual da Gonçalves Advocacia Especializada. Para adiantarmos o seu processo, por gentileza, me informe sua idade.",
    "Qual é a sua profissão?",
    "Você trabalha em alguma atividade atualmente?",
    "Qual o seu grau de escolaridade?",
    "Você mora sozinho(a) ou com família?",
    "Quantas pessoas residem na sua casa?",
    "Quantas pessoas possuem renda formal (carteira assinada)?",
    "Você possui relatório médico?",
    "Qual é a situação atual da sua doença?",
];

// Função para obter a próxima pergunta do fluxo
const getNextQuestion = (userId) => {
    const currentStep = userStates[userId]?.step || 0;
    return questions[currentStep] || null;
};

// Função para avançar o estado do usuário
const advanceUserState = (userId) => {
    if (!userStates[userId]) {
        userStates[userId] = { step: 0, data: [] };
    } else {
        userStates[userId].step += 1;
    }
};

// Evento para gerar o QR Code
client.on('qr', async (qr) => {
    console.log('QR Code recebido. Escaneie para conectar.');
    qrcode.generate(qr, { small: true }); // Exibe no terminal

    // Salva o QR Code como imagem
    await QRCode.toFile('./qrcode.png', qr, (err) => {
        if (err) {
            console.error('Erro ao salvar QR Code:', err);
        } else {
            console.log('QR Code também salvo como "qrcode.png". Abra o arquivo para escanear.');
        }
    });
});

// Evento quando o cliente está pronto
client.on('ready', () => {
    console.log('Tudo certo! WhatsApp conectado.');
});

// Evento para tratar falhas na autenticação
client.on('auth_failure', (msg) => {
    console.error('Falha na autenticação:', msg);
});

// Evento para tratar desconexões
client.on('disconnected', (reason) => {
    console.log(`Cliente desconectado: ${reason}`);
    client.initialize(); // Reinitialize if needed
});

// Inicializando o cliente
client.initialize();

const delay = (ms) => new Promise((res) => setTimeout(res, ms)); // Função de delay

// Função para gerenciar mensagens recebidas
client.on('message', async (msg) => {
    const userId = msg.from;

    // Se o usuário já completou o fluxo, responde apenas uma vez e retorna
    if (completedUsers.has(userId)) {
        if (!userStates[userId]?.finalMessageSent) {
            await client.sendMessage(
                msg.from,
                "Já coletamos suas informações. Caso precise de algo, envie uma nova mensagem."
            );
            userStates[userId] = { finalMessageSent: true }; // Garante envio único
        }
        return;
    }

    // Inicializa o estado do usuário se for a primeira mensagem
    if (!userStates[userId]) {
        const contact = await msg.getContact();
        const name = contact.pushname || "amigo(a)";
        userStates[userId] = { step: 0, data: [], name };
    }

    const userState = userStates[userId];

    // Se o usuário envia uma mensagem para iniciar o fluxo
    if (
        userState.step === 0 &&
        msg.body.match(/(mais|Mais|dia|tarde|noite|oi|Oi|Olá|olá|ola|Ola|Saber|saber|mas|Mas|Opa)/i) &&
        msg.from.endsWith('@c.us')
    ) {
        const chat = await msg.getChat();

        await delay(3000); // Delay de 3 segundos
        await chat.sendStateTyping(); // Simulando digitação
        await delay(3000);

        // Envia a primeira pergunta
        const firstQuestion = questions[0].replace("{name}", userState.name.split(' ')[0]);
        await client.sendMessage(msg.from, firstQuestion);
        advanceUserState(userId); // Avança para o próximo passo
        return;
    }

    // Se o usuário está respondendo ao fluxo
    if (userState.step > 0 && userState.step < questions.length) {
        // Salva a resposta do usuário
        userState.data.push(msg.body);

        // Avança para a próxima pergunta
        advanceUserState(userId);

        // Envia a próxima pergunta
        const nextQuestion = getNextQuestion(userId);
        if (nextQuestion) {
            await delay(2000); // Delay antes de enviar a próxima mensagem
            await client.sendMessage(msg.from, nextQuestion.replace("{name}", userState.name.split(' ')[0]));
        } else {
            // Fluxo concluído
            await delay(2000);
            await client.sendMessage(
                msg.from,
                "Obrigado por responder todas as perguntas. Entraremos em contato em breve!"
            );
            completedUsers.add(userId); // Marca o usuário como concluído
            delete userStates[userId]; // Remove o estado do usuário
        }
        return;
    }
});