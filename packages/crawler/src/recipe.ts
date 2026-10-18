import { z } from "zod";

/**
 * A site recipe is the scripted path through one site's checkout. The recipe agent
 * writes recipes for unfamiliar sites; replaying a saved recipe keeps audits fast and
 * repeatable, and the agent repairs a recipe when the site changes underneath it.
 */
export type Target =
  | { role: "button" | "link" | "checkbox" | "textbox"; name: string | RegExp }
  | { placeholder: string }
  /** Visible text. `exact` matches the whole text, for short labels like a size "6" that appear all over a page. */
  | { text: string; exact?: boolean }
  /** A link by (part of) its URL. Used for product cards, whose text is a long, changing blurb. */
  | { href: string };

type Common = {
  /** Skip quietly if the target isn't on the page. */
  optional?: boolean;
  /** Part of creating an account. Only allowed when the audit permits it (DarkBench only). */
  requiresAccount?: boolean;
  /** Why this step exists, shown in the audit log. */
  why?: string;
};

export type RecipeStep =
  | ({ do: "goto"; path: string } & Common)
  /** `adds` names the product this click puts in the cart, so other cart items can be flagged. */
  | ({ do: "click"; target: Target; adds?: string } & Common)
  | ({ do: "fill"; target: Target; value: string } & Common)
  | ({ do: "wait"; ms: number } & Common)
  | ({ do: "reload" } & Common);

export type Recipe = { site: string; baseUrl: string; steps: RecipeStep[] };

export function describeTarget(target: Target): string {
  if ("role" in target) return `${target.role} "${target.name}"`;
  if ("placeholder" in target) return `field "${target.placeholder}"`;
  if ("text" in target) return `text "${target.text}"`;
  return `link to ${target.href}`;
}

const TargetSchema = z.union([
  z.object({ role: z.enum(["button", "link", "checkbox", "textbox"]), name: z.string() }),
  z.object({ placeholder: z.string() }),
  z.object({ text: z.string(), exact: z.boolean().optional() }),
  z.object({ href: z.string() }),
]);
const Common = { optional: z.boolean().optional(), requiresAccount: z.boolean().optional(), why: z.string().optional() };
const RecipeSchema = z.object({
  site: z.string(),
  baseUrl: z.string(),
  steps: z.array(
    z.discriminatedUnion("do", [
      z.object({ do: z.literal("goto"), path: z.string(), ...Common }),
      z.object({ do: z.literal("click"), target: TargetSchema, adds: z.string().optional(), ...Common }),
      z.object({ do: z.literal("fill"), target: TargetSchema, value: z.string(), ...Common }),
      z.object({ do: z.literal("wait"), ms: z.number(), ...Common }),
      z.object({ do: z.literal("reload"), ...Common }),
    ]),
  ),
});

/** Recipes saved to disk use plain-string names only; a RegExp can't round-trip through JSON. */
export function recipeToJson(recipe: Recipe): string {
  for (const step of recipe.steps) {
    if ("target" in step && "name" in step.target && step.target.name instanceof RegExp) {
      throw new Error(`Recipe "${recipe.site}" uses a RegExp target (${step.target.name}); only string names can be saved.`);
    }
  }
  return JSON.stringify(recipe, null, 2) + "\n";
}

export function recipeFromJson(text: string): Recipe {
  return RecipeSchema.parse(JSON.parse(text)) as Recipe;
}

export function darkbenchRecipe(baseUrl: string, variant: number): Recipe {
  return {
    site: `darkbench-v${variant}`,
    baseUrl,
    steps: [
      { do: "goto", path: `/?v=${variant}` },
      { do: "click", target: { role: "link", name: "Mega deal" }, why: "open the advertised deal" },
      { do: "goto", path: "/product/usb-cable/" },
      { do: "wait", ms: 2500, why: "let any countdown tick" },
      { do: "reload", why: "check whether urgency timers restart" },
      { do: "click", target: { role: "button", name: "Add to cart" }, adds: "USB-C Cable" },
      { do: "click", target: { role: "link", name: "Proceed to checkout" } },
      {
        do: "click",
        // Every guest-checkout wording DarkBench uses. A recipe is per-site knowledge, written once.
        target: { role: "button", name: /continue as guest|checkout as guest|skip sign-in|buy without an account/i },
        optional: true,
      },
      { do: "fill", target: { placeholder: "Email" }, value: "bench@example.com", optional: true, requiresAccount: true },
      { do: "fill", target: { placeholder: "Password" }, value: "bench-only-pass", optional: true, requiresAccount: true },
      { do: "click", target: { role: "button", name: "Create account" }, optional: true, requiresAccount: true },
    ],
  };
}
