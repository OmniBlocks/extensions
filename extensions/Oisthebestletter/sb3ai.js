// Name: SB3.AI
// ID: oisthebestletter-sb3ai
// Description: Use pretrained AI models in your Scratch project!
// By: Oisthebestletter <https://scratch.mit.edu/users/Oisthebestletter/>
// License: MPL-2.0
// Tags: ai llm ml machine clanker bot

/**
 * Import a verified ES module.
 * @param {string} url
 * @param {string} expectedIntegrity
 */
async function importVerifiedModule(url, expectedIntegrity) {
  const response = await fetch(url, {
    cache: "no-cache",
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch module: ${response.status}`);
  }

  const bytes = await response.arrayBuffer();

  // Compute SHA-512
  const digest = await crypto.subtle.digest("SHA-512", bytes);

  // Convert to SRI format
  const actualIntegrity =
    "sha512-" + btoa(String.fromCharCode(...new Uint8Array(digest)));

  if (actualIntegrity !== expectedIntegrity) {
    throw new Error(
      `Integrity check failed.\nExpected: ${expectedIntegrity}\nActual:   ${actualIntegrity}`
    );
  }

  const blob = new Blob([bytes], {
    type: "text/javascript",
  });

  const blobURL = URL.createObjectURL(blob);

  try {
    return await Scratch.external.importModule(blobURL);
  } finally {
    URL.revokeObjectURL(blobURL);
  }
}

(async () => {
  function snapshotStage() {
    const renderer = window.vm.renderer;

    return new Promise((resolve) => {
      renderer.requestSnapshot(resolve);
      renderer.draw();
    });
  }

  const url = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";

  const hash =
    "sha512-XAldB8Cj+qXbxWyko4bUl9IxY1dHecCn4IKai36nUczYiJu5VSOvp13XMBnr+RqBul89LkmoDX2PjmHUI7OmuQ==";

  const module = await importVerifiedModule(url, hash);

  const { pipeline } = module;

  let classifierPromise;
  let generatorPromise;
  let imageClassifierPromise;

  let systemPrompt = "";

  async function getClassifier() {
    if (!classifierPromise) {
      classifierPromise = pipeline("sentiment-analysis");
    }
    return classifierPromise;
  }

  async function getGenerator() {
    if (!generatorPromise) {
      // This model publishes onnx/model_quantized.onnx, which is the file the
      // wasm backend's default dtype (q8) resolves to. Picking a model that is
      // missing that file makes the pipeline 404 on load.
      generatorPromise = pipeline(
        "text-generation",
        "HuggingFaceTB/SmolLM2-135M-Instruct"
      );
    }
    return generatorPromise;
  }

  async function getImageClassifier() {
    if (!imageClassifierPromise) {
      imageClassifierPromise = pipeline(
        "image-classification",
        "Xenova/vit-base-patch16-224"
      );
    }
    return imageClassifierPromise;
  }

  class AI {
    getInfo() {
      return {
        id: "sb3ai",
        name: "SB3.AI",
        // blockIconURI: iconURI,
        blocks: [
          {
            opcode: "classify",
            blockType: Scratch.BlockType.REPORTER,
            text: "classify [TEXT]",
            arguments: {
              TEXT: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "I hate clankers!",
              },
            },
          },
          {
            opcode: "generate",
            blockType: Scratch.BlockType.REPORTER,
            text: "generate [PROMPT]",
            arguments: {
              PROMPT: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "Who was Alan Turing?",
              },
            },
          },
          {
            opcode: "stageimg",
            blockType: Scratch.BlockType.REPORTER,
            text: "Stage data URI",
          },
          {
            opcode: "classifyImage",
            blockType: Scratch.BlockType.REPORTER,
            text: "classify image [IMAGE]",
            arguments: {
              IMAGE: {
                type: Scratch.ArgumentType.STRING,
                defaultValue:
                  "https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/cats.png",
              },
            },
          },
          {
            opcode: "setSystemPrompt",
            blockType: Scratch.BlockType.COMMAND,
            text: "set AI system prompt to [PROMPT]",
            arguments: {
              PROMPT: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "You are a helpful assistant.",
              },
            },
          },
        ],
      };
    }

    async classify({ TEXT }) {
      const classifier = await getClassifier();
      const result = await classifier(TEXT);
      return JSON.stringify(result[0]);
    }

    async generate({ PROMPT }) {
      const generator = await getGenerator();

      const messages = [];

      // Include the system prompt if one has been set
      if (systemPrompt.trim()) {
        messages.push({
          role: "system",
          content: systemPrompt,
        });
      }

      // Add the user's prompt
      messages.push({
        role: "user",
        content: PROMPT,
      });

      const result = await generator(messages);

      return result[0].generated_text.at(-1).content;
    }

    async stageimg() {
      return await snapshotStage();
    }

    async classifyImage({ IMAGE }) {
      const classifier = await getImageClassifier();
      return JSON.stringify(await classifier(IMAGE));
    }

    setSystemPrompt({ PROMPT }) {
      systemPrompt = PROMPT;
    }
  }

  Scratch.extensions.register(new AI());
})().catch(console.error);
