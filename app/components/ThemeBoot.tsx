"use client";

import { useEffect } from "react";
import { isThemeId } from "@/lib/themes";

/** Apply the saved theme before the rest of the UI settles. */
export default function ThemeBoot() {
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((c: { theme?: string }) => {
        if (c.theme && isThemeId(c.theme)) document.documentElement.dataset.theme = c.theme;
      })
      .catch(() => {});
  }, []);
  return null;
}
