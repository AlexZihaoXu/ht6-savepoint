import { afterEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { useBodyScrollLock } from "./use-body-scroll-lock";

function Locker() {
  useBodyScrollLock();
  return null;
}

afterEach(() => {
  document.body.style.overflow = "";
});

describe("useBodyScrollLock", () => {
  it("locks body scroll while mounted and restores on unmount", () => {
    document.body.style.overflow = "";
    const a = render(<Locker />);
    expect(document.body.style.overflow).toBe("hidden");
    a.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("stays locked until the LAST of stacked locks unmounts (no leak)", () => {
    document.body.style.overflow = "";
    const outer = render(<Locker />);
    const inner = render(<Locker />); // e.g. a Person profile over the People pop-up
    expect(document.body.style.overflow).toBe("hidden");
    inner.unmount();
    expect(document.body.style.overflow).toBe("hidden"); // list still open → still locked
    outer.unmount();
    expect(document.body.style.overflow).toBe(""); // restored — not stuck "hidden"
  });
});
