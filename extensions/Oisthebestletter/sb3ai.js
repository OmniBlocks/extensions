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
  let objectDetectorPromise;

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

  async function getObjectDetector() {
    if (!objectDetectorPromise) {
      objectDetectorPromise = pipeline(
        "object-detection",
        "Xenova/detr-resnet-50"
      );
    }
    return objectDetectorPromise;
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

        case "detectObjects": {
          const detector = await getObjectDetector();

          result = await detector(payload.image, {
            threshold: payload.threshold,
            percentage: true,
          });

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
  if (!Scratch.extensions.unsandboxed) {
    alert("SB3.AI must be ran unsandboxed!");
    throw new Error("SB3.AI must run unsandboxed");
  }

  function snapshotStage() {
    const renderer = window.vm.renderer;

    return new Promise((resolve) => {
      renderer.requestSnapshot(resolve);
      renderer.draw();
    });
  }

  let overlayCanvas;
  let overlayContext;

  function getOverlayContext() {
    const stageCanvas = Scratch.vm.runtime.renderer.canvas;
    const rect = stageCanvas.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;

    if (!overlayCanvas) {
      overlayCanvas = document.createElement("canvas");
      overlayCanvas.style.position = "fixed";
      overlayCanvas.style.pointerEvents = "none";
      overlayCanvas.style.zIndex = "1000";
      document.body.appendChild(overlayCanvas);

      overlayContext = overlayCanvas.getContext("2d");
    }

    // Keep the overlay aligned when the stage is resized or moved.
    overlayCanvas.style.left = `${rect.left}px`;
    overlayCanvas.style.top = `${rect.top}px`;
    overlayCanvas.style.width = `${rect.width}px`;
    overlayCanvas.style.height = `${rect.height}px`;

    const width = Math.round(rect.width * pixelRatio);
    const height = Math.round(rect.height * pixelRatio);

    if (overlayCanvas.width !== width || overlayCanvas.height !== height) {
      overlayCanvas.width = width;
      overlayCanvas.height = height;
    }

    overlayContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    return { context: overlayContext, width: rect.width, height: rect.height };
  }

  function clearDetectionOverlay() {
    if (!overlayCanvas || !overlayContext) return;

    overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }

  function drawDetections(detections) {
    const { context, width, height } = getOverlayContext();

    context.clearRect(0, 0, width, height);
    context.lineWidth = 3;
    context.font = "bold 14px sans-serif";
    context.textBaseline = "top";

    for (const { label, score, box } of detections) {
      const x = box.xmin * width;
      const y = box.ymin * height;
      const boxWidth = (box.xmax - box.xmin) * width;
      const boxHeight = (box.ymax - box.ymin) * height;

      const caption = `${label} (${Math.round(score * 100)}%)`;

      context.strokeStyle = "#00e676";
      context.strokeRect(x, y, boxWidth, boxHeight);

      const captionWidth = context.measureText(caption).width;
      const captionHeight = 18;

      context.fillStyle = "#00e676";
      context.fillRect(
        x,
        Math.max(0, y - captionHeight),
        captionWidth + 8,
        captionHeight
      );

      context.fillStyle = "#000";
      context.fillText(caption, x + 4, Math.max(0, y - captionHeight + 2));
    }
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
            opcode: "detectStageAndDraw",
            blockType: Scratch.BlockType.COMMAND,
            text: "detect objects on stage and draw boxes with confidence [THRESHOLD]%",
            arguments: {
              THRESHOLD: {
                type: Scratch.ArgumentType.NUMBER,
                defaultValue: 50,
              },
            },
          },
          {
            opcode: "clearDetectionOverlay",
            blockType: Scratch.BlockType.COMMAND,
            text: "clear detection boxes",
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

    async detectStageAndDraw({ THRESHOLD }) {
      const threshold = Math.max(
        0,
        Math.min(1, Scratch.Cast.toNumber(THRESHOLD) / 100)
      );

      // This captures the renderer canvas only, not the DOM overlay.
      const stageImage = await snapshotStage();

      const detections = await workerRequest("detectObjects", {
        image: stageImage,
        threshold,
      });

      drawDetections(detections);
    }

    clearDetectionOverlay() {
      clearDetectionOverlay();
    }

    setSystemPrompt({ PROMPT }) {
      systemPrompt = PROMPT;
    }
  }

  Scratch.extensions.register(new AI());
})().catch(console.error);
