import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export type LlmOptions = {
  model?: string;
  /** Ollama's local API. Nothing leaves the machine. */
  host?: string;
  /** Answers are cached by prompt hash, so reruns are instant and reproducible. */
  cacheDir?: string;
};

export type Llm = {
  model: string;
  /** Asks for JSON matching `schema`; validated with Zod and retried once if malformed. */
  ask<T extends z.ZodType>(system: string, user: string, schema: T): Promise<z.infer<T>>;
};

export const DEFAULT_MODEL = "qwen2.5:3b";

export function ollama({ model = DEFAULT_MODEL, host = "http://127.0.0.1:11434", cacheDir }: LlmOptions = {}): Llm {
  return {
    model,
    async ask(system, user, schema) {
      const format = z.toJSONSchema(schema);
      const body = {
        model,
        stream: false,
        format,
        // Deterministic: the same evidence always gets the same verdict.
        options: { temperature: 0, seed: 7 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      };
      const key = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32);
      const cached = cacheDir ? await readFile(join(cacheDir, `${key}.json`), "utf8").catch(() => null) : null;
      if (cached) return schema.parse(JSON.parse(cached));

      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(`${host}/api/chat`, { method: "POST", body: JSON.stringify(body) });
        if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
        const content = ((await res.json()) as { message: { content: string } }).message.content;
        try {
          const parsed = schema.parse(JSON.parse(content));
          if (cacheDir) {
            await mkdir(cacheDir, { recursive: true });
            await writeFile(join(cacheDir, `${key}.json`), JSON.stringify(parsed));
          }
          return parsed;
        } catch (error) {
          lastError = error;
        }
      }
      throw new Error(`Model returned invalid JSON twice: ${String(lastError)}`);
    },
  };
}

/** True if Ollama is running and has the model pulled. */
export async function ollamaReady(model = DEFAULT_MODEL, host = "http://127.0.0.1:11434"): Promise<boolean> {
  try {
    const res = await fetch(`${host}/api/tags`);
    const { models } = (await res.json()) as { models: { name: string }[] };
    return models.some((m) => m.name === model || m.name === `${model}:latest`);
  } catch {
    return false;
  }
}
