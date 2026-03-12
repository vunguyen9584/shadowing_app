import { GoogleGenAI, Modality, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface ShadowingScript {
  originalText: string;
  markedText: string;
  explanation: string;
  vietnameseExplanation: string;
}

export async function generateShadowingScript(level: string, wordCount: number, topic?: string): Promise<ShadowingScript> {
  const prompt = `Generate a short English shadowing script (approximately ${wordCount} words) for a ${level} learner. 
  ${topic ? `Topic: ${topic}.` : "Choose an engaging everyday topic."}
  
  Provide the following:
  1. originalText: Clean text without any symbols.
  2. markedText: The text with shadowing markup:
     - Bold stressed words (e.g., **Hello**).
     - Use "/" for short pauses.
     - Use "//" for end of sentences.
     - Use ↗ for rising intonation and ↘ for falling intonation where appropriate.
  3. explanation: A brief explanation in English about the rhythm and key sounds.
  4. vietnameseExplanation: A brief explanation in Vietnamese about the rhythm and key sounds.

  Return the result as a JSON object.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          originalText: { type: Type.STRING },
          markedText: { type: Type.STRING },
          explanation: { type: Type.STRING },
          vietnameseExplanation: { type: Type.STRING },
        },
        required: ["originalText", "markedText", "explanation", "vietnameseExplanation"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
}

export async function generateSpeech(text: string, speed: "slow" | "natural" = "natural"): Promise<string> {
  const voiceName = "Kore"; // Cheerful/Professional female voice
  const speedInstruction = speed === "slow" ? "Speak slowly and clearly, emphasizing each syllable." : "Speak at a natural, conversational pace with proper intonation.";
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `${speedInstruction}: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("Failed to generate audio");
  
  // Convert base64 to Uint8Array
  const binaryString = window.atob(base64Audio);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Create WAV header
  const buffer = new ArrayBuffer(44 + bytes.length);
  const view = new DataView(buffer);

  // RIFF identifier
  view.setUint32(0, 0x52494646, false); // "RIFF"
  // file length
  view.setUint32(4, 36 + bytes.length, true);
  // RIFF type
  view.setUint32(8, 0x57415645, false); // "WAVE"
  // format chunk identifier
  view.setUint32(12, 0x666d7420, false); // "fmt "
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, 24000, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, 24000 * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  view.setUint32(36, 0x64617461, false); // "data"
  // data chunk length
  view.setUint32(40, bytes.length, true);

  // Add the PCM data
  const pcmData = new Uint8Array(buffer, 44);
  pcmData.set(bytes);

  // Convert to Blob URL
  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}
