import { describe, it, expect } from "vitest";
import {
  WELCOME_TEMPLATE,
  ABANDONED_CART_TEMPLATE,
  POST_PURCHASE_TEMPLATE,
  PREBUILT_TEMPLATES,
  PREBUILT_TEMPLATE_LIST,
  getPrebuiltTemplate,
} from "./email-templates.server";
import { renderEmailHtml } from "./email-renderer.server";

describe("email-templates.server", () => {
  describe("catalog", () => {
    it("exposes exactly three prebuilt templates", () => {
      expect(PREBUILT_TEMPLATE_LIST).toHaveLength(3);
      expect(Object.keys(PREBUILT_TEMPLATES)).toHaveLength(3);
    });

    it("contains welcome, abandoned-cart, and post-purchase templates", () => {
      const ids = PREBUILT_TEMPLATE_LIST.map((t) => t.id);
      expect(ids).toContain("welcome");
      expect(ids).toContain("abandoned-cart");
      expect(ids).toContain("post-purchase");
    });

    it("uses matching automation triggers", () => {
      expect(WELCOME_TEMPLATE.trigger).toBe("welcome");
      expect(ABANDONED_CART_TEMPLATE.trigger).toBe("abandoned_cart");
      expect(POST_PURCHASE_TEMPLATE.trigger).toBe("post_purchase");
    });
  });

  describe("getPrebuiltTemplate", () => {
    it("returns the correct template for a known id", () => {
      expect(getPrebuiltTemplate("welcome")).toBe(WELCOME_TEMPLATE);
      expect(getPrebuiltTemplate("abandoned-cart")).toBe(
        ABANDONED_CART_TEMPLATE
      );
      expect(getPrebuiltTemplate("post-purchase")).toBe(POST_PURCHASE_TEMPLATE);
    });

    it("returns null for an unknown id", () => {
      expect(getPrebuiltTemplate("does-not-exist")).toBeNull();
      expect(getPrebuiltTemplate("")).toBeNull();
    });
  });

  describe("template structure", () => {
    it.each(PREBUILT_TEMPLATE_LIST)(
      "template $id has required fields and non-empty blocks",
      (template) => {
        expect(template.id).toBeTruthy();
        expect(template.name).toBeTruthy();
        expect(template.subject).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(Array.isArray(template.blocks)).toBe(true);
        expect(template.blocks.length).toBeGreaterThan(0);
      }
    );

    it.each(PREBUILT_TEMPLATE_LIST)(
      "template $id uses only supported block types",
      (template) => {
        const validTypes = new Set([
          "text",
          "image",
          "button",
          "divider",
          "product",
        ]);
        for (const block of template.blocks) {
          expect(validTypes.has(block.type)).toBe(true);
        }
      }
    );

    it.each(PREBUILT_TEMPLATE_LIST)(
      "template $id renders to valid HTML via renderEmailHtml",
      (template) => {
        const html = renderEmailHtml(template.blocks);
        expect(html).toContain("<!DOCTYPE html>");
        expect(html).toContain("</html>");
      }
    );
  });

  describe("abandoned cart template", () => {
    it("uses the recommended 60-minute delay", () => {
      expect(ABANDONED_CART_TEMPLATE.delayMinutes).toBe(60);
    });

    it("includes a button block with a checkout URL placeholder", () => {
      const buttonBlock = ABANDONED_CART_TEMPLATE.blocks.find(
        (b) => b.type === "button"
      );
      expect(buttonBlock).toBeDefined();
      if (buttonBlock && buttonBlock.type === "button") {
        expect(buttonBlock.url).toContain("checkout_url");
      }
    });
  });

  describe("welcome template", () => {
    it("has a zero-minute delay for instant send", () => {
      expect(WELCOME_TEMPLATE.delayMinutes).toBe(0);
    });
  });
});
