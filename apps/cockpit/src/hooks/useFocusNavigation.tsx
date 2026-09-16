import { createContext, useContext, type ReactNode } from "react";
import type { FocusAreaDefinition } from "../domain/areas";

export interface FocusNavigationValue {
  currentArea: FocusAreaDefinition | null;
  onOpenCurrent: () => void;
  onChooseArea: () => void;
}

const FocusNavigationContext = createContext<FocusNavigationValue | null>(null);

export function FocusNavigationProvider({
  value,
  children,
}: {
  value: FocusNavigationValue | null;
  children: ReactNode;
}) {
  return (
    <FocusNavigationContext.Provider value={value}>{children}</FocusNavigationContext.Provider>
  );
}

export function useFocusNavigationValue(): FocusNavigationValue | null {
  return useContext(FocusNavigationContext);
}
