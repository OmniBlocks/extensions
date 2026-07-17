// Name: SB3.AI
// ID: oisthebestletter-sb3ai
// Description: Use pretrained AI models in your Scratch project!
// By: Oisthebestletter <https://scratch.mit.edu/users/Oisthebestletter/>
// License: MPL-2.0
// Tags: ai llm ml machine clanker bot

function workerMain() {
  async function importVerifiedModule(url, expectedIntegrity) {
    const response = await fetch(url, {
      cache: "no-cache",
      credentials: "omit",
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch module: ${response.status}`);
    }

    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-512", bytes);
    const actualIntegrity =
      "sha512-" + btoa(String.fromCharCode(...new Uint8Array(digest)));

    if (actualIntegrity !== expectedIntegrity) {
      throw new Error("Transformers module integrity check failed");
    }

    const moduleURL = URL.createObjectURL(
      new Blob([bytes], { type: "text/javascript" })
    );

    try {
      return await import(moduleURL);
    } finally {
      URL.revokeObjectURL(moduleURL);
    }
  }

  let pipeline;
  let classifierPromise;
  let generatorPromise;
  let imageClassifierPromise;

  async function getClassifier() {
    if (!classifierPromise) {
      classifierPromise = pipeline("sentiment-analysis");
    }
    return classifierPromise;
  }

  async function getGenerator() {
    if (!generatorPromise) {
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

  self.onmessage = async ({ data }) => {
    const { id, type, payload } = data;

    try {
      let result;

      switch (type) {
        case "init": {
          const transformers = await importVerifiedModule(
            payload.url,
            payload.integrity
          );
          pipeline = transformers.pipeline;
          result = true;
          break;
        }

        case "classify": {
          const classifier = await getClassifier();
          result = (await classifier(payload.text))[0];
          break;
        }

        case "generate": {
          const generator = await getGenerator();
          const output = await generator(payload.messages);
          result = output[0].generated_text.at(-1).content;
          break;
        }

        case "classifyImage": {
          const classifier = await getImageClassifier();
          result = await classifier(payload.image);
          break;
        }

        default:
          throw new Error(`Unknown worker request: ${type}`);
      }

      self.postMessage({ id, result });
    } catch (error) {
      self.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

let worker;
let workerURL;

function getWorker() {
  if (worker) return worker;

  const source = `(${workerMain.toString()})();`;
  workerURL = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" })
  );

  worker = new Worker(workerURL, { type: "module" });
  worker.onerror = ({ message }) => {
    console.error("SB3.AI worker failed:", message);
  };

  URL.revokeObjectURL(workerURL);
  workerURL = null;

  return worker;
}

let requestId = 0;
const pending = new Map();

function workerRequest(type, payload = {}) {
  const worker = getWorker();

  return new Promise((resolve, reject) => {
    const id = ++requestId;

    pending.set(id, { resolve, reject });

    worker.postMessage({
      id,
      type,
      payload,
    });
  });
}

getWorker().onmessage = ({ data }) => {
  const { id, result, error } = data;

  const promise = pending.get(id);
  if (!promise) return;

  pending.delete(id);

  if (error) {
    promise.reject(new Error(error));
  } else {
    promise.resolve(result);
  }
};

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

  await workerRequest("init", {
    url,
    integrity: hash,
  });

  let systemPrompt = "";

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
      return JSON.stringify(
        await workerRequest("classify", {
          text: TEXT,
        })
      );
    }

    async generate({ PROMPT }) {
      const messages = [];

      if (systemPrompt.trim()) {
        messages.push({
          role: "system",
          content: systemPrompt,
        });
      }

      messages.push({
        role: "user",
        content: PROMPT,
      });

      return await workerRequest("generate", {
        messages,
      });
    }

    async stageimg() {
      return await snapshotStage();
    }

    async classifyImage({ IMAGE }) {
      return JSON.stringify(
        await workerRequest("classifyImage", {
          image: IMAGE,
        })
      );
    }

    setSystemPrompt({ PROMPT }) {
      systemPrompt = PROMPT;
    }
  }

  Scratch.extensions.register(new AI());
})().catch(console.error);
