"use client";

import { useEffect } from "react";
import { isThemeId } from "@/lib/themes";

/** Apply the saved theme before the rest of the UI settles. */
export default function ThemeBoot() {
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((c: { theme?: string }) => {
        document.documentElement.dataset.theme =
          c.theme && isThemeId(c.theme) ? c.theme : "dusk";
      })
      .catch(() => {});
  }, []);
  return null;
}
