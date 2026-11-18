"use client";

import { createContext, useContext, useMemo, useState } from "react";

type BackgroundColorContextValue = {
  /** The color currently in effect — a hover preview if one is active,
   * otherwise the active page's color, otherwise null (site default). */
  activeColor: string | null;
  /** Ephemeral: hovering a product card. Pass null to clear. */
  previewColor: (hex: string | null) => void;
  /** Persistent: the page currently mounted owns the background until it
   * unmounts and clears it. Pass null to release. */
  setPageColor: (hex: string | null) => void;
};

const BackgroundColorContext = createContext<BackgroundColorContextValue | null>(
  null,
);

export function BackgroundColorProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [pageColor, setPageColor] = useState<string | null>(null);

  const value = useMemo<BackgroundColorContextValue>(
    () => ({
      activeColor: preview ?? pageColor,
      previewColor: setPreview,
      setPageColor,
    }),
    [preview, pageColor],
  );

  return (
    <BackgroundColorContext.Provider value={value}>
      {children}
    </BackgroundColorContext.Provider>
  );
}

export function useBackgroundColor() {
  const ctx = useContext(BackgroundColorContext);
  if (!ctx) {
    throw new Error(
      "useBackgroundColor must be used within a BackgroundColorProvider",
    );
  }
  return ctx;
}
