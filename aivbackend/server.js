require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { OpenAI } = require('openai');
const { Readable } = require('stream');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const FormData = require('form-data');

ffmpeg.setFfmpegPath(ffmpegPath);

const transcodeToWav = (inputBuffer) => {
  return new Promise((resolve, reject) => {
    const inputStream = Readable.from(inputBuffer);
    const output = [];

    const command = ffmpeg(inputStream)
      .inputFormat('m4a')
      .audioCodec('pcm_s16le')
      .format('wav')
      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(output)))
      .pipe();

    command.on('data', chunk => output.push(chunk));
  });
};

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
let userVoices = [];
let formattedVoiceList = []
let lastGroceryQuestion = null;
let pendingVoiceChange = false;

io.on('connection', (socket) => {
  console.log('Client connected');

  let userLang = 'en';
  let userName = '';
  const userInfo = { when: null, where: null, howOften: null, items: null, voiceId: null };
  let infoConfirmed = false;

  const baseSystemPrompt = () => {
    return `
    ROLE:
    You are Froogle, a grocery shopping assistant designed to help users save money on their carts.

    CORE MISSION:
    1. Be friendly, cheerful and chatty
    2. Help users save 5-30% on groceries through smart cart price comparisons
    3. Build personalized shopping profiles
    4. Gather data about user's grocery shopping routine

    STRICT CONVERSATION FLOW RULES:
    1. FIRST PHASE - VOICE SELECTION:
      - Present voice options immediately
      - DO NOT mention groceries until voice is confirmed
      - If user doesn't select a voice, keep asking
    
    2. SECOND PHASE - GROCERIES:
      - Only begin after explicit voice confirmation
      - Start with shopping habits question
      - keep gathering info until all the data is collected

    VOICE SELECTION DIALOGUE RULES:
    - Initial message: Present voice options clearly
    - If user selects voice: Confirm and ask if they want to keep it
    - If user wants to change: Repeat selection process
    - Only proceed when user says "yes", "ok", or similar confirmation
    - NEVER discuss technical voice details

    EXAMPLE:
    AI: [voice options]
    User: "Try Sarah"
    AI: "Now using Sarah's voice. Keep this one?"
    User: "No, try Eric"
    AI: "Now using Eric's voice. Keep this one?"
    User: "Yes"
    AI: "Great! When do you usually shop?"

    GROCERY CONVERSATION RULES:
    - Only begin after voice confirmation
    - Follow the exact data collection flow

    
    DATA COLLECTION FLOW:
    1. GREETING AND VOICE SETTING:
    "Hi ${userName}! I am Fruggle your AI grocery assistant. I am here to help you save on your shopping basket. By the way i am speaking with my default voice. Would you like to try another voice?"

    2. SHOPPING HABITS:
    "Great! So can you tell me what time or what days you usually go shopping? (e.g., On Wednesdays, weekends, daily, weekly,...)"

    3. STORE PREFERENCES(require 3 +):
    "Could you please tell me about the stores you usually visit? I will help you compare stores to find the best deal for you."
      * Gently persist until at least 3 stores provided saying that you need 3 to compare to help the user save money*

    4. COMMUNICATION:
    "How do you want me to send you deals? (App notifications, WhatsApp, etc.)"

    5. TYPICAL ITEMS:
    "Now in order to help find you the best cart with savings I need to know what items do you regularly buy? You can tell me or send pictures, you choose!"

    6. SAVINGS ALERTS:
    "Last but not least, I wanna let you know about deals you can't miss. Are you okay with sending you alerts whenever I find savings over $5? Most members save $15/week so this will help you make your subscribtion fees!"

    CONVERSATION RULES:
    - TONE: Warm but professional
    - PACE: 1 question at a time
    - LENGTH: Keep responses under 3 sentences
    - Do not ask direct questions where possible
    - You know your goals and objectives
    - Do not say "How can I assist you today"
    - If user asks about voices: "Here is a list of available voices. Just tell me the voice name you like." then pause the grocery conversation until you have a voice confirmation
    - If user confirms a voice by its name: "This is the voice you chose. Do you like it or you would like to change it again?" then either loop back with the voice until the user chooses or continue the grocery conversation i user confirms again
    - Once in the conversation assure the user that this process will be for one time only saying "Don't worry, you need to answer these questions only for the first time just to get to know you better and help you save on your cart"
    - When all data is collected end the conversation with a summary of everything you know including the user name ${userName} and user's language ${userLang}

    EXAMPLE FLOW:
    AI: Hi ${userName}! Ready to save on groceries? Start by telling me which days do you usually go shopping for groceries.
    User : No specific days
    AI: Perfect! I'll watch for deals all week. And could you please tell me which 3 stores should I compare?
    User: Walmart, Target, Safeway
    AI: Great choices! And how would you like me to notify you about new savings ? (WhatsApp, app notifications, etc.)
    [...etc...]

    CLOSING:
    "Thanks for trusting Froogle! Your will start saving on your grocery cart soon!"
    `;
  };

  let conversationHistory = [
    { role: 'system', content: baseSystemPrompt(userVoices) },
  ];

  let audioChunks = [];

  const isVoiceChangeRequest = (text, voices) => {
    const voiceNames = voices.map(v => v.name.toLowerCase());
    const patterns = [
      /change.*voice/i,
      /switch.*voice/i,
      /try.*voice/i,
      /use.*voice/i,
      new RegExp(`\\b(${voiceNames.join('|')})\\b`, 'i')
    ];
    return patterns.some(pattern => pattern.test(text));
  };

  const isAgreeing = async (text) => {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
          You are a helpful assistant that classifies whether the user's input indicates agreement or disagreement.
          Respond with only one word: "yes", "no", or "unsure".
          `
        },
        {
          role: "user",
          content: text
        }
      ]
    });

    const answer = completion.choices[0].message.content.trim().toLowerCase();

    if (answer === "yes") return true;
    if (answer === "no") return false;
    return null;
  }

  socket.on('setup', ({ language, name, voices }) => {
    userLang = language || 'en';
    userName = name || 'User';
    userVoices = voices || [];
    infoConfirmed = false;

    console.log(`[SERVER] Language: ${userLang}, User: ${userName}, Voices received: ${voices.length} `);

    formattedVoiceList = userVoices.slice(0, 3).map(v => {
      const accent = v.labels?.accent || '';
      return `${v.name} (${accent || 'Unknown'})`;
    }).join(', ');

    conversationHistory = [
      { role: 'system', content: baseSystemPrompt(userVoices) }
    ];
  });

  let voiceSelectionActive = false;

  socket.on('greet_user', async () => {
    try {
      conversationHistory = [
        { role: 'system', content: baseSystemPrompt(userVoices) },
        { role: 'user', content: 'Hello' }
      ];

      // Initial greeting focusing only on voice selection
      const greeting = `Hi ${userName}! I'm Froogle, your AI grocery shopping assistant.I will help you save on your carts!\nFirst let's start by customizing my voice to your liking. I'm currently using my default voice, but I have other options available.\nJust say the name of the voice you want from the list below.`;

      socket.emit('ai_response', {
        text: greeting,
        triggerVoiceDialog: true
      });

      voiceSelectionActive = true;
      conversationHistory.push({ role: 'assistant', content: greeting });

    } catch (err) {
      console.error('Greet error:', err);
      socket.emit('ai_response', { text: 'Hello! Let me introduce myself...' });
    }
  });

  socket.on('audio_chunk', (base64) => {
    const buffer = Buffer.from(base64, 'base64');
    audioChunks.push(buffer);
  });

  socket.on('audio_end', async () => {
    // if (!userLang || !userName) {
    //   console.warn('[SERVER] Missing userLang or userName');
    //   socket.emit('ai_response', { text: 'Waiting for setup to complete. Please try again.' });
    //   return;
    // }

    const buffer = Buffer.concat(audioChunks);
    audioChunks = [];

    let wavBuffer;
    try {
      wavBuffer = await transcodeToWav(buffer);
    } catch (err) {
      socket.emit('ai_response', { text: 'Could not process your voice. Please try again.' });
      return;
    }

    try {
      const form = new FormData();
      form.append('file', wavBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
      form.append('model', 'whisper-1');
      form.append('response_format', 'json');
      form.append('language', userLang);

      const transcriptionRes = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        form,
        {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${process.env.OPENAI_API_KEY} `,
          },
        }
      );

      const userText = transcriptionRes.data.text;
      console.log('[SERVER] Transcription:', userText);
      socket.emit('user_transcription', { text: userText });

      const mentionedVoice = userVoices.find(v =>
        new RegExp(`\\b${v.name}\\b`, 'i').test(userText)
      );

      if (isVoiceChangeRequest(userText, userVoices)) {
        pendingVoiceChange = true;
        voiceSelectionActive = true;

        if (mentionedVoice) {
          socket.emit('voice_suggestion', {
            voiceName: mentionedVoice.name,
            voiceId: mentionedVoice.voice_id
          });

          const response = `I've switched to ${mentionedVoice.name}'s voice. Do you want to keep this one?`;
          socket.emit('ai_response', {
            text: response,
            triggerVoiceDialog: true
          });
          return;
        } else {
          socket.emit('ai_response', {
            text: `Sure!\nJust tell me the name of the voice you want from the list below.`,
            triggerVoiceDialog: true
          });
          return;
        }
      }

      if (voiceSelectionActive) {
        if (mentionedVoice) {
          socket.emit('voice_suggestion', {
            voiceName: mentionedVoice.name,
            voiceId: mentionedVoice.voice_id
          });

          const response = `I'm now speaking as ${mentionedVoice.name}.\nDo you like this voice or would you like to choose another?`;
          socket.emit('ai_response', { text: response });
          return;
        } else if (await isAgreeing(userText)) {
          voiceSelectionActive = false;

          let response;
          if (pendingVoiceChange && lastGroceryQuestion) {
            // Return to where we left off in grocery conversation
            response = `Voice updated! ${lastGroceryQuestion}`;
            pendingVoiceChange = false;
          } else {
            // Initial voice selection flow
            response = `Perfect! Let's move forward. I want to help you save on your grocery cart.\n\nSo ${userName}, when do you usually go shopping?`;
            lastGroceryQuestion = "When do you usually go shopping?";
          }

          socket.emit('ai_response', { text: response });
          conversationHistory.push(
            { role: 'user', content: 'Voice confirmed' },
            { role: 'assistant', content: response }
          );
          return;
        } else {
          socket.emit('ai_response', {
            text: `Please choose a voice from the list. Just say the voice name you prefer.`,
            triggerVoiceDialog: true
          });
          return;
        }
      } else {
        const extractionPrompt = `
        You are a helpful assistant extracting grocery shopping info from the user's input.

        Only extract the fields the user actually mentioned.

        Return a **partial JSON** object with ONLY the keys the user talked about.

        Note:
        - "when" means specific days or times, e.g., "Monday morning", "weekends".
        - "howOften" means frequency, e.g., "daily", "weekly", "usually".
        - Do NOT guess or fill missing fields with "any". Omit them if not mentioned.

        Example 1:
        User: "I usually shop on Sundays."
        Return:
        { "when": "Sunday" }

        Example 2:
        User: "I buy fruits and vegetables at Walmart every Friday."
        Return:
        {
          "when": "Friday",
          "where": "Walmart",
          "items": "fruits and vegetables"
        }

        No Markdown, no explanation. Only return raw JSON.
        User said:
        """${userText}"""
      `;

        const extractionRes = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'You are a JSON extractor assistant.' },
            { role: 'user', content: extractionPrompt },
          ],
          temperature: 0,
        });

        let extractedInfo = {};
        try {
          const raw = extractionRes.choices[0].message.content;
          const cleaned = raw.replace(/```json|```/g, '').trim();
          extractedInfo = JSON.parse(cleaned);
        } catch (e) {
          console.warn('[SERVER] Failed to parse JSON:', e.message);
          console.warn('[SERVER] Raw content:', extractionRes.choices[0].message.content);
        }

        for (const key of Object.keys(extractedInfo)) {
          if (typeof extractedInfo[key] === 'string') {
            const val = extractedInfo[key].toLowerCase().trim();
            if (['', 'null', 'undefined'].includes(val)) continue;
            userInfo[key] = extractedInfo[key];
          }
        }

        console.log('[SERVER] Updated userInfo:', JSON.stringify(userInfo, null, 2));
        conversationHistory.push({ role: 'user', content: userText });

        const allFilled = Object.values(userInfo).every(val => val);
        if (!infoConfirmed && allFilled) {
          const readable = (val, key) => {
            if (val === 'any') {
              switch (key) {
                case 'howOften': return 'whenever it fits your schedule';
                case 'where': return 'anywhere';
                case 'when': return 'any time';
                case 'items': return 'a variety of items';
                default: return 'any';
              }
            }
            return val;
          };

          const summary = `Thanks, ${userName}! Just to confirm, you shop ${readable(userInfo.howOften, 'howOften')} at ${readable(userInfo.where, 'where')}, usually on ${readable(userInfo.when, 'when')}, and you buy ${readable(userInfo.items, 'items')}. Have a great day!`;
          socket.emit('ai_response', { text: summary });
          infoConfirmed = true;
          return;
        }

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: conversationHistory,
        });

        const aiText = completion.choices[0].message.content;
        if (aiText.includes('?')) {
          lastGroceryQuestion = aiText;
        }
        conversationHistory.push({ role: 'assistant', content: aiText });
        console.log('[SERVER] AI Response:', aiText);

        socket.emit('ai_response', { text: aiText });

      }

    } catch (err) {
      socket.emit('ai_response', { text: 'Error understanding audio. Please try again.' });
      console.error('[SERVER] Error:', err?.response?.data || err.message);
    }
  });

  socket.on('voice_confirmed', async () => {
    if (!socket.pendingVoiceSwitch || !socket.lastUserInput) return;

    console.log('[SERVER] Voice change confirmed, continuing conversation');

    // const confirmation = `Alright! From now on, I'll speak as ${socket.selectedVoice.name}.`;
    // conversationHistory.push({ role: 'assistant', content: confirmation });
    // socket.emit('ai_response', { text: confirmation });

    // Continue with the original conversation
    conversationHistory.push({ role: 'user', content: socket.lastUserInput });

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: conversationHistory,
      });

      const aiText = completion.choices[0].message.content;
      conversationHistory.push({ role: 'assistant', content: aiText });
      socket.emit('ai_response', { text: aiText });
    } catch (err) {
      console.error('[SERVER] Error continuing conversation:', err);
      socket.emit('ai_response', { text: "Let's continue our conversation." });
    }

    // Reset
    socket.lastUserInput = null;
    socket.selectedVoice = null;
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

server.listen(3000, () => console.log('Server listening on port 3000'));
