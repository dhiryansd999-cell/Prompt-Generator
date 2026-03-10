import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

export interface Shot {
  idea: string;
  prompt: string;
}

export interface ScriptLine {
  text: string;
  shots: Shot[];
  directorNote: string;
}

export interface GenerationOptions {
  styles: string[];
  orientation: "16:9" | "9:16" | "1:1";
  characterRef?: string; // base64
  styleRef?: string; // base64
}

export async function generateScriptAndShots(input: string, options: GenerationOptions): Promise<ScriptLine[]> {
  const combinedStyle = options.styles.join(", ");
  const apiKey = (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) 
    ? process.env.GEMINI_API_KEY 
    : (typeof process !== 'undefined' && process.env && process.env.API_KEY)
      ? process.env.API_KEY
      : "";
  const ai = new GoogleGenAI({ apiKey });
  const parts: any[] = [
    {
      text: `You are a MASTER STORYTELLER and a VISIONARY FILM DIRECTOR (like Christopher Nolan, David Fincher, or Denis Villeneuve). Your goal is to take a simple input and expand it into a profound, emotionally resonant cinematic journey.

    Input: ${input}
    Target Visual Style: ${combinedStyle}
    Aspect Ratio: ${options.orientation}
    
    YOUR PHILOSOPHY:
    Every frame is a window into the soul. You do not just describe "what happens"; you describe "how it feels." You use lighting, composition, and micro-expressions to tell a story that goes beyond words.

    1. THE STORYTELLER'S SOUL (Narrative Expansion):
       - Don't just repeat the input. Analyze the SUBTEXT. If the user says "a man in a city," you see "a soul lost in a concrete labyrinth, searching for a spark of humanity."
       - Create a logical, compelling narrative arc across the beats. There must be a beginning, a middle, and an end to the emotional journey.
       - Use visual metaphors. Instead of "he is sad," describe "the cold blue light of a flickering neon sign washing over his hollow face, reflecting the emptiness within."

    2. THE DIRECTOR'S EYE (Cinematography & Blocking):
       - MANDATORY: Every shot MUST have a unique camera strategy. Use: Extreme Close-ups (for intimacy/intensity), Dutch Angles (for instability), Low Angles (for power/dread), Bird's Eye (for isolation).
       - BLOCKING: Describe exactly how the character moves. They shouldn't just "be" there. They should be "pacing with frantic energy," "slumping against a cold wall," "reaching out for a disappearing light."
       - DYNAMIC VARIETY: If you have 3 shots for a line, they must show a progression: Shot 1 (Wide - The environment), Shot 2 (Medium - The action), Shot 3 (Close-up - The reaction).

    3. EMOTIONAL PRECISION (The Actor's Studio):
       - WEAK EMOTIONS ARE FORBIDDEN. Do not use generic words like "sad" or "happy."
       - Use PSYCHOLOGICAL DESCRIPTORS: "Melancholic longing," "Suppressed rage," "Existential dread," "Quiet desperation," "Manic euphoria."
       - Describe physical manifestations: "A single vein throbbing in the temple," "Eyes glazed with unshed tears," "A trembling hand reaching for a ghost."

    4. CHARACTER IDENTITY & EVOLUTION (CRITICAL):
       - If a Character Reference is provided: The character's physical features (hair, face, clothes) must be consistent, but their POSE and EXPRESSION must change in EVERY SINGLE SHOT.
       - NEVER REPEAT the pose of the reference image. The reference is for "Who they are," not "What they are doing."

    5. HYBRID LOGIC (Cinematic vs. Graphic):
       - If a shot focuses on technology, abstract concepts, or icons, switch to a "High-End Motion Graphics" style: "Clean vector lines, minimalist geometric shapes, high-contrast negative space, sleek UI elements."

    6. SHOT COUNT RULE:
       - 0-1 comma = 2 shots.
       - 2+ commas = (number of commas + 1) shots.

    7. WHISK AI OPTIMIZATION (The Technical Prompt):
       - Format: [Subject & Dynamic Action] + [Specific Psychological Expression] + [Master Cinematography & Lens (e.g., 35mm anamorphic)] + [Atmospheric Lighting (e.g., Volumetric fog, Chiaroscuro)] + [Spatial Interaction] + [Style Anchor].
       - Include: "8k resolution", "highly detailed", "cinematic lighting", "masterpiece".

    Return the result as a JSON array of objects:
    {
      "text": "The script line/narration",
      "directorNote": "A deep psychological analysis of the scene's subtext and the director's visual strategy",
      "shots": [
        {
          "idea": "A professional description following this EXACT structure: [Character Activity & Blocking] + [Specific Psychological Emotion] + [Narrative Situation/Subtext] + [Visual Style & Color Palette] + [Camera Position & Angle]. Example: 'The character leaning heavily against a rain-slicked window, eyes glazed with melancholic longing, watching the city lights blur into a bokeh of forgotten memories, cinematic noir with deep blues and harsh shadows, extreme close-up at a 45-degree angle.'",
          "prompt": "The detailed technical prompt for the AI image generator"
        }
      ]
    }`
    }

  ];

  if (options.characterRef) {
    parts.push({
      inlineData: {
        mimeType: "image/png",
        data: options.characterRef.split(',')[1]
      }
    });
    parts[0].text += "\nCRITICAL: The first attached image is the CHARACTER REFERENCE. You MUST describe this character's specific features (hair, clothing, facial structure) in EVERY prompt to ensure perfect visual consistency.";
  }

  if (options.styleRef) {
    parts.push({
      inlineData: {
        mimeType: "image/png",
        data: options.styleRef.split(',')[1]
      }
    });
    parts[0].text += "\nCRITICAL: The second attached image is the STYLE REFERENCE. You MUST analyze its color palette, texture, and lighting style and apply it to every prompt.";
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              directorNote: { type: Type.STRING },
              shots: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    idea: { type: Type.STRING },
                    prompt: { type: Type.STRING }
                  },
                  required: ["idea", "prompt"]
                }
              }
            },
            required: ["text", "shots", "directorNote"]
          }
        }
      }
    });

    const text = response.text || "[]";
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map(line => ({
        text: line.text || "",
        shots: Array.isArray(line.shots) ? line.shots : [],
        directorNote: line.directorNote || ""
      }));
    }
    return [];
  } catch (e) {
    console.error("Failed to generate or parse script", e);
    throw e; // Re-throw to be caught by the caller in App.tsx
  }
}

export async function generateImage(prompt: string, options: GenerationOptions): Promise<string | null> {
  const combinedStyle = options.styles.join(", ");
  const apiKey = (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) 
    ? process.env.GEMINI_API_KEY 
    : (typeof process !== 'undefined' && process.env && process.env.API_KEY)
      ? process.env.API_KEY
      : "";
  const ai = new GoogleGenAI({ apiKey });
  try {
    const promptLower = prompt.toLowerCase();
    const isGraphicShot = promptLower.includes('flat design') || promptLower.includes('isometric') || promptLower.includes('minimalist') || promptLower.includes('vector') || promptLower.includes('icon');
    const isCinematic = !isGraphicShot && (combinedStyle.toLowerCase().includes('cinematic') || combinedStyle.toLowerCase().includes('film') || combinedStyle.toLowerCase().includes('anime'));
    
    const persona = isGraphicShot ? "MASTER VISUAL DESIGNER AND MOTION ARTIST" : (isCinematic ? "MASTER CINEMATOGRAPHER AND LIGHTING DIRECTOR" : "MASTER VISUAL DESIGNER AND MOTION ARTIST");
    
    const parts: any[] = [
      { 
        text: `ACT AS A ${persona} AND A WORLD-CLASS STORYTELLER. Your goal is to render a single, definitive frame that captures the "Director's Vision" with absolute emotional and technical precision.
        
        TECHNICAL DIRECTIVE:
        - Aspect Ratio: ${options.orientation}
        - Master Prompt: ${prompt}
        
        EXECUTION RULES:
        - IDENTITY OVER POSE (CRITICAL): If a character reference is provided, use it ONLY for physical identity (face, hair, clothes). You MUST IGNORE the pose, expression, and background of the reference image. The character must be in the NEW pose and NEW expression described in the Master Prompt.
        - DYNAMIC VARIETY: Do not repeat the same composition. Every frame must feel like a unique, unrepeatable moment in a deep narrative.
        - PRIORITIZE THE MASTER PROMPT: It contains high-level technical instructions (e.g., Chiaroscuro, Anamorphic flares, Isometric perspective, Flat design). You must render these with 100% accuracy.
        - EMOTIONAL DEPTH: The character's facial expression and body language must be the focal point of the emotional narrative. Capture the "micro-expressions" and psychological state described.
        - CINEMATIC LIGHTING: Use lighting to tell the story. If the prompt mentions "melancholic longing," the lighting should reflect that mood.
        - WHISK AI COMPATIBILITY: Ensure the image has the "Masterpiece" quality—8k resolution, sharp focus, and professional color grading.` 
      }
    ];

    if (options.characterRef) {
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: options.characterRef.split(',')[1]
        }
      });
    }

    if (options.styleRef) {
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: options.styleRef.split(',')[1]
        }
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio: options.orientation
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (e) {
    console.error("Image generation failed", e);
    return null;
  }
}
