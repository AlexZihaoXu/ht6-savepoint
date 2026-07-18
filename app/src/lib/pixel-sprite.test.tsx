import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  API_BASE,
  spriteUrl,
  type AvatarParams,
  type SpriteManifest,
} from "./api";
import { PixelSprite } from "./pixel-sprite";
import { spriteFrameFile } from "./sprite-sheet";

const PARAMS: AvatarParams = {
  skin_tone: "fair",
  hair_color: "red",
  hair_style: "long",
  glasses: false,
  hat: null,
  shirt_color: "teal",
};

const MANIFEST: SpriteManifest = {
  tile: { w: 92, h: 92 },
  static: {
    south: "south.png",
    east: "east.png",
    west: "west.png",
    north: "north.png",
  },
  walk: { east: ["walk_east_0.png", "walk_east_1.png", "walk_east_2.png"] },
};

describe("spriteUrl", () => {
  it("builds the sheet-file URL off the shared API base", () => {
    expect(spriteUrl("demo-mia", "south.png")).toBe(
      `${API_BASE}/sprites/demo-mia/south.png`,
    );
  });

  it("escapes ids that need it", () => {
    expect(spriteUrl("a b/c", "south.png")).toBe(
      `${API_BASE}/sprites/a%20b%2Fc/south.png`,
    );
  });
});

describe("spriteFrameFile", () => {
  it("shows the forward (south) pose while idle", () => {
    expect(spriteFrameFile(MANIFEST, false, 0)).toBe("south.png");
    expect(spriteFrameFile(MANIFEST, false, 7)).toBe("south.png");
  });

  it("cycles the east walk frames in order while moving", () => {
    expect(spriteFrameFile(MANIFEST, true, 0)).toBe("walk_east_0.png");
    expect(spriteFrameFile(MANIFEST, true, 1)).toBe("walk_east_1.png");
    expect(spriteFrameFile(MANIFEST, true, 2)).toBe("walk_east_2.png");
    // wraps around however many frames the sheet has
    expect(spriteFrameFile(MANIFEST, true, 3)).toBe("walk_east_0.png");
    expect(spriteFrameFile(MANIFEST, true, 7)).toBe("walk_east_1.png");
  });

  it("falls back to south when a sheet has no walk frames", () => {
    const still = { ...MANIFEST, walk: { east: [] } };
    expect(spriteFrameFile(still, true, 2)).toBe("south.png");
  });
});

describe("PixelSprite", () => {
  it("renders the PixelLab south tile for a sprited person at rest", () => {
    const { container } = render(
      <PixelSprite localId="demo-mia" sprite={MANIFEST} params={PARAMS} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(
      `${API_BASE}/sprites/demo-mia/south.png`,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("shows a walk frame while moving, mirrored when heading left", () => {
    const { container } = render(
      <PixelSprite
        localId="demo-mia"
        sprite={MANIFEST}
        params={PARAMS}
        moving
        facing={-1}
      />,
    );
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(
      `${API_BASE}/sprites/demo-mia/walk_east_0.png`,
    );
    expect(img.style.transform).toBe("scaleX(-1)");
  });

  it("does not mirror rightward walking", () => {
    const { container } = render(
      <PixelSprite
        localId="demo-mia"
        sprite={MANIFEST}
        params={PARAMS}
        moving
        facing={1}
      />,
    );
    expect(container.querySelector("img")!.style.transform).toBe("");
  });

  it("falls back to the parametric sprite when no sheet exists yet", () => {
    const { container } = render(
      <PixelSprite localId="demo-priya" sprite={null} params={PARAMS} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});
